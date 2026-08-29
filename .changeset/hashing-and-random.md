---
"solve-engine": minor
---

Add hashing and randomness (issues #240, #241).

Two developer-facing utilities, each its own on-by-default, removable package.

## Hashing

Turn a piece of text into its digest, the short fixed-length fingerprint a
download page means by "SHA-256 checksum". Written as functions, answering
lowercase hex.

| expression | result |
| --- | --- |
| `sha256("hello")` | `2cf24dba…938b9824` |
| `sha1("hello")` | `aaf4c61d…aea9434d` |
| `md5("hello")` | `5d41402a…1017c592` |
| `crc32("hello")` | `3610a686` |

`sha512` is the longer SHA-2 member. The implementations are pure and
synchronous (no Node `crypto`, no async Web Crypto), so a digest is an ordinary
value produced on the spot and works unchanged in the browser worker; each is
pinned against its canonical vectors. `md5` and `sha1` are offered for
compatibility and are documented as no longer collision-resistant.

## Randomness

Everyday random helpers, the companion to the dice package's dice-notation rolls.

| form | gives |
| --- | --- |
| `uuid` | a random version-4 UUID |
| `random hex 8` | 8 random hex digits |
| `pick("a", "b", "c")` | one option at random |
| `shuffle [3, 1, 2]` | the list in a random order |
| `coin` | `heads` or `tails` |

These draw fresh each run, so the randomness page carries no proven example
values (it is listed, with a reason, in the docs example suite's `unprovable`
map, the same treatment as dice).

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks, and the docs example suite (the
hashing page's digests are proven live). New tests:
`packages/hash/Hashes.spec.ts`, `packages/hash/HashEngine.spec.ts` and
`packages/random/Random.spec.ts`.
