---
"solve-engine": patch
---

A builtin is looked up as the registry's own entry, so an index the engine does not hold never reaches a function or an arity rule inherited from `Object.prototype`

The VM called a builtin by its index after reading it from a plain object, the list handling called it for each cell the same way (now through a map of the registry's own entries), and the arity check read its table that way too (found by CodeQL once the call also went through the list handling added in this release, no issue). Nothing in a document can choose that index, but a page that had planted `Object.prototype[250]` would have had it called, and an unregistered index already read an inherited entry in the arity check, which answered `() takes undefined arguments`.

| bytecode | before | now |
| --- | --- | --- |
| `CALL_BUILTIN 250` with a function planted on `Object.prototype[250]` | `() takes undefined arguments` | `UNKNOWN_BUILTIN_FUNCTION`, and the planted function is not called |
| `CALL_BUILTIN 0` (`sqrt`) with two arguments | `sqrt() takes 1 argument, but was given 2 arguments` | unchanged |

The boundary: this is the lookup alone. Which builtin an index names, and what each one does, are unchanged.

## Verification

`VmStackContract.spec.ts` gains 2 tests and `FoundBug_listBuiltins.spec.ts` 1, a unit test of `callBuiltin` with an ordinary, unregistered, negative, NaN and planted index: the planted function is not called and the unregistered index is refused by its own code, and the arity table ignores a planted entry while `sqrt` still reads its own. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:docs`, and the VM, error-code and list-builtin specs.

On top of main, the full suite ran 36,308 tests in 879 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,803 tests.
