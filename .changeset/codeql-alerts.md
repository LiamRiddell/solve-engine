---
"solve-engine": patch
---

Fixed the three open CodeQL alerts.

Both worker `postMessage` handlers (`packages/engine/src/workers/engine.worker.ts` and `packages/playground-bridge/src/engine.worker.ts`) now check the incoming message's origin against the worker's own before trusting `event.data`. A dedicated worker can only ever be constructed same-origin, so this never legitimately rejects a real message, but the handlers previously trusted `event.data` unconditionally. The check is skipped, not enforced, when either side is unset, which covers the test harnesses that drive these handlers directly with a plain object and no `location` global, without opening anything a real message could exploit: a browser-populated `event.origin` cannot be spoofed by the sender.

`scripts/check-comment-style.mjs`'s control-character rule matched the right three ranges (`\x00-\x08`, `\x0B-\x1F`, `\x7F-\x9F`, deliberately excluding tab and newline) but wrote them as literal raw bytes instead of escape sequences, which is invisible in most editors and exactly the class of problem the rule's own doc comment warns about. Rewritten as `\x00-\x08\x0B-\x1F\x7F-\x9F`, with identical matching behaviour confirmed against both the intended control characters and ordinary printable text.
