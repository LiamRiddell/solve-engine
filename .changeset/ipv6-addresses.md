---
"solve-engine": minor
---

An IPv6 address is a value: `fe80::1` answers `fe80::1`, shown in the agreed short form, and the subnet questions (`hosts in`, `netmask of`, the first and last address, membership `in`) answer for IPv6 blocks as they do for IPv4

An IPv6 address is eight groups of hexadecimal digits joined by colons, with `::` standing for a run of zero groups. The engine never recognised the shape, so a pasted address was read as something else: the labelled-line fallback took `fe80:` as a label and `1` as the expression, and `fe80::1:2` became a clock time today (#748). The shape is now recognised before either reading, by rebuilding the run of source-contiguous tokens as the IPv4 rule does, and read into a 128-bit value held as a bigint, since no ordinary number holds 128 bits exactly. It is shown in the canonical text of RFC 5952: lower case, leading zeros dropped, and the longest run of two or more zero groups written as `::`, the first when two are as long. Every textual form of RFC 4291 is read: all eight groups, `::` at the start, middle or end, an IPv4 quad in the last 32 bits, a zone after `%` (RFC 4007) and a prefix from `/0` to `/128`.

| line | before | now |
| --- | --- | --- |
| `fe80::1` | `1` | `fe80::1` |
| `2001:db8:85a3::8a2e:370:7334` | `7,334` | `2001:db8:85a3::8a2e:370:7334` |
| `fe80::1:2` | today's date at 1:02 AM | `fe80::1:2` |
| `::1` | throws `Expected a name after ":", but found ":"` | `::1` |
| `2001:db8::/32` | throws `"2001:db8" is not a valid time` | `2001:db8::/32` |
| `cafe::1` | `1` | `cafe::1` |
| `fe80::1 + 2` | `3` | refused: an IPv6 address cannot be added, and `as int` gives its number |
| `fe80::1 in binary` | `0b1` | the 128 bits, `0b11111110100…0001` |
| `netmask of /64` | `255.255.255.255` | `ffff:ffff:ffff:ffff::` |
| `netmask of /33` | `128.0.0.0` | `ffff:ffff:8000::` |

The subnet forms answer for IPv6, and two new ones answer for both kinds of address:

```
hosts in 2001:db8::/64                         18446744073709551616
netmask of 2001:db8::/32                       ffff:ffff::
network of 2001:db8:85a3::8a2e:370:7334/64     2001:db8:85a3::
last address of 2001:db8::/32                  2001:db8:ffff:ffff:ffff:ffff:ffff:ffff
network of 192.168.1.10/24                     192.168.1.0
2001:db8::5 in 2001:db8::/32                   true
::ffff:c0a8:101                                ::ffff:192.168.1.1
fe80::1%eth0 in fe80::/10                      true
fe80::1 as int                                 338288524927261089654018896841347694593
fe80::1 == fe80:0:0:0:0:0:0:1                  true
```

`hosts in` an IPv6 block counts every address, since IPv6 keeps back no broadcast address; `broadcast of` an IPv6 block says so and points at `last address of`. A bare prefix longer than 32 is read as IPv6, which also corrects the IPv4 masks the engine used to invent for one. Arithmetic straight on an IPv6 address (adding, negating, a numeric function, comparing with a number, a bitwise operator) is refused by name, `IPV6_ARITHMETIC`, rather than rounded to the nearest double, which would name a different address; two addresses compare with `==`, `<` and `>` on their bits. An IPv4 address and an IPv6 block are refused together by name (`IP_FAMILY_MISMATCH`), as are a prefix past 128 (`IP_PREFIX_OUT_OF_RANGE`, where `2001:db8::/129` threw that `"2001:db8"` is not a valid time) and `broadcast of` an IPv6 block (`IPV6_NO_BROADCAST`). The worker result carries the address as `ipCidr.addr6`, its decimal digits, with its `zone`.

The boundary: only an IPv4-mapped address (`::ffff:0:0/96`) is shown with a dotted quad, as RFC 5952 section 5 recommends; the other embedded forms (`64:ff9b::192.0.2.33`) are shown in hexadecimal. A zone is kept and shown but plays no part in `in`, since it names where an address is used rather than which address it is. A bare `::` is read only with a prefix after it (`::/0`), since on its own nothing tells it apart from two colons, and a bare prefix of 32 or less stays IPv4. A word before `::` that is not hexadecimal (`note::5`, still `5`), a clock time (`12:30`), a timecode and a label (`Note: 5`) keep their readings. A snapshot leaves an IPv6 value out, as it already leaves an IPv4 subnet out.

## Verification

`Issue748_ipv6Addresses.spec.ts` holds 114 tests: the issue's lines, the RFC 5952 display rules one at a time, every subnet form over IPv6 and IPv4, the refusals, the number forms, the hex words and near misses, unit tests of `parseIpv6`, `formatIpv6`, the block helpers, the plugin functions, `readAddress` and the VM helpers (`isIpv6Value`, `ipv6Refused`, `ipv6Equal`, `ipv6Order`, `ipv6Comparison`, `ipv6WholeNumber`, `ipv6ArgumentRefused`, `baseConversionOperand`) with boundary and hostile arguments, the worker DTO through JSON, and adversarial cases from the three sides (prototype words as a zone and a variable, a run of twenty thousand colons, a fifty-thousand-character zone, look-alike and direction-changing characters, markup, typos, a value from the line above, a line reference, a check, a tag, a section, a what-if, an edit in a live evaluator, a snapshot round trip, CRLF and the prefix and address extremes). `Issue748_ipv6Refused.spec.ts` (40 tests) now pins the recognition with the addresses' answers. The adversarial sweep gains IPv6 templates for the subnet forms and the number, and `IPV6_NOT_SUPPORTED`, never released, is retired from the catalogue in favour of the four new codes. The full suite ran 26,753 tests in 762 suites (26,749 passed, 4 skipped), `npm run test:temporal` passed its 3,466 tests, and `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the llms files and the proven docs examples passed.
