---
"solve-engine": patch
---

A check between text and a number says which side is text, and text is quoted in every check message

`check (255 in hex) == "0xFF"` failed with "check failed: 0xFF is not equal to 0xFF", and `check 255 == "255"` with "255 is not equal to 255". A number and a piece of text are two kinds of thing, so the check was right not to pass them, but it showed both sides alike and gave no reason, and `check 255 != "255"` passed on the same grounds. The text branch of `checkComparison` now refuses a pair of text and anything else as `CHECK_INCOMPARABLE`, the way a colour or an address beside a number is refused, naming which side is text and what the other is, and, when the text holds a number written in decimal, how to read it as one (`textCheck`, `kindOfSide` and `quotedText` in `packages/conditionals/CheckFunctions.ts`). Text is quoted in every check message, so `check "a " == "a"` no longer reads "a  is not equal to a".

| line | before | now |
| --- | --- | --- |
| `check (255 in hex) == "0xFF"` | check failed: 0xFF is not equal to 0xFF | check: "0xFF" on the right is text and 0xFF is a number, so they cannot be compared |
| `check 255 == "255"` | check failed: 255 is not equal to 255 | check: "255" on the right is text and 255 is a number, so they cannot be compared. To read the text as a number, write "255" as number |
| `check 255 != "255"` | ✓ | check: "255" on the right is text and 255 is a number, so they cannot be compared. To read the text as a number, write "255" as number |
| `check true == "true"` | check failed: true is not equal to true | check: "true" on the right is text and true is a true or false answer, so they cannot be compared |
| `check "a " == "a"` | check failed: a  is not equal to a | check failed: "a " is not equal to "a" |
| `check "255" as number == 255` | ✓ | ✓ |

The boundary. Two pieces of text still compare with `==` and `!=` only, and pass or fail as before (`check 0.75 as fraction == "3/4"` passes). A refusal is not a failed check, so a host's `checks` count leaves these lines out, as it leaves out any incomparable pair. The conversion is suggested only for text that `as number` reads (decimal digits, with a sign, commas, a point or an exponent), so `"0xFF"` and digits from another script get no suggestion. A bare comparison outside a check is not changed: `255 == "255"` still answers true, which this change leaves for its own decision. The checks page shows the forms.

## Verification

`FoundBug_checkAgainstText.spec.ts` holds 36 tests: the lines that exposed it, the suggested conversion, quoted text in a failure, text that still passes and the reported document through both passes, the unit tests of `kindOfSide` (each kind, and no internal name for any value type), `quotedText` (empty, a lone space, a long text cut by character, prototype words, markup) and `textCheck` (two texts, text beside each other kind under every comparison, when the conversion is suggested, look-alike digits and invisible characters), and the adversarial cases: prototype words as text and as a variable with the prototype checked, markup- and injection-shaped text, every text edge on either side, a long text and a thousand check lines, a number held as text on the line above, a what-if, the host's check count, empty text and negative zero, and CRLF. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 26,876 tests in 776 suites: 26,872 passed and 4 were skipped, the proven docs examples, the hardening and integration suites among them, and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed.
