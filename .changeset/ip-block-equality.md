---
"solve-engine": patch
---

Two IPv4 blocks are equal only when their prefixes are, as two IPv6 blocks already were

`192.168.1.0/24 == 192.168.1.0/25` answered true. Two IPv4 values fell through the equality operators to their numbers, which are the 32-bit address alone, so the prefix vanished; two IPv6 values compared address, prefix and zone. Both families now compare the same way (`ipEqual` in `vm/VMConversion.ts`): two IP values are equal when their family, address, prefix and zone all are, and an IP value never equals anything else, so an IPv4 address no longer equals the plain number it reads as, just as `fe80::1 == 1` was already false.

| line | before | now |
| --- | --- | --- |
| `192.168.1.0/24 == 192.168.1.0/25` | true | false |
| `192.168.1.0/24 != 192.168.1.0/25` | false | true |
| `192.168.1.1 == 192.168.1.1/32` | true | false |
| `192.168.1.1 == 3232235777` | true | false |
| `192.168.1.1 as int == 3232235777` | true | true |
| `2001:db8::/32 == 2001:db8::/48` | false | false |

A bare address and the one-address block around it are now unequal in both families, since `2001:db8::1 == 2001:db8::1/128` was already false: they are written differently and one says it is a block.

The boundary. Only `==` and `!=` change. Ordering an IPv4 address is unchanged: it still orders by its 32-bit number (`192.168.1.1 < 192.168.1.2` is true), where an IPv6 address against a number is refused, since only IPv6 has no exact number to order by. An IPv4 address in arithmetic still reads as its number, as `as int` shows. The networking page gains a section on comparing addresses and blocks.

## Verification

`FoundBug_ipBlockEquality.spec.ts` holds 22 tests: the line that exposed it beside its IPv6 counterpart, twelve lines on which the two families now agree, IPv4 ordering and arithmetic unchanged, the unit tests of `ipEqual` with ordinary, boundary (a bare prefix, prefix 0, the two families at the same bits) and hostile arguments (a number, text, a colour, a zone named `constructor`), and the adversarial cases: prototype words holding a block with the prototype checked, look-alike and markup-shaped text on the other side, a thousand comparisons in one document, blocks from the lines above through both document passes, and the numeric edges against an address.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 25,315 tests in 753 suites: 25,309 passed and 4 were skipped. The two failures were existing specs this change reaches: `Issue828_vectorFunctionChecks.spec.ts` expected a date given to `float` to be refused as "This calculation", and it now names `float`, so the assertion was updated; `Issue642_unitNamedVariableAfterSlash.spec.ts` showed the new text check reading the unit a rate carries as text, so the rate path now checks the value alone. Both, the new specs, the hardening, integration and proven docs suites were rerun and pass (9,960 tests). `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed.
