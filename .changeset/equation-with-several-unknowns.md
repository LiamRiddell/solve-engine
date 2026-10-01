---
"solve-engine": patch
---

An equation on a line of its own with several unknowns is refused by name, saying how to write it, rather than failing at its `=`

An equation line is stored under its one unknown, the one name in it with no value, and asking for that name with the arrow solves it. With two or more unknowns there is no telling which one a later arrow means, so the line is not stored, as the solving-equations page says. It fell through to the ordinary parse, which stops at the `=`: Calca's `(salary / 12) * rate / 100 = net` answered `Expected an operator or the end of the line, but found "="`, and `rate =>` on the next line answered `rate` (found while collecting the other-apps parity corpus). The line is now refused by name with a new code, `EQUATION_SEVERAL_UNKNOWNS`, listing the unknowns and the two ways to write it: give the others values on the lines above, which leaves one, or name the unknown with `solve`.

Supporting the line was weighed and not done. Storing it under every unknown would turn every `a + b = c` line, a parse error until now, into a stored equation. The refusal is the smaller honest change, and the two forms it points at already answer.

| line | before | now |
| --- | --- | --- |
| `(salary / 12) * rate / 100 = net` | Expected an operator or the end of the line, but found "=" | This equation has 3 unknowns, salary, rate and net, and an equation on a line of its own is solved for its one unknown. Give the others values on the lines above it, or name the one to solve for, as in solve((salary / 12) * rate / 100 = net, salary). |
| `x + y = 10` | Expected an operator or the end of the line, but found "=" | This equation has 2 unknowns, x and y, and an equation on a line of its own is solved for its one unknown. Give the others values on the lines above it, or name the one to solve for, as in solve(x + y = 10, x). |
| `salary = 60000`, `net = 1000`, the equation, `rate =>` | `20` | `20` |
| `y = 3`, `x + y = 10`, `x =>` | `7` | `7` |
| `2 km + x = 5 km` | Expected an operator or the end of the line, but found "=" | unchanged |

The boundary: only names count as unknowns, so a unit after an amount (`2 km`) is not one, and a unit word standing alone (`b`, `h`) is, as the arrow reads it. The `=` must stand outside every bracket and each side must read as an expression of its own, so a line whose side does not parse keeps the error it had. A product of names (`a*b*c = 10`), a function definition and a bare assignment own their `=` as before. Calca's own line, with names of several words, still does not parse (`(yearly salary` is read as a bracket holding one word, and `tax percent` holds the keyword `percent`); it stays a recorded gap in the other-apps parity spec. One existing test, `ScalarEquation.spec.ts`'s "two unknowns decline", pinned the old parse error and now asserts the refusal.

## Verification

`FoundBug_equationWithSeveralUnknowns.spec.ts` holds 73 tests: the reported line through every entry point, its code and suggestion, the two forms it offers answering, each shape refused naming its unknowns, a one-unknown equation unchanged and the shapes that own their `=`; unit tests of `namesSomething`, `isTopLevel`, `typedText`, `nameList` and `severalUnknownsRefusal` (ordinary, empty, out of range, more names than are listed, prototype words); and the adversarial cases (prototype words with `Object.prototype` unchanged, two hundred unknowns refused in time with the list summarised, the length limit first, deep brackets, text edges, markup, a value given below the equation, a unit beside the unknowns, a side that does not parse, a name of several words, a what-if and a goal seek, every numeric edge, an empty side, CRLF and padding). `CrossPathDocumentFeatures.spec.ts` gains the refusal through `evaluateLine`, `parseDocument` and `evaluateDocument`, their agreement once the others have values, and a live edit that turns the refusal into a stored equation; `AdversarialFeatureSweep.spec.ts` gains `(salary / 12) * rate / X = net`, `x + y = X`, the equation left with one unknown over the numeric edges, and the prototype-word form.

The fast suite ran 29,604 tests in 806 suites with this batch's four fixes (29,599 passed, 5 skipped, none failed), and `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the docs, hardening and integration suites (11,522 tests in 101 suites), the two lexer fuzz suites (331 tests) and the dispatch-loop size check (45,759 bytecode bytes, read with the script's own command run by hand) passed. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.
