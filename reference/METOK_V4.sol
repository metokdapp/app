// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title METOK V4 - Immutable conditional-buy game with verifiable randomness, protected curve execution, and two-sided isolated P2P
/// @notice One immutable contract: fixed-supply ERC20 + conditional PLAY + protocol curve SELL + isolated two-sided P2P order book.
/// @dev
///  Economic model:
///    X = VIRTUAL_MON + realMonReserve
///    Y = curveTokenReserve
///    play quote(B) = floor(Y * B / (X + B))
///    sell quote(T) = floor(X * T / (Y + T))
///
///  A resolved PLAY settles the wager into realMonReserve. If the randomized card result
///  matches the player's chosen card and minTokenOut is respected, METOK is reserved for claim.
///  A losing PLAY leaves MON in reserve without releasing METOK. Oracle timeout or adverse winning
///  execution refunds the wager as pull-payment credit; oracle fees are external and non-refundable.
///
///  Security model:
///    - no owner/admin/upgrader/pauser/rescue function
///    - fixed 100B supply, minted once to this contract
///    - 100,000 virtual MON is pricing-only and never withdrawable
///    - PLAY and protocol SELL share a strict FIFO curve-order queue with on-chain execution limits
///    - P2P sell orders and P2P buy orders are economically isolated from curve reserves and protocol price
///    - all native MON payouts are pull-payments via withdrawableMon
///    - direct native MON transfers and direct METOK transfers to this contract are rejected
///
///  Randomness:
///    V4 uses an immutable Pyth Entropy V2-compatible oracle endpoint supplied at deployment.
///    Each PLAY supplies its own bytes32 user random contribution and the provider is immutable.
///    The oracle fee is paid separately from the wager and never enters curve accounting.
///
///  Execution protection:
///    PLAY supports minTokenOut + immutable deadline. If a winning PLAY would execute below
///    minTokenOut, the wager is refunded as MON credit instead of receiving a worse fill.
///    Protocol SELL supports minMonOut + immutable deadline; stale/adverse orders return METOK.
interface IEntropyV2Minimal {
    function requestV2(address provider, bytes32 userRandomNumber, uint32 gasLimit)
        external payable returns (uint64 assignedSequenceNumber);
    function getFeeV2(address provider, uint32 gasLimit) external view returns (uint128 feeAmount);
}

contract METOK is ERC20, ReentrancyGuard {
    using Math for uint256;

    // ---------------------------------------------------------------------
    // Constants / immutable game rule
    // ---------------------------------------------------------------------

    uint256 public constant WAD = 1e18;
    uint256 public constant TOTAL_SUPPLY = 100_000_000_000 * WAD;
    uint256 public constant VIRTUAL_MON = 100_000 * WAD;
    /// @notice Immutable launch spot price: 0.000001 MON per METOK, scaled by 1e18.
    uint256 public constant INITIAL_PRICE_WAD = 1e12;

    /// @dev Compact on-chain history used only for UI/reference analytics.
    ///      Hourly snapshots cover 32 days; daily snapshots cover 370 days.
    uint256 public constant HOURLY_HISTORY_SLOTS = 32 * 24;
    uint256 public constant DAILY_HISTORY_SLOTS = 370;
    uint256 public constant MAX_PRICE_LOOKBACK = 365 days;

    /// @dev Tiny raw-unit floor to prevent a queued protocol SELL from ever becoming a 0-MON dust settlement.
    ///      10,000,000 raw METOK units = 1e-11 METOK, economically negligible.
    uint256 public constant MIN_PROTOCOL_SELL_RAW = 10_000_000;

    /// @dev Entropy callback only stores one random word and emits an event; keep this modest.
    uint32 public constant ENTROPY_CALLBACK_GAS_LIMIT = 100_000;
    uint64 public constant MIN_ORDER_LIFETIME = 2 minutes;
    uint64 public constant MAX_ORDER_LIFETIME = 2 hours;
    uint256 public constant MAX_BATCH_SETTLE = 32;

    /// @notice Immutable external verifiable-randomness endpoint and provider.
    address public immutable ENTROPY;
    address public immutable ENTROPY_PROVIDER;

    /// @notice Number of cards/choices in the deployed game. Exactly one randomly selected card wins.
    /// @dev This is set once in the constructor; no 33.33% constant is hard-coded.
    uint32 public immutable CARD_COUNT;
    uint64 public immutable DEPLOYED_AT;

    struct PriceObservation {
        uint64 timestamp;
        uint192 priceWad;
    }

    PriceObservation[HOURLY_HISTORY_SLOTS] private _hourlyPriceHistory;
    PriceObservation[DAILY_HISTORY_SLOTS] private _dailyPriceHistory;
    uint64 public lastHourlyPriceBucket;
    uint64 public lastDailyPriceBucket;

    // ---------------------------------------------------------------------
    // Curve accounting
    // ---------------------------------------------------------------------

    /// @notice Native MON economically owned by the protocol curve. Does NOT include virtual MON.
    uint256 public realMonReserve;

    /// @notice METOK still economically owned by the protocol curve.
    uint256 public curveTokenReserve;

    /// @notice MON physically received for PLAY orders but not yet settled into realMonReserve.
    uint256 public pendingPlayMon;

    /// @notice METOK reserved for eligible PLAY claims but still physically held by this contract.
    uint256 public claimReservedToken;

    /// @notice METOK escrowed by protocol SELL orders waiting in the FIFO curve queue.
    uint256 public protocolSellEscrowToken;

    // ---------------------------------------------------------------------
    // Pull-payment accounting
    // ---------------------------------------------------------------------

    mapping(address => uint256) public withdrawableMon;
    uint256 public totalWithdrawableMon;

    // ---------------------------------------------------------------------
    // Unified FIFO curve queue: PLAY + protocol SELL
    // ---------------------------------------------------------------------

    enum CurveOrderKind {
        None,
        Play,
        Sell
    }

    struct CurveOrder {
        CurveOrderKind kind;
        address user;
        uint256 amount; // PLAY: MON wager. SELL: METOK amount.
        uint256 minOut; // PLAY: min METOK if eligible. SELL: min MON.
        uint64 deadline;
        uint64 entropySequence; // PLAY only.
        uint32 cardChoice; // PLAY only.
        bool randomReady; // PLAY only.
        uint256 randomWord; // PLAY only.
    }

    struct Claim {
        address player;
        uint256 tokenAmount;
    }

    uint256 public nextCurveOrderId = 1;
    uint256 public nextCurveOrderToSettle = 1;
    mapping(uint256 => CurveOrder) public curveOrders;
    mapping(uint256 => Claim) public claims;
    mapping(uint64 => uint256) public entropySequenceToOrderId;

    // ---------------------------------------------------------------------
    // Isolated two-sided P2P order-book accounting
    // ---------------------------------------------------------------------

    /// @notice Maker sell order: METOK is escrowed until bought or cancelled.
    struct P2PSellOrder {
        address seller;
        uint256 remainingToken;
        uint256 pricePerTokenWad; // MON per 1 METOK, scaled by 1e18.
    }

    /// @notice Maker buy order: MON is escrowed until filled or cancelled.
    struct P2PBuyOrder {
        address buyer;
        uint256 remainingMon;
        uint256 pricePerTokenWad; // Maximum MON per 1 METOK, scaled by 1e18.
    }

    uint256 public nextP2PSellOrderId = 1;
    uint256 public nextP2PBuyOrderId = 1;
    uint256 public p2pSellEscrowToken;
    uint256 public p2pBuyEscrowMon;
    mapping(uint256 => P2PSellOrder) public p2pSellOrders;
    mapping(uint256 => P2PBuyOrder) public p2pBuyOrders;

    // ---------------------------------------------------------------------
    // Internal transfer gate
    // ---------------------------------------------------------------------

    bool private _acceptingInternalTransferToSelf;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAmount();
    error InvalidCardCount();
    error InvalidCardChoice();
    error InvalidEntropyAddress();
    error InvalidEntropyProvider();
    error InvalidEntropySequence();
    error InvalidBatchSize();
    error InvalidUserRandomNumber();
    error InvalidDeadline();
    error InsufficientValue();
    error UnauthorizedEntropy();
    error WrongPlayer();
    error WrongOrderKind();
    error NoPendingCurveOrder();
    error OrderNotReady();
    error NothingToClaim();
    error NotClaimOwner();
    error Insolvent();
    error DustAmount();
    error DirectMonTransferDisabled();
    error DirectTokenTransferToContractDisabled();
    error InvalidP2PPrice();
    error P2PSellOrderNotFound();
    error P2PBuyOrderNotFound();
    error NotP2PSeller();
    error NotP2PBuyer();
    error SlippageExceeded();
    error NativeTransferFailed();
    error AccountingInvariantBroken();
    error UnsupportedPriceLookback();
    error PriceChangeOverflow();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PlaySubmitted(
        uint256 indexed orderId,
        address indexed player,
        uint256 monAmount,
        uint32 cardChoice,
        uint256 minTokenOut,
        uint64 deadline,
        uint64 entropySequence,
        uint256 entropyFee
    );

    event EntropyRandomReady(uint256 indexed orderId, uint64 indexed sequence, uint256 randomWord);
    event EntropyCallbackIgnored(uint64 indexed sequence, uint256 indexed orderId, bytes32 reason);

    event PlaySettled(
        uint256 indexed orderId,
        address indexed player,
        bool eligible,
        bool refunded,
        bytes32 refundReason,
        uint32 winningCard,
        uint256 monAmount,
        uint256 tokenReward,
        uint256 realMonReserveAfter,
        uint256 curveTokenReserveAfter
    );

    event RewardClaimed(uint256 indexed orderId, address indexed player, uint256 tokenAmount);

    event ProtocolSellSubmitted(
        uint256 indexed orderId,
        address indexed seller,
        uint256 tokenAmount,
        uint256 minMonOut,
        uint64 deadline
    );
    event ProtocolSellSettled(
        uint256 indexed orderId,
        address indexed seller,
        uint256 tokenAmount,
        uint256 monCredit,
        uint256 realMonReserveAfter,
        uint256 curveTokenReserveAfter
    );
    event ProtocolSellCancelled(
        uint256 indexed orderId,
        address indexed seller,
        uint256 tokenReturned,
        bytes32 reason
    );

    event MonCreditCreated(address indexed account, uint256 amount, bytes32 indexed reason);
    event MonWithdrawn(address indexed account, uint256 amount);

    event P2PSellOrderCreated(
        uint256 indexed orderId,
        address indexed seller,
        uint256 tokenAmount,
        uint256 pricePerTokenWad
    );
    event P2PSellOrderFilled(
        uint256 indexed orderId,
        address indexed seller,
        address indexed buyer,
        uint256 tokenAmount,
        uint256 monAmount,
        uint256 remainingToken
    );
    event P2PSellOrderCancelled(
        uint256 indexed orderId, address indexed seller, uint256 tokenReturned
    );

    event P2PBuyOrderCreated(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 monBudget,
        uint256 pricePerTokenWad
    );
    event P2PBuyOrderFilled(
        uint256 indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 tokenAmount,
        uint256 monAmount,
        uint256 remainingMon
    );
    event P2PBuyOrderCancelled(
        uint256 indexed orderId, address indexed buyer, uint256 monRefund
    );

    /// @notice Gas-bounded historical price checkpoint for DApp performance metrics.
    /// @param cadence 1 = hourly series, 2 = daily series.
    event PriceCheckpoint(uint64 indexed timestamp, uint256 priceWad, uint8 indexed cadence);

    // ---------------------------------------------------------------------
    // Constructor / immutable ownership surface
    // ---------------------------------------------------------------------

    /// @param cardCount_ Number of selectable cards. For the original 3-card game, deploy with 3.
    /// @param entropy_ Pyth Entropy V2-compatible contract address for this chain.
    /// @param entropyProvider_ Immutable provider address used for all PLAY requests.
    constructor(uint32 cardCount_, address entropy_, address entropyProvider_) ERC20("METOK", "METOK") {
        if (cardCount_ < 2 || cardCount_ > 1_000_000) revert InvalidCardCount();
        if (entropy_ == address(0) || entropy_.code.length == 0) revert InvalidEntropyAddress();
        if (entropyProvider_ == address(0)) revert InvalidEntropyProvider();
        CARD_COUNT = cardCount_;
        ENTROPY = entropy_;
        ENTROPY_PROVIDER = entropyProvider_;
        DEPLOYED_AT = uint64(block.timestamp);

        curveTokenReserve = TOTAL_SUPPLY;
        _mint(address(this), TOTAL_SUPPLY);

        uint64 hourBucket = uint64(block.timestamp / 1 hours);
        uint64 dayBucket = uint64(block.timestamp / 1 days);
        lastHourlyPriceBucket = hourBucket;
        lastDailyPriceBucket = dayBucket;
        _hourlyPriceHistory[hourBucket % HOURLY_HISTORY_SLOTS] = PriceObservation({
            timestamp: uint64(block.timestamp),
            priceWad: uint192(INITIAL_PRICE_WAD)
        });
        _dailyPriceHistory[dayBucket % DAILY_HISTORY_SLOTS] = PriceObservation({
            timestamp: uint64(block.timestamp),
            priceWad: uint192(INITIAL_PRICE_WAD)
        });
        emit PriceCheckpoint(uint64(block.timestamp), INITIAL_PRICE_WAD, 1);
        emit PriceCheckpoint(uint64(block.timestamp), INITIAL_PRICE_WAD, 2);
    }

    /// @notice Explicitly reports that this immutable protocol has no owner.
    function owner() external pure returns (address) {
        return address(0);
    }

    // ---------------------------------------------------------------------
    // ERC20 hardening
    // ---------------------------------------------------------------------

    /// @dev Prevent users from bypassing bucket accounting by directly transferring METOK to this contract.
    function _update(address from, address to, uint256 value) internal override {
        if (
            to == address(this) &&
            from != address(0) &&
            !_acceptingInternalTransferToSelf
        ) {
            revert DirectTokenTransferToContractDisabled();
        }
        super._update(from, to, value);
    }

    function _takeTokenToSelf(address from, uint256 amount) internal {
        _acceptingInternalTransferToSelf = true;
        _transfer(from, address(this), amount);
        _acceptingInternalTransferToSelf = false;
    }

    receive() external payable {
        revert DirectMonTransferDisabled();
    }

    fallback() external payable {
        revert DirectMonTransferDisabled();
    }

    // ---------------------------------------------------------------------
    // Public curve views
    // ---------------------------------------------------------------------

    /// @notice Pricing-side MON = virtual MON + settled real MON reserve.
    function totalMonForPricing() public view returns (uint256) {
        return VIRTUAL_MON + realMonReserve;
    }

    /// @notice METOK outside the curve reserve economically, including claim/P2P/protocol-sell escrow.
    function circulatingSupply() public view returns (uint256) {
        return TOTAL_SUPPLY - curveTokenReserve;
    }

    /// @notice Spot MON price per 1 METOK, scaled by 1e18.
    function protocolPriceWad() public view returns (uint256) {
        return Math.mulDiv(totalMonForPricing(), WAD, curveTokenReserve);
    }

    /// @notice Signed percentage change versus immutable launch price. 1e18 = 1.00 percentage point.
    /// @dev Example: +25% = +25e18, -3.5% = -3.5e18.
    function priceChangeFromInitialWad() public view returns (int256) {
        return _signedPercentChangeWad(protocolPriceWad(), INITIAL_PRICE_WAD);
    }

    /// @notice Rolling price performance using compact on-chain checkpoints.
    /// @dev Historical reference is the latest checkpoint at or before the requested target.
    ///      Short windows use hourly checkpoints; >32 days uses daily checkpoints.
    ///      If the contract is younger than the requested window, `fullWindow` is false and
    ///      launch price is returned as the reference.
    function priceChangeWad(uint256 lookbackSeconds)
        public
        view
        returns (
            int256 changePctWad,
            uint256 referencePriceWad,
            uint64 referenceTimestamp,
            bool fullWindow
        )
    {
        if (lookbackSeconds == 0 || lookbackSeconds > MAX_PRICE_LOOKBACK) {
            revert UnsupportedPriceLookback();
        }

        uint256 target = block.timestamp > lookbackSeconds ? block.timestamp - lookbackSeconds : 0;
        uint256 current = protocolPriceWad();

        if (target < DEPLOYED_AT) {
            return (
                _signedPercentChangeWad(current, INITIAL_PRICE_WAD),
                INITIAL_PRICE_WAD,
                DEPLOYED_AT,
                false
            );
        }

        PriceObservation memory observation;
        bool found;
        if (lookbackSeconds <= 32 days) {
            (observation, found) = _findHourlyObservation(target);
        } else {
            (observation, found) = _findDailyObservation(target);
        }

        if (!found) {
            return (
                _signedPercentChangeWad(current, INITIAL_PRICE_WAD),
                INITIAL_PRICE_WAD,
                DEPLOYED_AT,
                false
            );
        }

        referencePriceWad = uint256(observation.priceWad);
        referenceTimestamp = observation.timestamp;
        fullWindow = true;
        changePctWad = _signedPercentChangeWad(current, referencePriceWad);
    }

    /// @notice Dashboard bundle for 1H / 1D / 1W / 30D / 365D plus since-launch change.
    function priceChangeStats()
        external
        view
        returns (
            int256[5] memory changesPctWad,
            bool[5] memory fullWindows,
            uint256[5] memory referencePricesWad,
            uint64[5] memory referenceTimestamps,
            int256 sinceLaunchPctWad
        )
    {
        uint256[5] memory windows = [uint256(1 hours), 1 days, 7 days, 30 days, 365 days];
        for (uint256 i; i < windows.length; ++i) {
            (
                changesPctWad[i],
                referencePricesWad[i],
                referenceTimestamps[i],
                fullWindows[i]
            ) = priceChangeWad(windows[i]);
        }
        sinceLaunchPctWad = priceChangeFromInitialWad();
    }

    /// @notice Estimated METOK for a winning PLAY if settled against the current curve now.
    /// @dev V4 lets the caller bind this preview on-chain with minTokenOut.
    function quotePlay(uint256 monAmount) public view returns (uint256) {
        if (monAmount == 0) return 0;
        uint256 x = totalMonForPricing();
        return Math.mulDiv(curveTokenReserve, monAmount, x + monAmount);
    }

    /// @notice Estimated MON credit for a protocol SELL if settled against the current curve now.
    /// @dev V4 lets the caller bind this preview on-chain with minMonOut.
    function quoteProtocolSell(uint256 tokenAmount) public view returns (uint256) {
        if (tokenAmount == 0) return 0;
        uint256 x = totalMonForPricing();
        return Math.mulDiv(x, tokenAmount, curveTokenReserve + tokenAmount);
    }

    /// @notice Constant-product-like backing metric used by invariant tests.
    /// @dev May overflow if naively multiplied at extreme impossible economic states; current fixed supply/reserves are safe in practice.
    function curveK() external view returns (uint256) {
        return totalMonForPricing() * curveTokenReserve;
    }

    /// @notice Native MON accounted by protocol bookkeeping. Forced native transfers are intentionally excluded.
    function accountedMon() public view returns (uint256) {
        return realMonReserve + pendingPlayMon + p2pBuyEscrowMon + totalWithdrawableMon;
    }

    /// @notice Native MON present but not recognized by protocol accounting (e.g. forced transfer).
    function unaccountedMon() external view returns (uint256) {
        uint256 bal = address(this).balance;
        uint256 accounted = accountedMon();
        return bal > accounted ? bal - accounted : 0;
    }

    /// @notice Core token-bucket invariant for monitoring/indexers.
    function tokenBucketsBalanced() public view returns (bool) {
        return balanceOf(address(this)) ==
            curveTokenReserve + claimReservedToken + p2pSellEscrowToken + protocolSellEscrowToken;
    }

    function monAccountingSolvent() public view returns (bool) {
        return address(this).balance >= accountedMon();
    }

    // ---------------------------------------------------------------------
    // Verifiable-randomness PLAY
    // ---------------------------------------------------------------------

    function entropyFee() public view returns (uint256) {
        return uint256(IEntropyV2Minimal(ENTROPY).getFeeV2(ENTROPY_PROVIDER, ENTROPY_CALLBACK_GAS_LIMIT));
    }

    function getCurveOrderState(uint256 orderId) external view returns (
        uint8 kind,
        address user,
        uint256 amount,
        uint256 minOut,
        uint64 deadline,
        uint64 entropySequence,
        bool randomReady
    ) {
        CurveOrder storage order = curveOrders[orderId];
        return (
            uint8(order.kind), order.user, order.amount, order.minOut, order.deadline,
            order.entropySequence, order.randomReady
        );
    }

    /// @notice Submit an arbitrary-size conditional BUY using immutable verifiable randomness.
    /// @param betAmount MON wager that enters pending curve accounting; oracle fee is separate.
    /// @param cardChoice Card index in [0, CARD_COUNT).
    /// @param userRandomNumber Client-generated cryptographically random bytes32 contribution.
    /// @param minTokenOut Minimum METOK accepted if the random result is eligible.
    /// @param deadline Unix timestamp after which an unfulfilled randomness request refunds the wager.
    function submitPlay(
        uint256 betAmount,
        uint32 cardChoice,
        bytes32 userRandomNumber,
        uint256 minTokenOut,
        uint64 deadline
    ) external payable nonReentrant returns (uint256 orderId, uint64 sequenceNumber) {
        if (betAmount == 0) revert ZeroAmount();
        if (cardChoice >= CARD_COUNT) revert InvalidCardChoice();
        if (userRandomNumber == bytes32(0)) revert InvalidUserRandomNumber();
        _validateDeadline(deadline);

        uint256 fee = entropyFee();
        uint256 requiredValue = betAmount + fee;
        if (msg.value < requiredValue) revert InsufficientValue();

        orderId = nextCurveOrderId++;
        curveOrders[orderId] = CurveOrder({
            kind: CurveOrderKind.Play,
            user: msg.sender,
            amount: betAmount,
            minOut: minTokenOut,
            deadline: deadline,
            entropySequence: 0,
            cardChoice: cardChoice,
            randomReady: false,
            randomWord: 0
        });
        pendingPlayMon += betAmount;

        sequenceNumber = IEntropyV2Minimal(ENTROPY).requestV2{value: fee}(
            ENTROPY_PROVIDER,
            userRandomNumber,
            ENTROPY_CALLBACK_GAS_LIMIT
        );
        if (sequenceNumber == 0) revert InvalidEntropySequence();
        if (entropySequenceToOrderId[sequenceNumber] != 0) revert AccountingInvariantBroken();
        curveOrders[orderId].entropySequence = sequenceNumber;
        entropySequenceToOrderId[sequenceNumber] = orderId;

        uint256 excess = msg.value - requiredValue;
        if (excess != 0) _creditMon(msg.sender, excess, keccak256("PLAY_EXCESS_REFUND"));

        emit PlaySubmitted(
            orderId,
            msg.sender,
            betAmount,
            cardChoice,
            minTokenOut,
            deadline,
            sequenceNumber,
            fee
        );
        _assertAccounting();
    }

    /// @notice Pyth Entropy-compatible callback entrypoint. Callback work is intentionally tiny and non-reverting.
    function _entropyCallback(uint64 sequence, address provider, bytes32 randomNumber) external {
        if (msg.sender != ENTROPY) revert UnauthorizedEntropy();

        uint256 orderId = entropySequenceToOrderId[sequence];
        if (orderId == 0) {
            emit EntropyCallbackIgnored(sequence, 0, keccak256("UNKNOWN_SEQUENCE"));
            return;
        }

        CurveOrder storage order = curveOrders[orderId];
        if (
            order.kind != CurveOrderKind.Play ||
            order.entropySequence != sequence ||
            provider != ENTROPY_PROVIDER ||
            order.randomReady ||
            block.timestamp > order.deadline
        ) {
            emit EntropyCallbackIgnored(sequence, orderId, keccak256("STALE_OR_INVALID_CALLBACK"));
            return;
        }

        order.randomReady = true;
        order.randomWord = uint256(randomNumber);
        emit EntropyRandomReady(orderId, sequence, uint256(randomNumber));
    }

    // ---------------------------------------------------------------------
    // Protocol SELL submission
    // ---------------------------------------------------------------------

    /// @notice Submit a protected METOK sale to the protocol curve.
    /// @dev If stale or below minMonOut at FIFO settlement, METOK is returned instead of forcing a bad fill.
    function submitProtocolSell(uint256 tokenAmount, uint256 minMonOut, uint64 deadline)
        external
        nonReentrant
        returns (uint256 orderId)
    {
        if (tokenAmount < MIN_PROTOCOL_SELL_RAW) revert DustAmount();
        _validateDeadline(deadline);

        _takeTokenToSelf(msg.sender, tokenAmount);
        protocolSellEscrowToken += tokenAmount;

        orderId = nextCurveOrderId++;
        curveOrders[orderId] = CurveOrder({
            kind: CurveOrderKind.Sell,
            user: msg.sender,
            amount: tokenAmount,
            minOut: minMonOut,
            deadline: deadline,
            entropySequence: 0,
            cardChoice: 0,
            randomReady: false,
            randomWord: 0
        });

        emit ProtocolSellSubmitted(orderId, msg.sender, tokenAmount, minMonOut, deadline);
        _assertAccounting();
    }

    // ---------------------------------------------------------------------
    // Strict FIFO curve settlement
    // ---------------------------------------------------------------------

    /// @notice Whether the head of the FIFO queue can be settled now without reverting for randomness.
    /// @dev A PLAY becomes settleable when randomness is ready OR its oracle-timeout deadline has passed.
    ///      Once randomness is ready, a PLAY remains settleable even after the deadline. This deliberately
    ///      prevents a player from waiting out a known losing result and turning it into a refund option.
    function canSettleNextCurveOrder() public view returns (bool) {
        uint256 orderId = nextCurveOrderToSettle;
        if (orderId >= nextCurveOrderId) return false;
        CurveOrder storage order = curveOrders[orderId];
        if (order.kind == CurveOrderKind.Play) {
            return order.randomReady || block.timestamp > order.deadline;
        }
        return order.kind == CurveOrderKind.Sell;
    }

    /// @notice Settle exactly the next PLAY or protocol SELL in submission order. Anyone may call.
    /// @dev Oracle-timeout PLAYs refund the wager only if randomness never became ready.
    ///      Stale/adverse SELLs return METOK.
    function settleNextCurveOrder() external nonReentrant returns (uint256 settledOrderId) {
        settledOrderId = nextCurveOrderToSettle;
        if (settledOrderId >= nextCurveOrderId) revert NoPendingCurveOrder();
        if (!canSettleNextCurveOrder()) revert OrderNotReady();
        _settleHeadCurveOrder(settledOrderId);
        _assertAccounting();
    }

    /// @notice Permissionless gas-efficient FIFO keeper helper. Settles up to `maxOrders` ready orders.
    /// @dev Stops (without reverting prior work) when it reaches a PLAY whose randomness is not ready and
    ///      whose oracle-timeout has not elapsed. Bounded to protect callers from accidental gas exhaustion.
    function settleReadyCurveOrders(uint256 maxOrders) external nonReentrant returns (uint256 settledCount) {
        if (maxOrders == 0 || maxOrders > MAX_BATCH_SETTLE) revert InvalidBatchSize();
        while (settledCount < maxOrders && nextCurveOrderToSettle < nextCurveOrderId) {
            if (!canSettleNextCurveOrder()) break;
            uint256 orderId = nextCurveOrderToSettle;
            _settleHeadCurveOrder(orderId);
            unchecked { ++settledCount; }
        }
        _assertAccounting();
    }

    function _settleHeadCurveOrder(uint256 orderId) internal {
        CurveOrder storage order = curveOrders[orderId];
        CurveOrderKind kind = order.kind;
        if (kind == CurveOrderKind.Play) {
            _settlePlay(orderId, order);
        } else if (kind == CurveOrderKind.Sell) {
            _settleProtocolSell(orderId, order);
        } else {
            revert WrongOrderKind();
        }
        unchecked { nextCurveOrderToSettle = orderId + 1; }
    }

    function _settlePlay(uint256 orderId, CurveOrder storage order) internal {
        address player = order.user;
        uint256 monAmount = order.amount;
        uint64 sequence = order.entropySequence;

        if (!order.randomReady) {
            if (block.timestamp <= order.deadline) revert OrderNotReady();
            pendingPlayMon -= monAmount;
            _creditMon(player, monAmount, keccak256("PLAY_ORACLE_TIMEOUT_REFUND"));
            delete entropySequenceToOrderId[sequence];
            delete curveOrders[orderId];
            emit PlaySettled(
                orderId, player, false, true, keccak256("ORACLE_TIMEOUT"), type(uint32).max,
                monAmount, 0, realMonReserve, curveTokenReserve
            );
            return;
        }

        uint32 winningCard = uint32(_uniform(order.randomWord, CARD_COUNT));
        bool eligible = winningCard == order.cardChoice;
        uint256 tokenReward;
        bool refunded;
        bytes32 refundReason;

        if (eligible) {
            tokenReward = Math.mulDiv(
                curveTokenReserve,
                monAmount,
                totalMonForPricing() + monAmount
            );
            if (tokenReward == 0 || tokenReward < order.minOut) {
                refunded = true;
                refundReason = keccak256("PLAY_SLIPPAGE");
                tokenReward = 0;
                pendingPlayMon -= monAmount;
                _creditMon(player, monAmount, refundReason);
            } else {
                pendingPlayMon -= monAmount;
                realMonReserve += monAmount;
                curveTokenReserve -= tokenReward;
                claimReservedToken += tokenReward;
                claims[orderId] = Claim({player: player, tokenAmount: tokenReward});
            }
        } else {
            pendingPlayMon -= monAmount;
            realMonReserve += monAmount;
        }

        delete entropySequenceToOrderId[sequence];
        delete curveOrders[orderId];
        _recordPriceCheckpoint();

        emit PlaySettled(
            orderId, player, eligible, refunded, refundReason, winningCard, monAmount, tokenReward,
            realMonReserve, curveTokenReserve
        );
    }

    function _settleProtocolSell(uint256 orderId, CurveOrder storage order) internal {
        address seller = order.user;
        uint256 tokenAmount = order.amount;

        if (block.timestamp > order.deadline) {
            _cancelProtocolSell(orderId, seller, tokenAmount, keccak256("SELL_EXPIRED"));
            return;
        }

        uint256 monOut = Math.mulDiv(
            totalMonForPricing(),
            tokenAmount,
            curveTokenReserve + tokenAmount
        );

        if (monOut == 0 || monOut < order.minOut || monOut > realMonReserve) {
            bytes32 reason = monOut < order.minOut ? keccak256("SELL_SLIPPAGE") : keccak256("SELL_UNSAFE");
            _cancelProtocolSell(orderId, seller, tokenAmount, reason);
            return;
        }

        protocolSellEscrowToken -= tokenAmount;
        curveTokenReserve += tokenAmount;
        realMonReserve -= monOut;
        _creditMon(seller, monOut, keccak256("PROTOCOL_SELL"));
        delete curveOrders[orderId];
        _recordPriceCheckpoint();

        emit ProtocolSellSettled(
            orderId, seller, tokenAmount, monOut, realMonReserve, curveTokenReserve
        );
    }

    function _cancelProtocolSell(uint256 orderId, address seller, uint256 tokenAmount, bytes32 reason) internal {
        protocolSellEscrowToken -= tokenAmount;
        delete curveOrders[orderId];
        _transfer(address(this), seller, tokenAmount);
        emit ProtocolSellCancelled(orderId, seller, tokenAmount, reason);
    }

    // ---------------------------------------------------------------------
    // Reward claim
    // ---------------------------------------------------------------------

    function claimReward(uint256 orderId) external nonReentrant {
        Claim memory c = claims[orderId];
        if (c.tokenAmount == 0) revert NothingToClaim();
        if (c.player != msg.sender) revert NotClaimOwner();

        delete claims[orderId];
        claimReservedToken -= c.tokenAmount;
        _transfer(address(this), msg.sender, c.tokenAmount);

        emit RewardClaimed(orderId, msg.sender, c.tokenAmount);
        _assertAccounting();
    }

    // ---------------------------------------------------------------------
    // Isolated two-sided P2P marketplace
    // ---------------------------------------------------------------------

    /// @notice Create a maker sell order at any positive MON/METOK price.
    /// @dev Escrowed METOK is outside the curve and cannot change protocol price.
    function createP2PSellOrder(uint256 tokenAmount, uint256 pricePerTokenWad)
        external
        nonReentrant
        returns (uint256 orderId)
    {
        if (tokenAmount == 0) revert ZeroAmount();
        if (pricePerTokenWad == 0) revert InvalidP2PPrice();

        _takeTokenToSelf(msg.sender, tokenAmount);
        p2pSellEscrowToken += tokenAmount;

        orderId = nextP2PSellOrderId++;
        p2pSellOrders[orderId] = P2PSellOrder({
            seller: msg.sender,
            remainingToken: tokenAmount,
            pricePerTokenWad: pricePerTokenWad
        });

        emit P2PSellOrderCreated(orderId, msg.sender, tokenAmount, pricePerTokenWad);
        _assertAccounting();
    }

    /// @notice Buy from a maker sell order using any positive MON amount.
    /// @param minTokenOut Taker-side protection against stale/partially-filled order state.
    /// @dev Any unspent MON becomes withdrawable credit for the taker.
    function buyFromP2PSellOrder(uint256 orderId, uint256 minTokenOut)
        external
        payable
        nonReentrant
        returns (uint256 tokenOut, uint256 monCost)
    {
        if (msg.value == 0) revert ZeroAmount();

        P2PSellOrder storage order = p2pSellOrders[orderId];
        if (order.seller == address(0) || order.remainingToken == 0) revert P2PSellOrderNotFound();

        tokenOut = Math.mulDiv(msg.value, WAD, order.pricePerTokenWad);
        if (tokenOut > order.remainingToken) tokenOut = order.remainingToken;
        if (tokenOut == 0 || tokenOut < minTokenOut) revert SlippageExceeded();

        monCost = _mulDivUp(tokenOut, order.pricePerTokenWad, WAD);
        if (monCost > msg.value) revert AccountingInvariantBroken();

        address seller = order.seller;
        order.remainingToken -= tokenOut;
        p2pSellEscrowToken -= tokenOut;

        _creditMon(seller, monCost, keccak256("P2P_SELL_FILL"));

        uint256 refund = msg.value - monCost;
        if (refund != 0) {
            _creditMon(msg.sender, refund, keccak256("P2P_SELL_TAKER_REFUND"));
        }

        uint256 remaining = order.remainingToken;
        if (remaining == 0) delete p2pSellOrders[orderId];

        _transfer(address(this), msg.sender, tokenOut);

        emit P2PSellOrderFilled(orderId, seller, msg.sender, tokenOut, monCost, remaining);
        _assertAccounting();
    }

    function cancelP2PSellOrder(uint256 orderId) external nonReentrant {
        P2PSellOrder memory order = p2pSellOrders[orderId];
        if (order.seller == address(0) || order.remainingToken == 0) revert P2PSellOrderNotFound();
        if (order.seller != msg.sender) revert NotP2PSeller();

        delete p2pSellOrders[orderId];
        p2pSellEscrowToken -= order.remainingToken;
        _transfer(address(this), msg.sender, order.remainingToken);

        emit P2PSellOrderCancelled(orderId, msg.sender, order.remainingToken);
        _assertAccounting();
    }

    /// @notice Create a maker buy order by escrowing MON at any positive maximum MON/METOK price.
    /// @dev msg.value is the exact MON budget. It never enters realMonReserve or protocol pricing.
    function createP2PBuyOrder(uint256 pricePerTokenWad)
        external
        payable
        nonReentrant
        returns (uint256 orderId)
    {
        if (msg.value == 0) revert ZeroAmount();
        if (pricePerTokenWad == 0) revert InvalidP2PPrice();

        p2pBuyEscrowMon += msg.value;
        orderId = nextP2PBuyOrderId++;
        p2pBuyOrders[orderId] = P2PBuyOrder({
            buyer: msg.sender,
            remainingMon: msg.value,
            pricePerTokenWad: pricePerTokenWad
        });

        emit P2PBuyOrderCreated(orderId, msg.sender, msg.value, pricePerTokenWad);
        _assertAccounting();
    }

    /// @notice Sell up to tokenAmount METOK into an existing maker buy order.
    /// @param minMonOut Seller-side protection against a stale/partially-filled buy order.
    /// @dev Only the accepted token amount is transferred. MON payout is pull-payment credit.
    function fillP2PBuyOrder(uint256 orderId, uint256 tokenAmount, uint256 minMonOut)
        external
        nonReentrant
        returns (uint256 tokenFilled, uint256 monOut)
    {
        if (tokenAmount == 0) revert ZeroAmount();

        P2PBuyOrder storage order = p2pBuyOrders[orderId];
        if (order.buyer == address(0) || order.remainingMon == 0) revert P2PBuyOrderNotFound();

        uint256 maxTokenForBudget = Math.mulDiv(order.remainingMon, WAD, order.pricePerTokenWad);
        tokenFilled = tokenAmount < maxTokenForBudget ? tokenAmount : maxTokenForBudget;
        if (tokenFilled == 0) revert SlippageExceeded();

        monOut = _mulDivUp(tokenFilled, order.pricePerTokenWad, WAD);
        if (monOut == 0 || monOut < minMonOut || monOut > order.remainingMon) revert SlippageExceeded();

        address buyer = order.buyer;
        _takeTokenToSelf(msg.sender, tokenFilled);

        order.remainingMon -= monOut;
        p2pBuyEscrowMon -= monOut;
        _creditMon(msg.sender, monOut, keccak256("P2P_BUY_FILL"));
        _transfer(address(this), buyer, tokenFilled);

        uint256 remaining = order.remainingMon;
        // If the remaining budget cannot buy even one raw METOK unit, close the order and refund the dust.
        if (remaining != 0 && Math.mulDiv(remaining, WAD, order.pricePerTokenWad) == 0) {
            p2pBuyEscrowMon -= remaining;
            _creditMon(buyer, remaining, keccak256("P2P_BUY_DUST_REFUND"));
            remaining = 0;
        }

        if (remaining == 0) {
            delete p2pBuyOrders[orderId];
        } else {
            order.remainingMon = remaining;
        }

        emit P2PBuyOrderFilled(orderId, buyer, msg.sender, tokenFilled, monOut, remaining);
        _assertAccounting();
    }

    function cancelP2PBuyOrder(uint256 orderId) external nonReentrant {
        P2PBuyOrder memory order = p2pBuyOrders[orderId];
        if (order.buyer == address(0) || order.remainingMon == 0) revert P2PBuyOrderNotFound();
        if (order.buyer != msg.sender) revert NotP2PBuyer();

        delete p2pBuyOrders[orderId];
        p2pBuyEscrowMon -= order.remainingMon;
        _creditMon(msg.sender, order.remainingMon, keccak256("P2P_BUY_CANCEL_REFUND"));

        emit P2PBuyOrderCancelled(orderId, msg.sender, order.remainingMon);
        _assertAccounting();
    }

    /// @notice Preview a taker purchase from a maker sell order.
    function quoteP2PSellOrderBuy(uint256 orderId, uint256 monAmount)
        external
        view
        returns (uint256 tokenOut, uint256 monCost, uint256 refund)
    {
        P2PSellOrder storage order = p2pSellOrders[orderId];
        if (order.seller == address(0) || order.remainingToken == 0) return (0, 0, monAmount);
        tokenOut = Math.mulDiv(monAmount, WAD, order.pricePerTokenWad);
        if (tokenOut > order.remainingToken) tokenOut = order.remainingToken;
        if (tokenOut == 0) return (0, 0, monAmount);
        monCost = _mulDivUp(tokenOut, order.pricePerTokenWad, WAD);
        refund = monAmount - monCost;
    }

    /// @notice Preview a seller fill into a maker buy order.
    function quoteP2PBuyOrderFill(uint256 orderId, uint256 tokenAmount)
        external
        view
        returns (uint256 tokenFilled, uint256 monOut)
    {
        P2PBuyOrder storage order = p2pBuyOrders[orderId];
        if (order.buyer == address(0) || order.remainingMon == 0 || tokenAmount == 0) return (0, 0);
        uint256 maxTokenForBudget = Math.mulDiv(order.remainingMon, WAD, order.pricePerTokenWad);
        tokenFilled = tokenAmount < maxTokenForBudget ? tokenAmount : maxTokenForBudget;
        if (tokenFilled == 0) return (0, 0);
        monOut = _mulDivUp(tokenFilled, order.pricePerTokenWad, WAD);
    }

    // ---------------------------------------------------------------------
    // Native MON pull-payment
    // ---------------------------------------------------------------------

    function withdrawMon() external nonReentrant {
        uint256 amount = withdrawableMon[msg.sender];
        if (amount == 0) revert ZeroAmount();

        withdrawableMon[msg.sender] = 0;
        totalWithdrawableMon -= amount;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();

        emit MonWithdrawn(msg.sender, amount);
        _assertAccounting();
    }

    function _creditMon(address account, uint256 amount, bytes32 reason) internal {
        withdrawableMon[account] += amount;
        totalWithdrawableMon += amount;
        emit MonCreditCreated(account, amount, reason);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _recordPriceCheckpoint() internal {
        uint64 timestamp = uint64(block.timestamp);
        uint256 price = protocolPriceWad();
        // uint192 max is astronomically above any economically reachable MON/METOK price.
        // Saturation keeps analytics incapable of blocking core settlement in a pathological state.
        uint192 compactPrice = price > type(uint192).max ? type(uint192).max : uint192(price);

        uint64 hourBucket = uint64(block.timestamp / 1 hours);
        if (hourBucket != lastHourlyPriceBucket) {
            lastHourlyPriceBucket = hourBucket;
            _hourlyPriceHistory[hourBucket % HOURLY_HISTORY_SLOTS] = PriceObservation({
                timestamp: timestamp,
                priceWad: compactPrice
            });
            emit PriceCheckpoint(timestamp, price, 1);
        }

        uint64 dayBucket = uint64(block.timestamp / 1 days);
        if (dayBucket != lastDailyPriceBucket) {
            lastDailyPriceBucket = dayBucket;
            _dailyPriceHistory[dayBucket % DAILY_HISTORY_SLOTS] = PriceObservation({
                timestamp: timestamp,
                priceWad: compactPrice
            });
            emit PriceCheckpoint(timestamp, price, 2);
        }
    }

    function _findHourlyObservation(uint256 target)
        internal
        view
        returns (PriceObservation memory observation, bool found)
    {
        uint256 bucket = target / 1 hours;
        for (uint256 i; i < HOURLY_HISTORY_SLOTS; ++i) {
            if (i > bucket) break;
            uint256 candidateBucket = bucket - i;
            PriceObservation memory candidate =
                _hourlyPriceHistory[candidateBucket % HOURLY_HISTORY_SLOTS];
            if (
                candidate.timestamp != 0 &&
                candidate.timestamp <= target &&
                uint256(candidate.timestamp) / 1 hours == candidateBucket
            ) {
                return (candidate, true);
            }
        }
    }

    function _findDailyObservation(uint256 target)
        internal
        view
        returns (PriceObservation memory observation, bool found)
    {
        uint256 bucket = target / 1 days;
        for (uint256 i; i < DAILY_HISTORY_SLOTS; ++i) {
            if (i > bucket) break;
            uint256 candidateBucket = bucket - i;
            PriceObservation memory candidate =
                _dailyPriceHistory[candidateBucket % DAILY_HISTORY_SLOTS];
            if (
                candidate.timestamp != 0 &&
                candidate.timestamp <= target &&
                uint256(candidate.timestamp) / 1 days == candidateBucket
            ) {
                return (candidate, true);
            }
        }
    }

    function _signedPercentChangeWad(uint256 currentPrice, uint256 referencePrice)
        internal
        pure
        returns (int256)
    {
        if (referencePrice == 0 || currentPrice == referencePrice) return 0;

        bool positive = currentPrice > referencePrice;
        uint256 delta = positive ? currentPrice - referencePrice : referencePrice - currentPrice;
        uint256 scaled = Math.mulDiv(delta, 100 * WAD, referencePrice);
        if (scaled > uint256(type(int256).max)) revert PriceChangeOverflow();

        int256 signed = int256(scaled);
        return positive ? signed : -signed;
    }

    /// @dev Uniform integer in [0, upperBound), with rejection sampling to eliminate modulo bias.
    ///      CARD_COUNT is capped at 1,000,000, so rejection probability is astronomically small.
    function _uniform(uint256 randomWord, uint256 upperBound) internal pure returns (uint256) {
        // 2^256 mod upperBound, computed without representing 2^256.
        uint256 threshold = (type(uint256).max - upperBound + 1) % upperBound;
        while (randomWord < threshold) {
            randomWord = uint256(keccak256(abi.encodePacked(randomWord)));
        }
        return randomWord % upperBound;
    }

    function _mulDivUp(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256) {
        uint256 result = Math.mulDiv(x, y, denominator);
        if (mulmod(x, y, denominator) != 0) {
            result += 1;
        }
        return result;
    }

    function _validateDeadline(uint64 deadline) internal view {
        uint256 minDeadline = block.timestamp + MIN_ORDER_LIFETIME;
        uint256 maxDeadline = block.timestamp + MAX_ORDER_LIFETIME;
        if (uint256(deadline) < minDeadline || uint256(deadline) > maxDeadline) revert InvalidDeadline();
    }

    function _assertAccounting() internal view {
        if (!tokenBucketsBalanced()) revert AccountingInvariantBroken();
        if (!monAccountingSolvent()) revert AccountingInvariantBroken();
    }
}
