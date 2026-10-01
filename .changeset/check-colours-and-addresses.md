---
"solve-engine": patch
---

A check compares two colours or two IP addresses the way `==` and `!=` do

`check #ff0000 == rgb(255, 0, 0)` and `check 192.168.1.0/24 != 192.168.1.0/25` were refused with "cannot be compared", while the operators answered both. A check read only numbers, quantities, text and true or false, and a colour or an address is none of them. A check between two colours or two IP values is now decided the way the operators decide it (`identityCheck` in `packages/conditionals/CheckFunctions.ts`, reading `valuesEqual` and `valuesOrdered`): two colours are equal when their channels are, two addresses when their family, address, prefix and zone are, and addresses of one family are in order as `<` puts them. A number written in a base is checked on its digits too, so `check ((2^100 + 1) in hex) > 2^100` passes where it was refused the same way.

| line | before | now |
| --- | --- | --- |
| `check #ff0000 == rgb(255, 0, 0)` | check: #ff0000 and rgb(255, 0, 0) cannot be compared | ✓ |
| `check 192.168.1.0/24 != 192.168.1.0/25` | check: 192.168.1.0/24 and 192.168.1.0/25 cannot be compared | ✓ |
| `check 192.168.1.1 < 192.168.1.2` | check: 192.168.1.1 and 192.168.1.2 cannot be compared | ✓ |
| `check fe80::2 <= fe80::1` | check: fe80::2 and fe80::1 cannot be compared | check failed: fe80::2 is more than fe80::1 |
| `check #ff0000 < #00ff00` | check: #ff0000 and #00ff00 cannot be compared | check: a colour has no order, so two colours can only be compared with == or !=, not < |
| `check 192.168.1.1 < fe80::1` | check: 192.168.1.1 and fe80::1 cannot be compared | check: an IPv4 and an IPv6 address have no order between them, so they can only be compared with == or !=, not < |

The boundary. Ordering stays refused where the operators have none: a colour has no order, and an IPv4 and an IPv6 address have none between them. A margin (`≈`, `within`) is refused between two colours or two addresses, which are either the same or not. A colour or an address against a plain number is still refused as incomparable, although `192.168.1.1 == 3232235777` answers false, since a check states something about two things of one kind. The checks page gains a section on colours and addresses.

## Verification

`FoundBug_checkColoursAndAddresses.spec.ts` holds 28 tests: the lines that exposed it, fourteen checks each asserted beside the operator that answers the same question, the refusals by name, a colour or an address against a number, a number in a base, the unit tests of `identityCheck` (ordinary, boundary at each ordering operator and prefix 0, hostile operators named `constructor` and `__proto__`) and of `hasExactSide`, and the adversarial cases: prototype words holding blocks with the prototype checked, look-alike and markup-shaped text, a thousand checks in one document, values from the lines above through both document passes, and the numeric edges against an address and in a colour's channel. The adversarial sweep gains the new forms. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 25,703 tests in 757 suites: 25,699 passed and 4 were skipped, the proven docs examples, the hardening and integration suites among them. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, and `executeBytecode` measures 44,086 bytecode bytes on Node 22 (`lint:dispatch-size` measured by hand, since its spec is ignored inside a worktree).
