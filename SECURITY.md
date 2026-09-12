# METOK V4 DApp Pro 5.1 — Security Model

## Trust boundaries

The frontend is non-custodial. Wallet signatures occur only through the EIP-1193 provider exposed by MetaMask Connect (direct MetaMask extension/in-app bridge or its encrypted mobile relay). Never add a seed phrase/private-key form, backend signer, hot key, or `VITE_*` secret that must stay private.


## MetaMask Connect trust boundary

Version 5.1 uses `@metamask/connect-evm` with analytics disabled. On desktop with MetaMask Extension or inside MetaMask Mobile's browser, connection is direct. On a normal mobile browser such as Chrome, MetaMask Connect can open MetaMask Mobile and carry the wallet session through its relay. The DApp never receives wallet private keys.

The generated CSP permits `wss://mm-sdk-relay.api.cx.metamask.io` because remote MetaMask Mobile sessions require that WebSocket. It intentionally does **not** permit the MetaMask analytics endpoint because analytics are disabled. MetaMask's web connection UI injects Shadow-DOM styles at runtime, which requires `style-src 'unsafe-inline'`; JavaScript remains restricted to `script-src 'self'`.

## Contract identity gate

Before every write the DApp verifies:

- RPC chain ID is 143;
- bytecode exists at the configured V4 address;
- `owner()` is zero;
- total supply is exactly 100,000,000,000 METOK;
- the exact transaction simulates successfully.

Runtime monitoring also exposes `tokenBucketsBalanced()` and `monAccountingSolvent()`.

## Event-index model

Wallet Portfolio and My Orders use blockchain logs to discover relevant order IDs, but event cache data is never sufficient to authorize an action. Current V4 mappings are re-read for pending curve orders, claims and P2P orders. The event synchronizer re-scans a 256-block buffer to reduce stale state after a short reorg.

## RPC model

Use multiple independent HTTPS RPC providers in `VITE_RPC_URLS` for production. Viem fallback ranking handles read/simulation failover while the Security page independently probes endpoint health. A public frontend cannot keep an RPC API key secret; use provider-side origin/domain restrictions and rate limits where available.

## Error handling

The ABI includes every custom V4 error. Revert data is decoded before falling back to generic wallet/network messages. Never suppress an accounting/invariant error and retry blindly.

## Browser/storage

Local storage may contain:

- transaction hashes/status for the Transaction Center;
- wallet event indexing checkpoints;
- block timestamp/deployment-block caches.

It must never contain private keys, seed phrases, signatures intended for replay, or custody secrets.

## Static-host hardening

`npm run security:headers` generates CSP, HSTS, no-referrer, `nosniff`, frame denial and a restrictive Permissions Policy. There are no runtime CDN scripts, remote fonts, analytics or ad pixels in the reference build.

## Before real-value launch

- independently audit the exact deployed V4 bytecode and frontend commit;
- generate and commit a reviewed `package-lock.json`, then build with `npm ci`;
- use two or more production RPC providers;
- test PLAY/Entropy/FIFO, claim, curve SELL, P2P ask/bid and MON withdrawal with small amounts;
- verify CSP after deployment from the actual domain;
- verify `owner() == 0`, supply, token buckets and MON solvency from the production frontend;
- publish the contract address and frontend build commit/hash through an independent channel.
