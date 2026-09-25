---
"solve-engine": minor
---

Eight faults a host meets at the engine's edges: a defined function takes over its name, a promise from a plugin never settles, a restored snapshot calls the wrong function, and five smaller ones

These are the survey's host-facing faults (#658 to #665): each is something an embedding application, a package author or a worker host runs into, rather than a reader typing a line.

**`defineFunction` no longer claims its name everywhere (#659).** The name was registered as a lexer keyword, which is unconditional, so with `price` defined every other use of the word stopped parsing. It is now a call word, the built-in `sha256(` shape: the call only where `(` follows, never after `:`, matched without regard to case.

| with `price` defined | before | now |
| --- | --- | --- |
| `price(100)` | = 120 | = 120 |
| `:price = 5` | Expected identifier or unit after colon, got DEFINE_FN_PRICE | = 5 |
| `price * 2` (after `:price = 5`) | Expected token type "LPAREN" but got "STAR" | = 10 |
| `price: 3` | Expected token type "LPAREN" but got "COLON" | = 3 |

The call highlights as a function and appears in completion with its signature (`price(x: number): number`). A name the engine already reads as something else, a unit (`kg`), a keyword (`in`) or a built-in function (`sqrt`), could never become the call, so registering it is refused with `PLUGIN_CALL_FUSION_UNREACHABLE`; that refusal applies to any package's `callFusions`, and `createEngine` logs it and carries on without the package. Two packages declaring the same call word for different tokens now raise a `callFusionName` compatibility warning; the later one is in force, as before. Building the adversarial cases found a second fault underneath: plugin-function names are engine-wide, so a defined function called `sum`, `average` or `count` took over the tags package's function of that name, and `total of #a` failed, while defined and after it was removed. A defined function's internal name is now prefixed, and unregistering any package hands a shared plugin-function name back to the previous claimant instead of deleting it for both.

**A plugin function's promise settles (#660).** A handler may return a promise, and the engine awaited it only to learn that it had settled; the re-run called the handler again, got a new promise, and the line stayed pending for good. The settled value is now kept under the call's key, the function and each argument's type, value and unit.

| `slowdouble(21)`, a handler resolving after 20 ms | before | now |
| --- | --- | --- |
| through the documented `lines-updated` loop | still pending after 16 evaluations, 31 handler calls | = 42 on the second evaluation, two handler calls in all |

Once the promise has settled, the re-run asks the handler once more, because handlers read the contract two ways. One stores what it fetched and answers the re-run itself, as the historical exchange rate does; that answer is used, as before. One with no store of its own returns another promise, and is answered with what the first one settled to and not called again for that argument list. A re-evaluation while the promise is in flight, or a second line with the same arguments, shares the one call. A rejection settles to `PLUGIN_CALL_FAILED` with its message, and a promise resolving to something that is not a value to `PLUGIN_RESULT_NOT_A_VALUE`. A settled answer is kept for the engine's life (a thousand calls at most) and dropped when its package is unregistered: a raw handler has no refresh and no retry, which is what `createQueryResolver` is for. A synchronous handler builds no key and pays nothing.

**A restored snapshot relinks its plugin calls by name (#658).** A plugin function's index is handed out process-wide in registration order, and a snapshot carried bytecode with those indices baked in, so the same packages in another order, or another engine registered first, ran another function. Snapshots are now format version 2: each call a compiled program makes is recorded by package and function name, and `fromJSON` points it at that function on the restored engine.

| restored in another process | before | now |
| --- | --- | --- |
| `zbeta(21)`, packages passed as `zbeta, zalpha` | = 1,021 (`zalpha`'s answer) | = 42 |
| the `zalpha` package left out | `zalpha(21)` = 42 | refused: `SNAPSHOT_PACKAGE_MISSING` |

A version 1 snapshot still restores: it names no calls, so its cached lines that call a plugin function are left out and recompile when next evaluated. A call compiled with a one-byte index that the restoring engine holds past 255 is left out the same way, since it cannot be widened in place.

**The internal worker offload no longer re-runs lines without their variables (#661).** When live data landed and more than fifty lines depended on it, the batcher sent their bytecode to the internal execution pool, whose workers hold none of the document's variables or packages. With a worker factory registered, every `price * qty` came back as "Undefined variable: price". A re-run of any size now stays on the main thread, and answers as it does with no factory (`$33.00` for the survey's document). Compilation still moves to the worker; performance.mdx says so and no longer claims execution does.

**The worker DTO carries an error's code (#662).** `5 kg in m` crossed the worker boundary as its message alone. `SerializedWorkerValue` has an optional `errorCode` (`INCOMPATIBLE_UNITS`), set only on an error, so a host branches on the code rather than the words. `EventTargetLike` accepts a DOM `Worker`, a `DedicatedWorkerGlobalScope` and a `MessagePort` under `strict`, where the guide's `eventTargetTransport(worker)` used to fail to compile, and it and `MessagePortLike` are exported.

**A replayed parse error has its own span (#663).** The engine remembers a text that failed to parse, and replayed the error first thrown, span included. `3 + * 4` evaluated on its own after a document had held it on line 4 reported line 4, offset 22; it now reports line 1, column 5, as a fresh engine does, and each replay is its own error object.

**`editLine` compares the text, not only its hash (#664).** djb2 gives `ab` and `bA` one hash, so editing `total = ab * 2` to `total = bA * 2` returned false and kept `= 6`; it now returns true and gives `= 200`. A worker's compile result is checked against the line's text as well, and `isBytecodeValid` takes the text as an optional third argument.

**The snapshot guide says what `toJSON` leaves out (#665).** It said a variable holding a symbolic value makes `toJSON()` throw. It never did: a symbolic value, a colour, a bill split, a chart or an IP subnet has no snapshot form yet, and the variable or cached line holding one is left out, undefined on the restored engine until the document is re-evaluated. The docs and doc comments now say so, and a spec pins it.

What these do not cover: package-contributed state in a snapshot, serialising symbolic values, cancellation or refresh for a raw plugin handler, and the compile offload's own worker path. The per-engine plugin-function index allocator is part of the 3.0 work; relinking by name is what makes its order irrelevant to a snapshot.

## Verification

A spec for each issue pins its before/now lines and adversarial cases: a snapshot restored in a separate Node process with the packages reversed, with one missing and after another engine registered first; a hand-edited snapshot; a promise that never settles, one that rejects and one that resolves to something that is not a value; djb2 collision pairs through editLine and the worker boundary; a DOM Worker, a worker scope and a MessagePort type-checked under strict with the DOM and WebWorker libs; and a defined function named after a unit, a keyword, a built-in and another package's call word. The full suite is 14,001 tests in 579 suites, all passing (four skipped), and `npm run verify:ci` passes, including `lint:dispatch-size` (47,481 bytes on Node 24, 13,959 under the ceiling), the three-zone `test:temporal` run and the bundled-consumer contract.
