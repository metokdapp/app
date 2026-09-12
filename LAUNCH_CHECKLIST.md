# METOK V4 Pro 5.1 — Production Launch Checklist


## MetaMask cross-platform

- [ ] Chrome desktop + MetaMask Extension connects and restores after reload.
- [ ] Android/iOS Chrome/Safari without injection opens MetaMask Mobile through MetaMask Connect.
- [ ] MetaMask Mobile in-app browser connects directly.
- [ ] Desktop without extension shows the MetaMask Connect QR/install flow.
- [ ] Chain switch/add lands on Monad Mainnet 143 (`0x8f`).
- [ ] CSP in production allows `wss://mm-sdk-relay.api.cx.metamask.io`.
- [ ] MetaMask Connect analytics remain disabled.
- [ ] `@metamask/sdk` is not present in the dependency tree.

## 1. Freeze inputs

- [ ] Confirm contract address `0xE25AaBa9CBCD0DF6e0b3659c66F1C022a4ED1cf6` on Monad Mainnet.
- [ ] Confirm `owner() == address(0)`.
- [ ] Confirm total supply = 100B METOK.
- [ ] Confirm `tokenBucketsBalanced() == true` and `monAccountingSolvent() == true`.
- [ ] Confirm immutable Entropy endpoint/provider are the expected deployed values.
- [ ] Configure at least two independent production RPC endpoints in `VITE_RPC_URLS`.
- [ ] If known, set `VITE_DEPLOYMENT_BLOCK` to speed first-time wallet event indexing.

## 2. Dependency freeze

On a trusted machine or Termux with working npm access:

```bash
rm -rf node_modules
npm install
npm audit
npm run validate
npm run typecheck
npm run build
```

Review and commit the generated `package-lock.json`. After that use:

```bash
npm ci
npm run validate
npm run build
```

## 3. Functional mainnet smoke test

Use a low-value wallet and small amounts.

- [ ] Connect/switch to chain 143.
- [ ] Security page shows all contract/accounting checks green.
- [ ] RPC Health lists the intended endpoints, correct chain ID and current blocks.
- [ ] PLAY shows live quote + separate Entropy fee; submit a tiny wager.
- [ ] Event History sees `PlaySubmitted`; later sees `PlaySettled`.
- [ ] Winning reward appears automatically in Portfolio and can be claimed.
- [ ] Protocol SELL enters FIFO with minMonOut/deadline and produces MON credit when settled.
- [ ] P2P ask create/fill/cancel does not change curve reserve/price.
- [ ] P2P bid create/fill/cancel does not change curve reserve/price.
- [ ] MON credit withdraw succeeds.
- [ ] Portfolio My Orders matches explorer/current contract mappings.

## 4. Cloudflare Pages

Recommended settings for a static Vite project:

- Build command: `npm run validate && npm run build`
- Build output directory: `dist`
- Environment variables: `VITE_METOK_CONTRACT`, `VITE_RPC_URLS`, `VITE_EXPLORER_URL`, optional `VITE_DEPLOYMENT_BLOCK`
- Use a current Node 22 runtime.

`prebuild` regenerates `public/_headers` from the actual RPC origins. Vite copies `_headers` and `_redirects` into `dist` for Pages.

After deploy:

- [ ] Inspect response headers for CSP/HSTS/nosniff/referrer policy.
- [ ] Deep-link/reload a route and ensure SPA fallback works.
- [ ] Check production domain in at least two wallet browsers.

## 5. Vercel

- Framework preset: Vite
- Build command: `npm run validate && npm run build`
- Output directory: `dist`
- Configure the same `VITE_*` environment variables.

`vercel.json` contains the SPA rewrite and security headers. If you add/change RPC origins, run `npm run security:headers` locally and commit the regenerated `vercel.json` before deployment (or apply equivalent project-level header rules).

## 6. Post-deploy verification

- [ ] Production site loads with no CSP violations in console.
- [ ] Contract link points to the pinned V4 address.
- [ ] Wallet chain switch requests only chain 143.
- [ ] RPC failure of endpoint #1 falls through to another configured endpoint.
- [ ] Contract custom reverts appear as decoded user messages.
- [ ] First Portfolio sync completes; second sync is incremental.
- [ ] Event history is explorer-consistent for sampled PLAY/SELL/P2P txs.
- [ ] Publish frontend commit/build hash and contract address through an independent trusted channel.
