---
"solve-engine": patch
---

A variable named like a unit is divided by after a slash: with `t = 5`, `100 / t` is 20

`t`, `d`, `s`, `h` and `m` are among the commonest variable names, and each is also a unit symbol. After a slash with no number after it, the engine read one as a rate's unit however the document defined it, so `100 / t` with `t = 5` was a hundred per tonne while `100 * t` and `100 / (t)` read the variable (#642). The rule that fuses `/ t` into a rate reads the text alone and cannot know which names are defined, so the choice is now made when the line runs: a variable of that name defined above the line is divided by, and otherwise the rate is built as before.

| document | before | now |
| --- | --- | --- |
| `t = 5` then `100 / t` | 100.00 /t | 20 |
| `distance = 120`, `t = 2`, then `speed = distance / t` | 120.00 /t | 60 |
| `s = 2` then `100 / s` | 100.00 /s | 50 |
| `h = 4` then `100 / h` | 100.00 /h | 25 |
| `kg = 2` then `10 / kg` | 10.00 /kg | 5 |
| `f(t) = 100 / t` then `f(4)` | 100.00 /t | 25 |
| `100 / t` with no `t` defined | 100.00 /t | 100.00 /t |

The division is the ordinary one: `100 / t` gives what `100 / (t)` gives for any value of `t`, a quantity, money or a list included. Both document passes agree, and because the answer now depends on another line, the dependency graph records the name as a read: typing `t = 5` above the line, changing it or deleting it changes the line's answer in a live editor, as it does for any other variable. Renaming `t` carries `100 / t` with it where `t` is defined above it; a `100 / t` above the definition is still the unit, so a rename leaves it alone.

The boundary: a unit written before the slash keeps the rate whatever the name holds, as variables.md documents that a unit after a value is a unit. With `h = 4`, `$15 / h` is still 15.00 USD/h, `60 km / h` 60.00 km/h and `100 per h` a rate, since the word `per` says rate in so many words. A variable defined below the line is not read, as with any variable, and `100 / t` on its own, with no document to define `t`, is the rate. The capitals `N`, `W`, `J`, `K` and `F` were already left to the variable reading and are unchanged.

The variables page shows both readings with proven examples.

## Verification

`Issue642_unitNamedVariableAfterSlash.spec.ts` has 104 tests: a defined name after a slash for each common unit spelling and the capitals, a function parameter, a global and a quantity in the variable; `100 / t` against `100 / (t)` for fourteen kinds of value, a quantity, money, a list, text and a boolean among them; the forms that keep the rate; the dependency graph's read of the name; `RATE_OR_DIVIDE` in the VM, with a malformed stream and an unregistered rate builtin refused; and an adversarial sweep over eleven names, `constructor` and `__proto__` included. `CrossPathDocumentFeatures.spec.ts` gains 10 tests: both passes agree, a live edit that adds, changes, renames away or deletes the definition changes the line, a rename through the language service carries the denominator where the name is defined above it and leaves it where it is not, and the single-expression path reads the rate. `OperandWidth.spec.ts` compiles `100 / t` into its corpus.

The engine suite is 15,164 tests in 602 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including `lint:units`, the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,528 bytes on Node 24, 13,912 under the ceiling) and the bundled-consumer contract.
