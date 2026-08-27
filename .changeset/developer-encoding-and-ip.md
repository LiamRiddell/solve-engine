---
"solve-engine": minor
---

Add text-encoding converters and IPv4 subnet arithmetic (issues #188, #189).

Two developer tools that a note used to have to leave for another window: turning
text into a safe transport form, and answering the everyday subnet questions.
Both are new packages, on by default and removable.

## Text encoding

`as` encodes a string and `from` decodes it, so a value can be turned into a form
on one line and read back on the next.

| expression | result |
| --- | --- |
| `"hello" as base64` | `aGVsbG8=` |
| `"aGVsbG8=" from base64` | `hello` |
| `"a b&c=1" as url` | `a%20b%26c%3D1` |
| `"Hi" as hex bytes` | `48 69` |
| `base64("Hello, World!")` | `SGVsbG8sIFdvcmxkIQ==` |

`hex bytes` is two words on purpose: `as hex` already means a number shown in
base 16, so the byte encoding is kept separate and neither reading is ambiguous.
Encoding expects text and reports a non-text input as an error; decoding checks
its input and reports one that is not valid, rather than handing back mangled
text. Multi-byte characters survive the round trip.

## IPv4 subnet arithmetic

An address like `192.168.1.10` names one machine; a subnet like `192.168.1.0/24`
names a block of them, where the `/24` fixes the first 24 bits as the shared
network.

| expression | result |
| --- | --- |
| `hosts in 192.168.1.0/24` | `254` |
| `netmask of /24` | `255.255.255.0` |
| `broadcast of 192.168.1.0/24` | `192.168.1.255` |
| `192.168.1.10 in 10.0.0.0/8` | `false` |
| `10.0.0.0/8 as int` | `167,772,160` |

## The boundaries

- **A dotted address reads as one only when written as a single run.** With
  spaces around the slash it is division, and a plain `10 / 2` is always `5`, so
  the address literal never steals a number from ordinary arithmetic. A part
  above 255 is not a valid address either.
- **IPv6 is a later addition.** Its 128-bit colon-notation addresses need their
  own literal and arithmetic; the dotted-quad IPv4 form covers the common case.
- **Round trips are honest.** An encode followed by the matching decode returns
  the original, and an invalid input is reported rather than guessed.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks, and the docs example suite (the
encoding and subnet examples are proven live on the new text-encoding and
networking pages). New tests: `packages/encoding/Encoding.spec.ts` and
`packages/ip/Ip.spec.ts`, both including the worker-DTO round-trip.
