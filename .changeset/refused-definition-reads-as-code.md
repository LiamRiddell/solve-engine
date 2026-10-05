---
"solve-engine": patch
---

A function definition the engine refuses is no code to the language service either: `f(x) = x + prev` is not read as code, as compiling it refuses it

`readExpressionTokens` tells a host which words of a line are code (which `tax` is a variable, which `line 3` is a reference), and settles it the way compiling does, with no side effects: the parser first, then the statement shapes compiling runs (a running total, a bare assignment, an equation). The parser refuses `f(x) = x + prev` (a body that reads lines) and `f(x) = x + weather in London` (a body that waits for data), and the statement reading then took each for an equation, since both sides of its `=` parse on their own, so the language service read as code a line that does not compile (found in testing). Compiling never stores a line that opens with a call as an equation (the scalar-equation grammar declines it and the parser decides it), so the statement reading now declines it too, through the same test (`opensWithCall` in `engine/EquationShape.ts`). A definition that compiles to a refusal is no code, as `24:00` is none; what `ReadExpressionTokensAgreement.spec.ts` pins is that the two readings agree, and compiling is the reference.

| line | read as code before | now | compiles |
| --- | --- | --- | --- |
| `f(x) = x + prev` | yes | no | no |
| `f(x) = x + weather in London` | yes | no | no |
| `sin(x) = 0.5` | yes | no | no |
| `f(x) = 2x` | yes | yes | yes |
| `x^2 - 4 = 0` | yes | yes | yes |

The boundary: the evaluated answer of every line is unchanged; only the language service's reading of a refused definition moves, so a host no longer underlines its words as variables. The reader still sees the definition's own refusal, which says what to do.

## Verification

`FoundBug_refusedDefinitionReadsAsCode.spec.ts` holds 24 tests: refused definitions and a call-opened equation that neither reading takes as code, definitions and statements that both do, the refusals through `evaluateExpression` and `evaluateLine`, both document passes agreeing; unit tests of `opensWithCall` (ordinary: a name or a function and its bracket; boundary: a bracket first, a product, one token, none; hostile: inherited names as token types, fifty thousand brackets); and the adversarial cases (prototype words as the function with `Object.prototype` unchanged, a long body and two hundred parameters in time, markup-shaped and look-alike text in the body, a definition typed toward its refusal agreeing at every keystroke, the edit that passes the value in, every numeric edge, whitespace, a trailing comment and CRLF). `ReadExpressionTokensAgreement.spec.ts` gains the three lines. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, the docs example specs, the language specs, the hardening and integration specs, and the whole fast suite.

On top of main, the full suite ran 36,308 tests in 879 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,803 tests.
