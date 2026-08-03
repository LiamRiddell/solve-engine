---
"solve-engine": patch
---

Document the engine lifecycle contract.

Call `clear()` when you are finished with an engine that has parsed a document.
Dropping the last reference to it is not enough on its own: the async batcher is
reachable from the module-level data query service, so a parsed engine stays
retained until `clear()` releases it.

Measured per engine after a forced collection: 8.2KB constructed, 128KB after
`parseDocument`, 10KB after `clear()`. A host creating one engine per document
reaches roughly 1.2GB over 10,000 cycles without it.

No behaviour changed. `clear()` already did the right thing and still does; what
was missing was anything telling you to call it. The contract is now on the
`ExpressionEngine` class documentation and in the package README, with the
measured figures, and a test asserts both the cleared and uncleared paths so
neither can drift unnoticed.
