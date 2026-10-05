---
"solve-engine": patch
---

A numeric function given text refuses it by name rather than reading it as zero

Every numeric builtin reads its arguments as numbers, and text read as a number went through its leading digits: `sqrt("abc")` answered 0, `round("3.5")` answered 4 and `gcd("a", 4)` answered 4. The cause was shared by every builtin, so the fix sits at the one check the VM makes before any of them runs (`builtinArgumentRefused` in `vm/VMBuiltins.ts`), which now refuses text with `TEXT_ARITHMETIC`, as arithmetic on text already does, and points at `as number`. `int`, which reads text on purpose, now reads only text that is a number (`intOfText` in `vm/PlainNumberForms.ts`), where `int("abc")` answered 0.

| line | before | now |
| --- | --- | --- |
| `sqrt("abc")` | 0 | sqrt takes a number, not text. To use a number held as text, convert it first with "as number". |
| `round("3.5")` | 4 | round takes a number, not text. ... |
| `gcd("a", 4)` | 4 | gcd takes a number, not text. ... |
| `ln("abc")` | ln(0) has no real value ... | ln takes a number, not text. ... |
| `"abc" to 2 dp` | 0.00 | This calculation takes a number, not text. ... |
| `int("abc")` | 0 | "abc" is not a number: int reads text that is a number and nothing else. |
| `int("2.7")` | 2 | 2 |
| `sqrt("16" as number)` | 4 | 4 |

A refusal from `ln`, the two-argument `log` and `float` now names the function, as every other function called by name does; they said "This calculation" before.

The boundary. Text is refused only where a builtin reads a number. The builtins that read text as text keep it: the algebra verbs handed the name of an unknown (`solve`, `der`, `integral`, `taylor`), the phrase forms handed a unit's name (`12.5 minutes in minutes and seconds`, `3 hours / day`, a savings goal's period, a count's label) and `float`, which already read only text that is a number. `min`, `max` and the aggregates keep their own refusal for a value with no numeric reading. Text that holds a number is not read for the reader, which is the same choice arithmetic makes: `as number` is the conversion, and the message says so. The number functions page gains the proven examples.

## Verification

`FoundBug_textInNumericBuiltins.spec.ts` holds 31 tests: the line that exposed it, twelve more builtins at the same cause, the builtins that keep text, `int` reading only text that is a number, the unit tests of `textArgumentRefused`, `calledByName` and `intOfText` with ordinary, boundary and hostile arguments (an empty text, negative zero, leading digits, digits from other scripts, markup, a long text), and the adversarial cases: prototype words as the text with the prototype checked, every text edge inside the quotes, a long text within budget, text from the line above through both document passes, and a number that is text at 2^53 and past a double's range.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 25,315 tests in 753 suites: 25,309 passed and 4 were skipped. The two failures were existing specs this change reaches: `Issue828_vectorFunctionChecks.spec.ts` expected a date given to `float` to be refused as "This calculation", and it now names `float`, so the assertion was updated; `Issue642_unitNamedVariableAfterSlash.spec.ts` showed the new text check reading the unit a rate carries as text, so the rate path now checks the value alone. Both, the new specs, the hardening, integration and proven docs suites were rerun and pass (9,960 tests). `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed. The full suite then ran 26,925 tests in 767 suites on this branch (26,921 passed, 4 skipped), and `npm run test:temporal` passed its 3,470 tests.
