---
"solve-engine": patch
---

An IPv6 address is refused by name, rather than answering a number read from its last group: `fe80::1` is `IPV6_NOT_SUPPORTED`, not `1`

An IPv6 address is eight groups of hexadecimal digits joined by colons, with `::` standing for a run of zero groups. The engine has no IPv6 values, and the address shape was never recognised, so a pasted address was read as something else: the labelled-line fallback took `fe80:` as a label and `1` as the expression, and `fe80::1:2` became a clock time today (#748). The shape is now recognised before either reading, by rebuilding the run of source-contiguous tokens as the IPv4 rule does, and the address answers a refusal that names it.

| line | before | now |
| --- | --- | --- |
| `fe80::1` | `1` | `"fe80::1" is an IPv6 address, and only IPv4 addresses and subnets are covered so far.` |
| `2001:db8:85a3::8a2e:370:7334` | `7,334` | the same refusal, naming the address |
| `fe80::1 + 2` | `3` | the same refusal |
| `fe80::1:2` | today's date at 1:02 AM | the same refusal |
| `::1` | throws `Expected a name after ":", but found ":"` | the same refusal |
| `2001:db8::/32` | throws `"2001:db8" is not a valid time` | the same refusal |
| `cafe::1` | `1` | the same refusal |

Every textual form of RFC 4291 and RFC 5952 is recognised: all eight groups, `::` at the start, middle or end, an IPv4 quad in the last two groups (`::ffff:192.168.1.1`), a zone (`fe80::1%eth0`) and a prefix (`/64`).

The boundary: this is the first step the issue names, the refusal. 128-bit IPv6 values, `hosts in`, netmasks and membership are not added. The shape has to be exact, so a clock time (`12:30`), a timecode, a label (`Note: 5`) and a word before `::` that is not hexadecimal (`note::5`, still `5`) keep their readings. A bare `::`, the address of all zeros, is not recognised, since nothing in it tells it apart from two colons. The networking page gains a section on IPv6 addresses.

## Verification

`Issue748_ipv6Refused.spec.ts` holds 42 tests: the issue's lines and the RFC forms, the near misses that must keep their meaning, unit tests of `readIpv6Shape`, `ipv6NormalizerRule` and `ipv6Address` with boundary and hostile arguments (a run of ten thousand colons, digits from other scripts, a zero-width space, prototype words), and adversarial documents through both passes. The adversarial sweep gains the IPv6 templates. The fast suite (`npm run test:ci`), `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and the proven docs examples passed.
