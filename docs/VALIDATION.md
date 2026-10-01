# Worker validation

Date: 2026-10-01. Scope: the frontend, committed-export candidate and documentation for the deployed onchain guestbook. This is worker-produced evidence, not independent certification. The publisher's CID, named-entrypoint and RPC checks have not run here.

## Delivery status and requirement conflicts

Implementation, static export and local validation are complete within the allowed write paths. `dist/index.html` exists with its local assets, runtime manifest and ABIs. The export contains eight inventoried files totaling 570,053 bytes before the manifest. The full source, lockfile and build configuration are under `web/`. No deployed Solidity source, root build configuration, protected library or existing ABI file was changed.

**Git commit is blocked by the workspace:** `git add -- web dist docs` failed with `Unable to create .../.git/index.lock: Read-only file system`. No commit or staging is claimed. The files remain available in the delivered working tree for the contributor publisher to capture. The assignment provides no approval path to make `.git` writable.

Two conflicts were resolved using the user's explicitly overriding rules:

1. Root `DESIGN.md` is outside the permitted paths. The complete design document is at `docs/DESIGN.md`; no root file was created.
2. The mandatory deployment schema says “add no other top-level key”, whereas the background reference asks for `poolKey`. The exact attested key is preserved as `dist/pool-key.json`, covered by the manifest inventory and loaded with a runtime SHA-256 check. The manifest has only the mandated fields, `network` and `walletAddChain`.

The only changed ignore file is the explicitly allowed `web/.gitignore`. Dependencies and caches are excluded recursively within `web/`. No vendored registry, dependency tarballs or submodule was introduced. `test/scratch/` contains only disposable validation scaffolding and is not needed to build or run the site.

Packaging was measured using actual Git bundles in scratch: a complete source/export/evidence tree snapshot plus the original baseline history, conservatively counting duplicate objects twice. Their combined size is approximately **2.75 MB**, below the **8,388,608-byte** limit. `evidence/package-audit.json` records the precise measured bytes and method. The scratch snapshot is only a size check; it does not bypass or replace the blocked task-repository commit.

## Commands and results

Commands below were run on Node 24.21.0/npm 11.19.0, with frontend commands executed from `web/` or through `npm --prefix web`.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS, also rerun as the first build step | `evidence/build.log` |
| `npm run build` | PASS; Vite export then ABI-bound manifest generation | `evidence/build.log` |
| `npm run check:export` | PASS; schema, exact inputs, every asset byte/hash, ABI hashes and pinned Git ABI bytes | `evidence/export-check.log` |
| `npm test` with the installed Chromium executable and low-resource option | PASS, 22 named checks | `evidence/browser-results.json` |
| Axe WCAG A/AA scan of the inspected browser state | Zero reported violations | `evidence/accessibility.json` |
| `npm run check:rpc` | PASS on all three configured RPCs, read-only | `evidence/rpc.json`, `evidence/rpc-check.log` |
| Protected-tree diff | No changes to `src`, existing `docs/abi`, `foundry.toml`, `remappings.txt`, `lib`, `.github` | Local `git diff --exit-code` |

Vite reports a nonfatal warning for the approximately 541 KB main JavaScript chunk; the entire export remains about 570 KB uncompressed. No external font requests or images are required. Source maps and dependency archives are not exported.

The first test launch needed an explicit installed-browser path. Chromium's normal process model exceeded worker thread resources; the test harness provides `PLAYWRIGHT_LOW_RESOURCE=1` and recreates the single-process browser between fixtures. A delayed-receipt fixture initially held the mock block height constant and intermittently timed out; it now advances the block when mining the mock receipt. The final complete suite passed after that repair. One shell invocation used the repository root instead of `web/`; it failed without modifying the root and was rerun with `--prefix web`.

## Interaction coverage

The test serves the actual production export at `/preview/`. Only test code installs mocked wallets/RPCs; no mock fixtures are bundled in `dist/`. It checks:

- Decimal precision and positivity, slippage bounds and sorted ERC-20 pair direction encoding.
- Public latest-note reads, newest-first pagination, zero unsolicited signing requests and empty-state guidance.
- The 280-byte boundary with a 284-byte emoji message, byte counter and inline invalid state.
- Browser-wallet connection, wrong-chain blocking, the unknown-chain fallback, exact chain-add parameters and subsequent switching.
- Exact 10 GUEST guestbook allowance, simulation, signing, receipt confirmation, balance/allowance/feed refresh and literal rendering of HTML-like note text.
- Wallet rejection recovery, simulation revert before wallet submission, account removal and chain-change invalidation.
- Native-input quote/swap, exact ETH value, correct vetted router, V4 command/action encoding and no native-input approval.
- Token-input quote/swap, exact token-to-Permit2 allowance, expiring Permit2-to-router allowance and zero ETH value.
- Quote expiration, minimum output, input direction, advanced transfer/burn/approve/transferFrom/burnFrom controls, invalid address rejection and zero-amount allowance revocation.
- An approval that remains locked between hash submission and delayed receipt confirmation.
- Missing deployed code, all-RPC failure and a tampered ABI asset preventing transaction controls.
- Keyboard skip link, note entry and checkbox activation; viewport/text reflow; axe; rendered contrast.

Final report: **22 PASS checks, zero browser JavaScript errors, zero missing local resource responses**. The mock assertions inspect actual submitted calldata and destinations. They do not establish real-chain execution success.

## Better Interface review

Applied the pinned Better Interface workflow and all six domain core sections while implementing, then consolidated the review below. The Ethereum frontend UX reference informed transaction prerequisites, exact approvals, units and persistent status. Attribution/license texts are retained alongside this document.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native form controls, labels, heading outline, skip link, field errors, live status, keyboard operation, visible focused screenshot and axe. Screen-reader session and physical device interaction not performed. |
| Layout | Checked | Production export at desktop 1440px, intermediate 820px, mobile 390px and narrow 320px; no horizontal overflow. Also 200% text enlargement at 320px. Native 200% browser zoom and a full localized/RTL page variant were not performed. Public messages use direction isolation. |
| Writing | Checked | Verb-first actions, exact burn/approval amounts, irreversible-note acknowledgment, persistent error/retry directions, explicit empty/loading states, unavailable USD context and testnet labeling. |
| Typography | Checked | Rendered hierarchy, system font stacks, 16px fields, realistic long notes, 280-character unbroken text, address wrapping and tabular numbers. Exact physical font availability differs by platform. |
| Colors | Checked | Semantic roles and rendered foreground/background pairs measured; contrast table below. One light theme, no alternate theme requested. Full OS forced-colors and every focus background were not manually inspected. |
| UI | Checked | Primary/secondary hierarchy, native disclosures, filled signing action, visible disabled/pending/confirmed/error states, panel structure and scoped motion. Reduced-motion browser context used. No entrance animation, modal or theme-switch behavior exists; those checks are not applicable. Animation-panel slow playback not performed. |

### Findings, fixes and rechecks

| Severity / domain | Source | Observed finding and correction | Recheck |
| --- | --- | --- | --- |
| High / layout | `web/src/styles.css:144` | 320px with 200% root text produced horizontal overflow. Header/summaries now wrap, the hero size adapts, statistics use auto-fit minimums and field metadata wraps. | Production browser assertion passes; overflow element list is empty; `text-enlargement.png`. |
| Medium / accessibility | `web/src/styles.css:131` | A fixed skip link positioned above the viewport appeared in a scrolled full-page capture. It is now clipped unless focused, preserving keyboard access. | Final live mobile capture no longer shows the hidden link; `keyboard-focus.png` shows its visible outline when focused. |
| Medium / colors | `web/src/styles.css:7`, `web/src/styles.css:80` | Original input boundary `#93988e` against `#fcfaf5` measured 2.83:1, below 3:1. Replaced with semantic control-boundary token `#858b81`. | Rendered border measures 3.35:1; test asserts the threshold. |
| Medium / UI | `web/src/components.tsx:16` | Expanding swap while disconnected showed two filled connect actions. `Gate` now takes an explicit primary flag used only by compose. | Final mobile expanded-swap screenshot shows one filled primary action. |
| High / transaction state | `web/src/Swap.tsx:27` | Source review found a pending quote could outlive an account/chain/input change. A context ref now discards the response; execution also checks the actual clock for expiry. | Source review plus browser account/chain invalidation and expired-quote checks pass. A precisely delayed async quote/account race is not separately injected. |

### Measured rendered contrast

Computed foreground/background values come from the inspected production browser. Ratios use the WCAG sRGB luminance formula; they are not visual estimates.

| Pair | Ratio | Threshold |
| --- | --- | --- |
| Secondary copy on page | 5.15:1 | 4.5:1 |
| Primary text on compose surface | 13.39:1 | 4.5:1 |
| Primary button label/fill | 8.98:1 | 4.5:1 |
| Hint text on compose surface | 5.57:1 | 4.5:1 |
| Error text on page | 6.13:1 | 4.5:1 |
| Input boundary on surface | 3.35:1 | 3:1 |
| Focus color on surface | 8.98:1 | 3:1 |

`evidence/browser-results.json` contains exact values. The focus ratio is a color-pair measurement; the focused skip link was also visually inspected. This is not a claim that every focus position or every possible application state received a manual contrast audit.

## Browser evidence

The provided browser tool inspected the live-read export at 1440×1100 and 320×900. Production files were served by a bounded foreground preview, then the browser navigated to a blank page. The tool owns browser shutdown. Automated tests close their browser and preview server.

- `live-desktop.png`, `live-mobile.png`: real public-RPC data, empty guestbook, no connected wallet; mobile has the swap disclosure open. Both were recaptured after the final CSS changes.
- `desktop.png`, `viewport-1440.png`, `viewport-820.png`, `viewport-390.png`, `viewport-320.png`: deterministic mocked entries and interaction states, not real authors or signatures.
- `keyboard-focus.png`: visible skip-link focus.
- `text-enlargement.png`: 200% root text at 320 CSS pixels, distinct from native browser zoom.
- `empty-no-wallet.png`, `rpc-error.png`: controlled empty/error scenarios.

## Live-chain findings and untested behavior

All three configured endpoints reported chain 11155111 and nonempty code for both deployed application contracts, all six configured Uniswap contracts and the attested pool guard. The immutable guestbook token matched LaunchToken. The read-only guestbook was empty. The pool was initialized with an LP fee of 12,500 and **zero current active liquidity** at the recorded check. The frontend explains the unavailable liquidity when a connected visitor requests a quote and keeps swap execution unavailable without a usable quote.

No live approval, signature transaction, token transfer/burn or swap was broadcast. Real funded wallet signing, fee estimation across wallet brands, hardware wallets, WalletConnect, transaction repricing/cancellation on a real network and liquidity changes are untested. Receipt-timeout recovery is implemented but its full 180-second timeout and replacement branches were not browser-tested. Tests exercised the ordinary delayed-confirmation lock.

No USD oracle, ENS registry configuration or WalletConnect project ID was supplied. Absolute social image/URL metadata awaits a publishing hostname. IPFS pinning, named hosting and immutable/named HTTP checks are publisher responsibilities and are not claimed here. A passing local accessibility scan is not a certification of accessibility compliance.
