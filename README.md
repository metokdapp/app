# METOK V4 DApp Pro 5.1 — MetaMask Everywhere / Production Launch

Non-custodial React/Vite frontend for the immutable METOK V4 contract on Monad Mainnet.

- Contract: `0xE25AaBa9CBCD0DF6e0b3659c66F1C022a4ED1cf6`
- Chain: Monad Mainnet (`143` / `0x8f`)
- Native asset: `MON`
- Contract rules: see `reference/METOK_V4.sol`

## What 5.1 adds — MetaMask everywhere

The wallet layer now uses the current **MetaMask Connect EVM** integration instead of relying only on `window.ethereum`.

Supported connection surfaces:

- Chrome/Edge/Brave desktop with the MetaMask extension: direct extension connection.
- Chrome/Safari mobile without an injected wallet: MetaMask Connect deeplinks to MetaMask Mobile and uses its encrypted relay session.
- MetaMask Mobile in-app browser: direct bridge to the wallet.
- Desktop without the extension: MetaMask Connect can present its QR/install flow.
- Session restoration after page reload is attempted with `eth_accounts` from the MetaMask Connect provider.

The DApp still signs **only in the user's MetaMask wallet**. No seed phrase, private key, backend signer or custody layer was added. `@metamask/sdk` is deliberately not used because it has been superseded by MetaMask Connect.

MetaMask Connect analytics are disabled in source. CSP allows only the relay WebSocket required for remote MetaMask Mobile connections plus the configured Monad RPC origins. The MetaMask connection UI needs inline Shadow-DOM styles, so generated CSP contains `style-src 'self' 'unsafe-inline'`; scripts remain `script-src 'self'`.

A secondary **Open in MetaMask** link uses MetaMask's official dapp deeplink form. The main **MetaMask** button is the preferred path because Connect automatically selects extension, QR or mobile deeplink based on the environment.

### Real blockchain event history

`src/lib/events.ts` reads contract logs directly through Monad RPC. It does not use browser transaction history as the source of truth.

- PLAY: `PlaySubmitted`, `PlaySettled`, `RewardClaimed`
- Curve SELL: `ProtocolSellSubmitted`, `ProtocolSellSettled`, `ProtocolSellCancelled`
- P2P asks/bids: created, filled and cancelled events for both sides
- MON pull-payment credits/withdrawals

Wallet history is synchronized from the deployment block. The first sync:

1. uses `DEPLOYED_AT` to locate the deployment block by binary search unless `VITE_DEPLOYMENT_BLOCK` is set;
2. scans `eth_getLogs` with adaptive block ranges;
3. filters the wallet at indexed topic positions;
4. stores a local checkpoint;
5. re-scans a reorg buffer on the next sync before continuing forward.

The local cache is only a performance checkpoint. Current asset/order state is re-read from the contract.

### Portfolio + My Orders

The Portfolio tab reconstructs candidate positions from wallet events and then verifies them with V4 state:

- pending PLAY orders via `getCurveOrderState()`;
- pending protocol SELL orders via `getCurveOrderState()`;
- unclaimed rewards via `claims()`;
- open P2P asks via `p2pSellOrders()`;
- open P2P bids via `p2pBuyOrders()`;
- wallet METOK and `withdrawableMon` credit.

This prevents stale event data from being treated as an active position after an order has already settled, filled or been cancelled.

### Production transaction safety

Every write path goes through `src/lib/write.ts`:

1. force/switch wallet to chain 143;
2. verify RPC chain ID;
3. verify bytecode exists at the configured address;
4. verify `owner() == address(0)`;
5. verify fixed total supply is 100B METOK;
6. simulate the exact transaction;
7. let the user's EIP-1193 wallet sign;
8. wait for the receipt;
9. record only UX metadata/hash in the local Transaction Center.

No private key, seed phrase or signing secret is handled by this application.

### Full V4 custom-error decoding

All custom errors declared by `METOK_V4.sol` are included in the frontend ABI and decoded from revert data when available. This includes deadline, Entropy, FIFO, ownership, P2P, accounting and slippage errors.

### RPC health + ranked failover

`VITE_RPC_URLS` accepts comma-separated public endpoints. Read/simulate traffic uses viem `fallback(..., { rank: true })`. The Security tab separately probes every configured endpoint for:

- HTTP/RPC availability;
- chain ID = 143;
- latest block;
- latency.

Use at least two independent production RPC providers. Do not put a secret that must remain private into a `VITE_*` variable.

## Install / run

```bash
cp .env.example .env
npm install
npm run validate
npm run typecheck
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Development:

```bash
npm run dev
```

## Security header generation

Before every build, `prebuild` runs:

```bash
npm run security:headers
```

It builds CSP `connect-src` from the configured RPC origins and writes:

- `public/_headers` for Cloudflare Pages;
- `public/_redirects` for SPA fallback;
- `vercel.json` for Vercel headers/SPA rewrite.

If you change RPC endpoints, regenerate and commit `vercel.json` before a Vercel deployment.

## Validation

Run:

```bash
npm run validate
```

The source validator checks the pinned contract/chain, immutable V4 constants in the reference source, simulate-before-write, no approve path, contract identity checks, full custom errors, event index coverage, reorg buffer, adaptive log scan, portfolio state verification, Web Crypto randomness and RPC health/failover surfaces.

## Supply-chain note

Dependency versions in `package.json` are exact. This archive does not claim a successful registry install because the build sandbox could not reach npm reliably. On the first trusted machine/Termux/CI run, execute `npm install`, review the resulting dependency tree, commit `package-lock.json`, then use `npm ci` for reproducible production builds.

See `SECURITY.md` and `LAUNCH_CHECKLIST.md` before publishing a real-money frontend.
