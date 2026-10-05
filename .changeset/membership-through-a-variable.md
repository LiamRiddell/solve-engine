---
"solve-engine": patch
---

An address `in` a variable holding an IP block is the membership test, as it is with the block written out

With `lab = 192.168.1.0/24`, `192.168.1.7 in lab` was refused as "An IP address has no single amount to convert to lab". The parser sends `in` to the membership test only when a block literal follows it, so a name after `in` was always read as a unit to convert into. What a name holds is only known when the line runs, so the conversion now asks first (`membershipThroughName` in `vm/VM.ts`, which reads the variable as a divisor's name is read for `100 / t`): an IP value before `in` and an IP value in the name make the line the membership test the IP package registers.

| line | before | now |
| --- | --- | --- |
| `192.168.1.7 in lab` (`lab = 192.168.1.0/24`) | An IP address has no single amount to convert to lab: only a number or a quantity can be converted. | true |
| `10.0.0.1 in lab` | An IP address has no single amount to convert to lab: only a number or a quantity can be converted. | false |
| `2001:db8::1 in v6` (`v6 = 2001:db8::/32`) | An IP address has no single amount to convert to v6: only a number or a quantity can be converted. | true |
| `5 km in m` (`m = 10.0.0.0/8`) | 5,000.00 m | 5,000.00 m |

The boundary. Only an IP value on the left and an IP value in the name qualify. Any other value after `in` keeps its meaning as the unit, currency or zone to convert into, so a variable that shares a unit's name still converts a quantity into that unit, and a name holding a number keeps the conversion's refusal. A name holding a single address rather than a block is refused by the membership test, as the literal is. One line evaluated on its own has no variable to read and gives the conversion's refusal. The networking page gains a section on a block kept in a variable.

## Verification

`FoundBug_membershipThroughVariable.spec.ts` holds 13 tests: the line that exposed it, IPv6 and an address held by name, a family mismatch and a single address refused by name, a value after `in` that keeps its meaning (a unit-named variable, a number, an undefined name, a literal block), the single-line path, the unit tests of `membershipThroughName` (ordinary, boundary at prefix 0 and /32 and with no registered test, hostile non-IP values and inherited-property names) and the slot it reads, and the adversarial cases: prototype words holding a block with the prototype checked, look-alike and markup-shaped names, a thousand tests against one block, an edit to the block re-answering the line below through the incremental evaluator, a check and an `if` over it, and the numeric and document edges. The adversarial sweep gains the new forms. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 25,703 tests in 757 suites: 25,699 passed and 4 were skipped, the proven docs examples, the hardening and integration suites among them. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, and `executeBytecode` measures 44,086 bytecode bytes on Node 22 (`lint:dispatch-size` measured by hand, since its spec is ignored inside a worktree).

On top of main, the full suite ran 28,105 tests in 786 suites, all passing but 4 skipped once the guide manifest and one docs link followed main's async data source guide (both in this change); `npm run test:temporal` passed its 3,493 tests, and the bundled-consumer contract passed its 27 checks, including 2,092 documented examples.
