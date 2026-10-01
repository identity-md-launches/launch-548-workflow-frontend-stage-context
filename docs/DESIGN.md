# Implemented Guestbook design

## Overview

A quiet, public guestbook for people reading and leaving permanent onchain notes. The implemented direction uses warm paper surfaces, dark ink, serif display text and a forest-green primary action. It was inferred from the brief; no separate brand direction was supplied. Large introductory type leads into compact live statistics, an entry feed and a signing form. Swaps, token tools and deployment details use native disclosures to keep the primary task clear.

Canonical implementation: `web/src/styles.css`, `web/src/App.tsx`, `web/src/components.tsx`, `web/src/Swap.tsx`, `web/src/TokenTools.tsx`. This document is under `docs/` because the explicit write scope prohibits root `DESIGN.md`.

## Colors

All colors are defined in `styles.css:1` using a compact hex palette and semantic aliases. The page intentionally has one light theme and no theme toggle.

| Semantic token | Value / primitive | Use |
| --- | --- | --- |
| `--color-bg` | `#f4f1e9`, sand-100 | Page background |
| `--color-surface` | `#fcfaf5`, sand-50 | Compose card, controls and disclosures |
| `--color-inset` | `#eae6dc`, sand-200 | Bookplate, disabled buttons and transaction status |
| `--color-text` | `#262e28`, ink-950 | Main text |
| `--color-muted` | `#61675f`, ink-600 | Secondary text and captions |
| `--color-border` | `#d8d4c9`, sand-300 | Structural dividers and panels |
| `--color-control-border` | `#858b81`, ink-450 | Input/textarea/select boundaries |
| `--color-accent` / `--color-focus` | `#244e41`, green-800 | Primary action, links, focus |
| `--color-accent-hover` | `#173b30`, green-900 | Primary hover |
| `--color-on-accent` | `#fcfaf5`, sand-50 | Primary button text |
| `--color-error` | `#a03528`, red-800 | Error text, always accompanied by words |

Measured contrast results and the rendered pairs are in `evidence/browser-results.json`. Selection uses the accent and on-accent tokens. Do not use the structural border token for text or interactive input boundaries.

## Typography

System fonts avoid external loading dependencies. Body stack: Arial, Helvetica Neue, sans-serif. Display stack: Georgia, Times New Roman, serif. Address/hash text uses monospace. The actual installed fallback face may vary by platform; no webfont is shipped.

- Body: 16px (`1rem`), line-height 1.6, weight 400. Buttons/labels: 14px or 13px, weight 600. All text inputs remain at least 16px at the default root size.
- Hero: `clamp(3.4rem, 6.3vw, 5.5rem)`, line-height .99, tracking −.055em; the last word is italic. Mobile overrides to `clamp(2.2rem, 18vw, 3.65rem)` so text enlargement can reflow.
- Section headings: `--text-section: 1.75rem`, line-height 1.25, tracking −.025em. Compose heading: 2.1rem. Empty-state heading: 1.5rem.
- Entry messages: 1.35rem/1.5 serif, maximum 65ch, preserved whitespace, `dir="auto"` and `overflow-wrap:anywhere` for public content.
- Metadata/captions: .6875rem to .8125rem. The 11px floor is limited to short, secondary metadata; important directions, costs, errors and field labels are larger. Captions were checked at normal size and enlarged text, but physical-device readability is not independently verified.
- Numeric values use tabular numerals. Headings balance lines; paragraph copy uses `text-wrap:pretty`. Addresses/hashes wrap instead of hiding full values; shortened feed addresses have full explorer links and copy controls.

## Layout

`.shell` caps content at 1180px and uses 3rem side margins at wide widths. Most internal gaps follow .5rem/.75rem/1rem/1.5rem steps; section gaps are 2–4rem. Logical inline/block properties handle spacing.

The introductory grid has flexible text and a 320px decorative bookplate. `.workspace` has a flexible feed, a 385px compose column and a 4rem gap. Below 68rem, shell margins become 1.5rem, the compose column 350px and the gap 2rem. Below 52rem, content is one column in DOM reading order, feed before compose. The “Leave your note” anchor provides a direct path to the form. Below 36rem, shell margins are 1rem, the bookplate and secondary footer text are hidden, metadata wraps, and controls remain inset.

Mobile statistics use auto-fit columns with a 5rem minimum (bounded by container width); they stack as text grows. Header, summaries and field-foot rows wrap. No fixed-height text panels or sticky overlays obscure the form. Rendered reflow was checked at 1440, 820, 390 and 320 CSS pixels, including 200% root text enlargement at 320px. Native browser zoom is a separate unperformed check.

## Elevation & Depth

The interface is mostly flat: hairline structural dividers separate notes and sections. `.compose` has a subtle `0 4px 20px #262e2805` shadow. The decorative bookplate has an inset outline and a static 3-degree rotation, not an animation. There are no modal overlays, floating action bars or background images.

## Shapes

Panels use an 8px radius, buttons 6px, fields 5px. The bookplate uses `50% 50% 4px 4px`. The status dot is circular and decorative; adjacent text names the network. Form controls have a visible 1px control border; focus uses a 3px outline with 4px offset. The forced-colors rule uses system `Highlight`.

## Components

| Component/pattern | Source | Behavior and reuse |
| --- | --- | --- |
| `AddressLink` | `components.tsx` | Checksummed explorer link, optional compact display, named copy button and status. Full address is retained in accessible name/title. |
| `Gate` | `components.tsx` | Connect control, wrong-chain/read prerequisite explanations, then action. `primary` is used only for the main compose flow. |
| Compose form | `App.tsx` | UTF-8 counter, inline oversize error, exact cost/balance, consequence checkbox, sequential approve/sign button; preserves draft on errors. |
| Entry/feed | `App.tsx` | Number, signer, UTC date, escaped message, newest-first ordering, explicit older-note pagination and empty/loading/error states. |
| Swap | `Swap.tsx` | Native details disclosure, pressed direction buttons, amount/slippage fields, simulated quote, minimum/rate, expiry and separate approval actions. |
| Token tools | `TokenTools.tsx` | Native details and select, action-specific address fields, explicit confirmation, all token write methods. |
| Deployment details | `App.tsx` | Contract links, hashes, read block/status, manifest and faucets. Full long values wrap. |
| Transaction status | `App.tsx` / `useGuestbook.ts` | Persistent action label, simulation/signature/pending/confirmed/error state, explorer link and unresolved-receipt retry. |

Native buttons, labels, checkboxes, selects and details keep their keyboard behavior. The first focus stop is a skip link that becomes visible on focus and stays clipped otherwise. `:focus-visible` is shared. Only button press/hover transitions exist: 120ms and scale .96, guarded by `prefers-reduced-motion:no-preference`. There is no entrance animation. Loading states retain named action text; unavailable controls use native `disabled` with adjacent explanations.

## Do's and Don'ts

- Start new surfaces with `.shell`, a semantic section heading and the existing spacing rhythm. Reuse `.panel`, `.hint`, `.error`, `AddressLink` and `Gate`.
- Reserve `.primary` for the signing journey; secondary tools use neutral buttons. Keep confirmation wording explicit about burns and permanent storage.
- Keep amounts in token-specific units and read decimals. Never invent USD pricing or contract state for presentation.
- Preserve long public text with escaping and wrapping. Do not render message HTML, remove keyboard outlines, hide errors in transient toasts, or add address maps to presentation components.
- Add future routes only if they remain compatible with a plain static export. For another page, retain the header/footer patterns, tokens and typography, and repeat the deployment verification before offering writes.

Design knowledge: Jakub Krehel's Better Interface, pinned MIT adaptation; documentation method: Paul Bakaus's Impeccable, pinned Apache-2.0 adaptation. See `better-interface-LICENSE.txt`. Ethereum interaction guidance: Austin Griffith's ethskills, pinned MIT adaptation; see `eth-frontend-ux-LICENSE.txt`.
