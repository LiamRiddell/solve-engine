---
"solve-engine": patch
---

The comparison chains and the per-kind builtin refusals move out of the VM's dispatch loop, which shrinks from 54,504 to 44,222 bytes of bytecode

V8 stops optimising a function whose bytecode is longer than 61,440 bytes, and `executeBytecode` in `vm/VM.ts` is one large function: when it last crossed that line the VM ran about three times slower (#575). It had grown from 46,468 to 54,504 bytes over one pull request, and most of the growth was one type check written six times. The four ordering operators were four copies of one chain with a different operator, `==` and `!=` two copies of another, and each recent batch (IPv6 addresses, lists carrying a unit) added its branch to every copy. The chains now live in `vm/Comparisons.ts`, one module-level function per family (`valuesEqual`, `valuesOrdered`) called from each case after its plain-number fast path, which stays inline. The date, IPv6, colour and text refusals a builtin's arguments can carry are one call (`builtinArgumentRefused`), and `as number` and the base conversions call one helper each.

| `executeBytecode`, Node 22.22.2 | before | now |
| --- | --- | --- |
| bytecode length | 54,504 | 44,222 |
| under V8's 61,440-byte ceiling by | 6,936 | 17,218 |

Nothing a reader sees changes through the move itself; the colour and IPv4 fixes that ride on it are described in their own entries.

The boundary. The list-with-a-unit check at the head of `+`, `-`, `*` and `/` stays in the loop: it is already a call guarded by one type test, which keeps the common two-number case from paying for a call it does not need.

## Verification

`FoundBug_comparisonHelpers.spec.ts` holds 43 tests: twenty-nine lines through the six operators (exact fractions, bigints a digit apart, quantities in two units and in two measures, lists cell by cell, IPv6 addresses, NaN both ways), a faulted operand through each, the unit tests of `orderHolds`, `orderHoldsFor`, `valuesEqual` and `valuesOrdered` with ordinary, boundary (negative zero, infinities, NaN, two quantities within tolerance) and hostile arguments (a fault, a pending value, a colour, an address), and the adversarial cases: prototype words compared with the prototype checked, a thousand comparisons in one document, values from the lines above through both document passes, and every numeric edge under every operator. The bytecode length was measured by the `lint:dispatch-size` method, by hand, since that script's own Jest run finds no spec in a worktree.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 25,315 tests in 753 suites: 25,309 passed and 4 were skipped. The two failures were existing specs this change reaches: `Issue828_vectorFunctionChecks.spec.ts` expected a date given to `float` to be refused as "This calculation", and it now names `float`, so the assertion was updated; `Issue642_unitNamedVariableAfterSlash.spec.ts` showed the new text check reading the unit a rate carries as text, so the rate path now checks the value alone. Both, the new specs, the hardening, integration and proven docs suites were rerun and pass (9,960 tests). `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed.
