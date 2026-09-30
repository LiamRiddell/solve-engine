---
"solve-engine": patch
---

The playground's result chips and the docs notepad's answers can be reached without a pointer

The playground's error chip opened its detail on hover alone, on a `span` with no focus handler, so a keyboard or screen-reader user never reached the message, the expected and found tokens or the suggestion; the result chip toggled its line's detail on `mousedown` only; and both surfaces marked a pending value with glyphs (`⟳ ...` and `…`) whose meaning was only in a `title`, if anywhere (#788). A notepad answer cut off by its column was readable in full only through `title`.

| where | before | now |
| --- | --- | --- |
| playground error chip | hover opens, leave closes | a button: hover or focus opens, blur or Escape closes, and `aria-describedby` names the popover |
| playground result chip | `mousedown` on a `span` | a button: click, Enter or Space toggles the line's detail |
| playground pending | `⟳ ...`, "Awaiting async resolution…" in `title` | the glyphs hidden as decoration, "waiting for live data" said and shown on hover |
| notepad pending | `…` announced as is by the live region | the ellipsis hidden, "waiting for live data" announced |
| notepad long answer | full text in `title` only | focusable, and the full text shown under the row while it has focus |

The boundary: colour is not part of this, since the notepad's light-theme answer colours already pass on white, and no engine behaviour changes. The Obsidian plugin's result widget has the same class of fault and is tracked in its own repository.

## Verification

`Issue788_accessibleResults.spec.ts` holds 9 tests reading the two components' source and styles, since neither has a harness in this suite: the focus, blur and Escape handlers, the button chips and their key handling, the popover id and role, the pending words, and the focusable long answer with its full text. The docs site built with the notepad change; the playground has no install on the machine this ran on, so it was not built or type-checked, and its chips were not tried in a browser.

Gates run: `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:links` and `lint:ci-parity` passed; the docs, hardening and integration suites with this batch's specs passed (7,467 tests in 99 suites); the docs site built (`npm run build --prefix docs`). The fast suite ran 21,483 tests in 700 suites: 21,477 passed and 4 were skipped. Of the two failures, `GuideExamples.spec.ts` timed out on one page under load and now runs with no network and a longer timeout, passing on a rerun; `TagAggregateLinearCost.spec.ts` is a timing bound that passes on its own and is untouched by this change. `npm run verify`, `lint:units` and the bundled-consumer contract were not run for this change.
