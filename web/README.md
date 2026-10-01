# Guestbook frontend

The frontend for the deployed Guestbook and LaunchToken contracts. Vite, React, TypeScript and viem produce a static site with no application server. The app reads entries without a wallet; a connected browser wallet can approve exactly the signing fee and permanently record a UTF-8 message. Signing burns tokens. It also exposes Uniswap v4 buy/sell flows and the token's transfer, approve, burn, transferFrom and burnFrom actions.

## Install and run

Use Node.js 22.18+ (worker: 24.21.0) and npm. From the repository root:

```sh
cd web
npm ci
npm run build
npm run preview -- --host 127.0.0.1
```

The production export is `../dist/`, including `index.html`, bundled assets, implementation ABI JSON, the attested pool key and the generated deployment manifest. Vite uses `base: './'`; all assets and runtime configuration resolve relative to the entrypoint, including at a gateway subpath. Serve using HTTP(S); opening `index.html` with `file://` is unsupported because the app fetches JSON. There are no server routes, remote font dependencies, analytics, secrets or private RPC URLs.

`npm run dev` starts Vite for source development. Run `npm run build` first, then copy `dist/imd-deployment.json`, `dist/abi/` and `dist/pool-key.json` into `web/public/` if development needs deployment reads; remove those temporary public copies before the final build. Alternatively use production preview during development. The committed `public/` contains only the favicon.

## Configuration and deployment provenance

`web/deployment/handoff.json` and `web/deployment/network.json` preserve the supplied public inputs for reproducible builds after the pinned read directory is removed. They are build inputs, not a second runtime address map. `src/config.ts` fetches **the exported `imd-deployment.json`** and the ABI paths it names, verifies their SHA-256 inventory and canonical Keccak ABI hashes, and creates the clients from that configuration. The app does not import the build handoff or hard-code deployed addresses.

The export script compares `docs/abi/<Contract>.json` byte-for-byte with `git show <sourceCommit>:docs/abi/<Contract>.json` and verifies the attested hashes. Keep the pinned source commit in local Git history when rebuilding. ABIs are the supplied implementation-derived raw JSON arrays; no contracts are rebuilt or redeployed by the frontend task. Original contract source remains unchanged.

The mandatory manifest schema forbids extra top-level fields, while the lower-priority reference requests `poolKey`. To preserve the actual pool without violating that schema, `dist/pool-key.json` copies the entire handoff pool key and is included in the manifest's hashed asset inventory. The runtime loads and hash-checks that file. The exact handoff trading fee and initialization guard are retained; the admission fee in the nested launch manifest is not used for swaps.

`npm run build` writes the manifest **after** the Vite export. It includes all other export files, the exact contract set, source commit, attestation hash and unchanged `network`/`walletAddChain` objects. `npm run check:export` independently rechecks this inventory and the pinned ABI binding. Do not hand-edit `dist/`; rebuild after source or configuration changes.

## Wallet and transaction behavior

- Supports injected EIP-1193 browser wallets through `window.ethereum`. No WalletConnect project ID was supplied; remote/mobile WalletConnect and multi-wallet discovery are not configured. Open the page in a wallet's browser when appropriate.
- Wrong-chain wallets get one network-switch control. Error 4902/unknown chain triggers the supplied `wallet_addEthereumChain` object, then switches again.
- Reads use the supplied public RPC list in order, with a connected wallet fallback only on the correct chain. Reads verify chain ID, nonempty deployed code and the guestbook's immutable token binding. Failure disables transaction controls.
- Each complete read uses one block number for a coherent view. Reads refresh every 15 seconds while visible, on request and after receipts. There is no polling overlap within a read effect. The interval trades some latency for a bounded public-RPC load.
- All writes simulate before a wallet signature; the account/network is checked again after simulation. One write can be in flight at a time. The active action keeps its own label and stays locked until confirmation; an unresolved receipt keeps writes locked and offers an explicit receipt check and explorer link.
- Guestbook allowance is exact, and refreshed onchain before exposing signing. The form counts UTF-8 bytes, requires acknowledgment of permanence and burn cost, and preserves drafts after rejection. Onchain strings render as escaped text.
- Quotes use `simulateContract` against the configured Uniswap quoter. Swap commands are `0x10`, with actions `0x060c0f`, the exact pool key, input amount, slippage minimum and five-minute deadline. Quotes expire after 60 seconds; amounts, direction, account and chain changes invalidate them. Configured protocol code, pool initialization/liquidity and input balance are checked first.
- Native input sends its exact value and needs no approval. ERC-20 input explicitly approves its exact amount to Permit2, then grants the router that amount for 30 minutes; each step is shown only when short and requires a refreshed quote after confirmation. Router execution is simulated.
- Addresses are checksummed, copyable and linked to the configured explorer. ENS registry configuration was not supplied, so no names are inferred. Token decimals come from reads. USD context is explicitly unavailable because no price source was supplied.

## Validation

```sh
npm run typecheck
npm run build
npm run check:export
npx playwright install chromium
npm test
npm run check:rpc
```

`npm test` serves the actual export under `/preview/`, controls a real headless browser and intercepts RPC/wallet requests with deterministic fixtures. It does not send real transactions. The server and browser are closed by the bounded script. `npm run check:rpc` performs read-only checks of all three supplied RPCs and saves evidence.

The router encoding was cross-checked against the [official Uniswap v4 swapping guide](https://developers.uniswap.org/docs/protocols/v4/guides/swapping/swapping), using only the addresses from the supplied network data. Run `node scripts/audit-package.mjs` to check changed paths, excluded artifacts and a conservative complete-tree Git bundle size; its temporary repositories/bundles are confined to `test/scratch/`.

For this restricted worker, dependencies were installed with `--cache ../test/scratch/npm-cache`. The installed browser was used as follows:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/imd-worker/.cache/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell \
PLAYWRIGHT_LOW_RESOURCE=1 npm test
```

The low-resource option launches a fresh single-process browser per fixture. Ordinary environments can run `npm test` after Playwright's browser installation. Evidence is written under `docs/evidence/`. `node scripts/preview-review.mjs` provides a separate, bounded 180-second preview for interactive review and prints its selected URL. There is no dependency on `test/scratch/` in the built frontend.

See [validation](../docs/VALIDATION.md) for actual outcomes and limitations, and [implemented design](../docs/DESIGN.md). Social title/description and favicon are included; absolute social image/URL metadata awaits the publisher's final hostname. Publishing, IPFS pinning, named URLs and real funded transactions are outside this worker task.

## Scope and packaging

Only `web/**`, `dist/**`, `docs/**` and the explicitly budgeted `web/.gitignore` are delivered. The root `DESIGN.md` request conflicts with the overriding path budget, so its content is delivered at `docs/DESIGN.md`. No root configuration, Solidity source, libraries, CI files or root lockfiles are changed. Dependencies, caches, screenshots from failed intermediate runs outside the final evidence set, and scratch scaffolding are not runtime assets. `web/.gitignore` excludes generated dependencies/caches at every depth inside `web/`; no other ignore file is modified.
