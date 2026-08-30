---
"solve-engine": minor
---

Route normalizer rules by first token type, and share one call-fusion rule (no behaviour change).

The token normaliser rewrites the token stream between lexing and parsing, and it
tried every registered rule at every token position. Two changes cut that work,
with no change to what any expression evaluates to.

## Bucket rules by their first token type

Most rules only fire on one kind of token (a `NUMBER`, a `UNIT`, a particular
keyword). Each rule now declares that first token type, and the normaliser tries a
rule only at a position whose token matches, skipping it everywhere else. This is
behaviour-identical, since the rule would have matched nothing at those positions
anyway. It drops the average from tens of rule attempts per position to a handful.

## One shared call-fusion rule, via a new `callFusions` field

The `name(` function-call rules (`sha256(`, `length(`, `percentile(`, `ratio(`,
`bmi(`, `pick(`, ...) were seven near-identical normaliser rules, each tried at
every identifier. A new declarative package field,
`IEnginePackage.callFusions`, maps a lower-cased word to the token type to mint
when it is followed by `(`; the engine merges every package's entries into one
map and runs a single rule for all of them. Adding a function is now one map entry
rather than one more rule tried everywhere.

## Result

Parse-heavy paths are faster with no regression. On the benchmark comparison the
syntax-highlighting suite (which re-normalises on every keystroke) is about 16%
faster overall, with individual cases up to 1.6x; the evaluation pipeline and the
diagnostic pipeline improve by a few per cent. Nothing regressed over the
comparison threshold.

For package authors: `callFusions` is documented in the
[recognising phrases and words](/packages/recognising-phrases/) guide, with its
boundary (the plain `word (` shape; anything more stays a hand-written
`normalizerRules` entry).

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks. New test:
`normalizer/CallFusions.spec.ts` (the consolidated fusion, and that unregistering
a package drops exactly its call words).
