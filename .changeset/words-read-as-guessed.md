---
"solve-engine": minor
---

Words read the way a reader means them: `7 is prime` asks whether 7 is prime, `add 3 to 10` is 13, `as multiplier` refuses what is not a number, and `asin(0.5) in degrees` is 30 degrees

`prime`, `exponent` and `mul` were English keywords for `^` and `*`, so none of the three could be a name, not even as `:exponent`, and `7 is prime` failed with a token name. `add` is the `+` keyword, so `add 3 to 10` read as `+3 to 10`, the percentage change from 3 to 10. `as multiplier` read its value through the number every value has, which is 0 for text and the bare magnitude for a quantity. And an inverse trigonometric function answers in radians as a plain number, which a conversion to degrees labelled rather than converted (#829).

| line | before | now |
| --- | --- | --- |
| `2 prime 3` | 8 | refused: `prime` is a name |
| `7 is prime` | throws `No prefix parselet found for token: CARET ("prime")` | true |
| `:exponent = 2` | throws `Expected identifier or unit after colon, got CARET` | 2 |
| `add 3 to 10` | 233.33% | 13 |
| `"hello" as multiplier` | 0x | refused: `A multiplier is a plain number or a percentage, as in "0.5 as multiplier" or "50% as multiplier", not text.` |
| `5 km as multiplier` | 5x | refused, naming a length |
| `asin(0.5) in degrees` | 0.52 degrees | 30.00 degrees |

The three aliases are retired from the English keyword map, so each is an ordinary name; `^`, `to the power of`, `*`, `times` and `multiply` are unchanged. `N is prime` is `isprime(N)`, read only when `prime` is the last word of the line. `add A to B` is `A + B` when the word is `add` and a `to` follows its first value; without the `to` the word is the plus sign it was (`add 3 and 4` is 7), a `to` before a unit is still a conversion, and the symbol forms are unchanged (`+3 to 10` and `3 to 10` are still the percentage change). `as multiplier` takes a plain number or a percentage and refuses text, a quantity, money, true or false and a list with `MULTIPLIER_TAKES_NUMBER`. A conversion to an angle unit whose left side opens with `asin`, `acos`, `atan`, `atan2` or their `arc` spellings reads the number as radians first.

The boundary: the radians rule is decided by the call the line starts with, which is what the parser can see, so a name holding the answer (`a = asin(0.5)`, then `a in degrees`) is a plain number and is labelled; `asind` and `radtodeg` answer in degrees for that case. A sentence that contains `is prime` with more after it (`7 is prime number`) is refused rather than answered. The German locale's `exponent` keyword is left as it is, since the issue and this change concern the English words. The operators, number theory, number functions and percentages pages gain proven examples of each form, and the arithmetic and big-integer parselet specs that pinned `2 prime 3` and `2 exponent 3` as 8 now pin them as names.

## Verification

`Issue829_wordsReadAsGuessed.spec.ts` holds 59 tests: the keyword map, the retired words as names and as refused operators, `is prime` on primes, composites, 0, 1, a negative, a sum and a name, with the prose around it refused; `add A to B` with money, a unit, a unit target, the symbol forms and a value from the line above; `as multiplier` accepted and refused for each kind; the inverse functions in degrees, turns and radians against `asind` and `radtodeg`; unit tests of `multiplierRefused`, `namesConversionTarget` and `readsAsRadians`; and adversarial cases from the three sides (prototype words in every position, long and deep operands, look-alike and markup-shaped text, the forms meeting each other through both document passes, and the numeric corpus). The full suite (`npm run test:full`) passed, 20,277 of 20,281 tests in 666 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords`, `lint:error-codes` and `lint:dispatch-size`. `executeBytecode` is 46,034 bytecode bytes on Node 22. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
