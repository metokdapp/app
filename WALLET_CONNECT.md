# MetaMask connection matrix — METOK V4 DApp Pro 5.1

## Supported flows

| Environment | Expected MetaMask Connect behavior |
| --- | --- |
| Chrome/Edge/Brave desktop + MetaMask Extension | Direct extension connection |
| Desktop browser without MetaMask Extension | MetaMask Connect QR/install flow |
| Chrome/Safari mobile | Deeplink to MetaMask Mobile + encrypted relay session |
| MetaMask Mobile in-app browser | Direct in-app bridge |
| Page reload after an approved session | Restore session and read `eth_accounts` without a fresh approval when possible |

## Monad network

- Chain ID: `143` (`0x8f`)
- Native token: `MON`
- Contract: `0xE25AaBa9CBCD0DF6e0b3659c66F1C022a4ED1cf6`
- MetaMask Connect requests Monad scope and then calls its chain switch/add flow before any write.

## Security properties

- No wallet seed phrase or private key is ever requested.
- MetaMask Connect analytics are disabled.
- Remote mobile sessions require `wss://mm-sdk-relay.api.cx.metamask.io` in CSP.
- Transaction signing still occurs only in MetaMask.
- Every contract write still passes the V4 identity gate and `simulateContract()` before the wallet signs.
- `@metamask/sdk` is not used; version 5.1 uses `@metamask/connect-evm`.

## Manual release test

1. Deploy the built static site over HTTPS.
2. Test desktop Chrome with MetaMask Extension installed.
3. Reload and confirm the session is restored.
4. Test Chrome on Android/iOS without an injected provider; tap **MetaMask** and confirm MetaMask Mobile opens.
5. Return to the browser and confirm the connected address is shown.
6. Open the same public URL inside MetaMask Mobile's browser and connect there.
7. Confirm the network is Monad Mainnet 143 before a write.
8. Submit a very small V4 transaction and confirm the Transaction Center receives the same hash shown by MetaMask.
9. Confirm PLAY/SELL/P2P state and Portfolio update from blockchain state/events, not from wallet-local optimistic state.
10. Verify production response headers contain the generated CSP and HSTS values.

## Local Termux note

MetaMask Connect itself can run on a local Vite site, but mobile app/deeplink behavior is best verified on a public HTTPS URL because the MetaMask app must be able to navigate back to the dapp URL reliably. Use localhost for source/build checks; use a staging HTTPS deployment for the final mobile Chrome test.
