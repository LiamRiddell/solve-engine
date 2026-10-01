---
"solve-engine": patch
---

A new engine with the built-in packages keeps about 130KB less for its whole life, about 295KB where it kept about 427KB, and no answer changes.

The allocation benchmark's 50-line document case read 807,440 bytes on CI against its 786,432-byte budget. Most of the last step came with the ISO 8601 duration parselets (#760), which took the built-in prefix parselets past 256, the size at which a `Map` doubles its table: three maps keyed by prefix token type doubled together, about 21KB per engine. A heap snapshot of ten retained engines then showed where the rest of each engine's cost went, and most of it was state the engine never reads again or held twice:

- The package-compatibility index, a map entry for every parselet, phrase, converter, function and rule name of every package (about 47KB), is only read when a package is registered. It is now released once construction has registered the packages it was given, and rebuilt from the registered packages the first time a later `registerPackage` needs it. It is rebuilt in registration order, so a later registration reports the same conflicts it did before.
- The parselet registry kept a string-keyed copy of each parselet map beside the integer-keyed map the parser reads (about 18KB). A token type's name and its integer ID are one to one, so a lookup by name now translates the name and reads the one map. Asking about a name nothing declared still registers nothing.
- Every leaf of the phrase trie carried an empty children `Map`. A node now gets one only when a phrase continues past it (about 42KB).
- The lists an engine fills once and then only reads, each `as` converter's spellings and each package's record of what it contributed, kept the room a `push` or a spread reserves, about seventeen slots for one element. They are now held at their exact length (about 25KB).

Retained bytes, as the allocation benchmark measures them (`trackRetained`: the heap settled on both sides, the engine still reachable), in one full run of its ten cases:

| case | merge base | before | now |
| --- | --- | --- | --- |
| lexer: simple arithmetic (fresh engine) | 370,880 | 435,464 | 302,960 |
| lexer: mixed expression (fresh engine) | 657,896 | 712,784 | 579,872 |
| parser: cold compile, 3 expressions | 482,304 | 560,824 | 426,616 |
| vm: simple add (fresh engine) | 365,528 | 404,200 | 271,624 |
| normaliser: fresh pipeline | 353,216 | 411,824 | 280,288 |
| document: 50 lines (fresh engine) | 733,872 | 804,744 | 671,088 |
| document: 200 lines (fresh engine) | 1,192,272 | 1,208,536 | 1,041,584 |

Run on its own, which also counts the code the document path compiles on first use, the 50-line case reads 1,095,848 bytes, against 1,228,680 before and 1,170,296 at the merge base. The three warm cases (parser warm, the 200 warm evaluations, the orchestrator's fast path) measure churn on an engine already built and are unchanged. Ten engines built and kept side by side, each after one evaluation, retain 294,643 bytes each where they retained 427,212.

The boundary: nothing a line reads is different, and neither is anything a package author declares. An engine that is handed another package after construction pays for the index again, once, at that registration, and keeps it from then on. The phrase trie is still built per engine rather than shared between engines, because a host can add phrases to one engine, and sharing would need a copy on write that this change does not attempt; it is now the largest single thing an engine keeps (about 100KB). The benchmark's budgets and assertions are unchanged.

## Verification

`__tests__/engine/EngineFootprint.spec.ts` (79 tests) tests each part directly: the exact-length array helpers with empty, edge-valued, prototype-word and hundred-thousand-element lists; the non-registering token-type lookup with unknown, empty, look-alike and prototype words; the parselet registry by name and by ID (registration order, overwrite warning, `clear`, IDs that name nothing, two registries side by side, and every built-in parselet agreeing by name and by ID); the phrase trie's leaves (a phrase that ends where another continues, a shorter phrase added after a longer one, a two-thousand-word phrase, two tries side by side); and the `as` converter registry's case pairs. At the engine, it proves the index is released after construction and rebuilt by a later registration, that a colliding package reports the same conflicts registered later as given at construction, that two engines built side by side keep their own index and registrations, and that a package named with each prototype word registers and unregisters after construction with `Object.prototype` unchanged. The engine-isolation suite (#710), the parser, normaliser, API and engine suites pass unchanged.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 28,669 tests in 796 suites: 28,664 passed, 4 were skipped and 1 failed. The failure was the timing ratio in `Issue735_moneyDigitCeiling.spec.ts` (6.3 against a limit of 5, on a container shared with other work), which touches nothing changed here; that spec passed in full (29 tests) twice when run on its own. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:changeset`, the proven docs examples and the hardening and integration suites passed, and the allocation benchmark passed all ten of its cases.
