---
"solve-engine": patch
---

An engine no longer keeps the last document after `parseDocument` returns, or after `clear()`

`clear()` is the call that releases per-document state, and the batch pass releases its shared line context when it ends, but neither released the two fields beside that context that say which pass it was built over, which pointed at that pass's scan and its whole array of results (#766). They are now released wherever the context is: at the end of the batch pass, and in `clear()`, which also releases the third such field, the document model's.

An engine given a 20,000-line document, a third assignments, a third prose and a third reads, heap after forced collection, the engine's source bundled by esbuild:

| heap | before | now |
| --- | --- | --- |
| the engine built, before any document | 10.9 MB | 11.0 MB |
| after `parseDocument` | 59.7 MB | 39.5 MB |
| after `clear()` | 40.8 MB | 15.3 MB |

Measured on a shared Linux container (Intel Xeon at 2.10 GHz, 4 cores, Node 22.22.2).

The boundary: on the incremental path the document-model field points at the evaluator's model, which the evaluator holds while it is attached, so releasing it there frees nothing until the evaluator goes. What a document may hold while it is open is the per-document retention budget's concern; this is what the engine keeps after the document has gone.

## Verification

`Issue766_lineContextReleased.spec.ts` holds 25 tests: neither field holds the scan or the results after `parseDocument`; `clear()` releases all three after an incremental pass; a second document does not reuse the first one's context, so `line 1` reads the new document; a line reference resolves against its own pass across repeated passes; and after 20,000 lines and `clear()` nothing is held. The adversarial cases add a document of prototype words with `Object.prototype` untouched, 2,000 lines and the text edges through both passes, the two passes agreeing on an engine that was reused, a cleared engine answering as a fresh one, a document refused for its size, every document edge, and `clear()` on an engine that never parsed, twice.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 21,148 tests in 683 suites: 21,143 passed and 4 were skipped. The one failure was in `Issue715_benchmarkCorpora.spec.ts`, whose honesty check compared two passes over `now + N days` lines a second apart; that document is now checked without the agreement, which the next case checks with those lines left out, and the new specs were rerun and pass. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, and `executeBytecode` measures 46,468 bytes by the `lint:dispatch-size` method, run by hand since that script's own Jest run finds no spec in a worktree.
