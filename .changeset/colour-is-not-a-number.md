---
"solve-engine": patch
---

A colour in arithmetic, a numeric function, an order or a conversion to a form of a number is refused by name

A colour is three channels and an opacity, and a colour value reports 0 when anything asks it for a number, so every path that read one took that zero: `#ff0000 + 2` answered 2, `sqrt(#ff0000)` answered 0 and `#ff0000 < 3` answered true. Each is a confident answer to a question the colour cannot answer. A colour is now refused with `COLOUR_ARITHMETIC` wherever a number is wanted, at the same shared checks that refuse an IPv6 address with `IPV6_ARITHMETIC` (`hasNoNumber`, `noNumberRefused` and `noNumberArithmeticRefused` in `vm/VMConversion.ts`, `colourArgumentRefused` in `vm/VMBuiltins.ts`), and the message points at reading one channel out as a number.

| line | before | now |
| --- | --- | --- |
| `#ff0000 + 2` | 2 | A colour cannot be added: it is three channels (red, green and blue), not one number. To use one channel as a number, read it out first, as in red(#3366cc). |
| `sqrt(#ff0000)` | 0 | A colour cannot be given to sqrt: ... |
| `#ff0000 < 3` | true | A colour cannot be put in order: ... |
| `#ff0000 + 10%` | 0.10 | A colour cannot be added: ... |
| `~#ff0000` | -1 | A colour cannot be used in this arithmetic: ... |
| `#ff0000 as number` | 0 | A colour cannot be read as one number: ... |
| `#ff0000 in binary` | 0b0 | A colour cannot be written in binary: ... |
| `#ff0000 +/- 1` | 0 ± 1.0 | A colour cannot be given a tolerance: ... |
| `red(#3366cc) + 1` | 52 | 52 |

The same tolerance check now refuses an IPv6 address too: `fe80::1 +/- 1` answered NaN ± 1.0 and now says an IPv6 address cannot be given a tolerance.

The boundary. What the colour package gives a colour meaning for is kept: `==` and `!=` compare the channels (`#ff0000 == rgb(255, 0, 0)` is true, and a colour never equals a number), `as hex`, `as rgb` and the other formats re-tag it, unary `+` leaves it as it is, and the colour functions (`lighten`, `mix`, `red`, `contrast`) are unchanged. A colour met by a quantity keeps the refusal that names the unit (`QUANTITY_NON_NUMERIC`), and the aggregates keep their own. `check` does not compare two colours (it says they cannot be compared), which is an honest refusal left as it is. The colours page gains a section saying a colour is not a number, with proven examples.

## Verification

`FoundBug_colourArithmetic.spec.ts` holds 51 tests: the three lines that exposed it, thirty more paths that read a number off a colour, what a colour still means, the unit tests of `colourRefused`, `hasNoNumber`, `noNumberRefused`, `noNumberArithmeticRefused`, `colourEqual`, `colourArgumentRefused` and `builtinArgumentRefused` with ordinary, boundary and hostile arguments, and the adversarial cases: prototype words holding a colour with the prototype checked, look-alike and markup-shaped text beside a colour, a zero-width space inside the literal, a long sum of colours, a colour from the line above through both document passes, and every numeric edge against a colour. `COLOUR_ARITHMETIC` is in the catalogue, its snapshot and the reachability spec, and `guide/error-codes.md` is regenerated.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 25,315 tests in 753 suites: 25,309 passed and 4 were skipped. The two failures were existing specs this change reaches: `Issue828_vectorFunctionChecks.spec.ts` expected a date given to `float` to be refused as "This calculation", and it now names `float`, so the assertion was updated; `Issue642_unitNamedVariableAfterSlash.spec.ts` showed the new text check reading the unit a rate carries as text, so the rate path now checks the value alone. Both, the new specs, the hardening, integration and proven docs suites were rerun and pass (9,960 tests). `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed.
