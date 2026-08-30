---
"solve-engine": minor
---

Index the normalizer's rules by the shape they match, and measure the stage.

Normalising a token stream tried every registered rule at every position. With
the built-in packages that is 57 rules, and the existing `startTokenTypes` hint
did not narrow it: only thirteen rules carried one and all thirteen named
`IDENT`, the commonest token in prose, so an identifier was a candidate for 53
of the 57 and a number for 45. Rules now declare the shape they match and the
normalizer intersects those declarations, which takes a position from 55
candidate rules to 9.

## Declaring a shape

A rule states what the tokens from its match position onward may be, one slot
per position, by type and by value:

```ts
// 9:00am, 16:00 — a clock time is a number followed by a colon
shape: [{ types: ["NUMBER"] }, { types: ["COLON"] }]

// sha256("hi") — a known word followed by an opening parenthesis
shape: [{ types: ["IDENT"], values: HASH_NAMES }, { types: ["LPAREN"] }]
```

The second slot is what the older hint could not express. Every rule firing on a
bare number declares the same start type, so start type alone leaves them all
candidates at every number; what separates them is the token after it, a colon
opening a clock time where a slash opens a network address. The value axis does
the same job for the call-fusion rules, which share a start type and are told
apart only by the word.

`startTokenTypes` still works and means what it always did. `shape` supersedes
it, and 50 of the 57 built-in rules now carry one.

## What it costs to reject a position

Each declared slot becomes a flat array of rule bitmasks indexed by token type
id. A position ANDs them and walks the surviving bits, so one instruction tests
32 rules and the common answer, that nothing can fire here, costs a few array
loads rather than a call per rule.

Measured against 2.16.0, which had already bucketed rules by their first token:

| normalising | 2.16.0 | now |
| --- | --- | --- |
| 500-line document | 1.384 ms | 0.664 ms (2.1x) |
| phrase fusion | 7.4 µs | 2.9 µs (2.6x) |
| plain arithmetic | 5.3 µs | 2.4 µs (2.2x) |
| implicit multiplication | 12.6 µs | 5.9 µs (2.1x) |
| unit conversion | 4.1 µs | 3.1 µs (1.3x) |

Bucketing by first token could not separate these: every rule that fires on a
bare number declares the same start type, so they all stayed candidates at every
number. The second slot is what tells them apart, a colon opening a clock time
where a slash opens a network address.

One case is slower. `callFusions`, added in 2.16.0, already collapses the seven
`name(` rules into a single map lookup, which beats seven separately indexed
rules; call fusion measures 1.3x slower here and the two designs want combining.

## Compiling

`build()` runs once per compiled expression and was attaching an empty `Map` to
every program for a field nothing populates, plus an empty array and an empty
typed array for programs that emit no strings or numbers. Dropping the map and
sharing frozen empties cut parse-and-compile by 17% to 34% depending on the
expression, most on short ones where the fixed cost dominated.

A document of complex expressions parses about 17% faster end to end. A document
of ordinary mixed content is unchanged, which is what the stage split predicts:
normalising is now 19% of the pipeline, so halving it moves the total very
little.

## Errors stopped capturing stack traces they never needed

A recoverable `EngineError` is a value, not a fault: a line of prose is not an
expression, so parsing it fails, and that failure is the answer for the line. It
was nonetheless capturing a full JavaScript stack, twice, once in the `Error`
constructor and again to trim one frame from it.

Capturing a stack costs more the deeper the stack is, and the throw sits about a
dozen frames down inside a document pass, so each cost around 62 microseconds. A
250-line document built 74 of them. A CPU profile put the error constructor at
**46% of the whole pipeline**, more than lexing, normalising, parsing and
executing together.

| document | before | now |
| --- | --- | --- |
| 200 lines of prose | 11.04 ms | 2.48 ms (4.4x) |
| 1000 lines, warm | 44.07 ms | 21.35 ms (2.1x) |
| 250 lines, warm | 8.80 ms | 5.06 ms (1.7x) |
| 200 complex expressions | 4.97 ms | 3.65 ms (1.4x) |

An error that is not recoverable is a genuine fault and still captures a full
stack. `EngineError.captureRecoverableStacks = true` restores them for the rest
while debugging.

## Number literals

Parsing `144` ran six `startsWith` checks, two regular expressions, a locale
lookup and a `split`/`join` that allocated whether or not the separator was
present. A profile put that path at over a third of parse-and-compile. One
character scan now settles the common shapes, the locale's separators are read
once per parser rather than once per literal, and `reset()` no longer clears
collections that are already empty.

Parse-and-compile CPU fell 54% on a fixed workload.

## Ordering the guards

Separately, four rules tested an expensive condition before a cheap one.
`isInsideRangeContext` walks back to the start of the line to decide whether a
position sits inside a matrix literal, and the three time-literal rules called it
as their first statement, ahead of the test for whether the token was a number at
all: a line of prose with no digits paid three backward walks per word, and the
cost grew with the square of the line length. Implicit multiplication likewise
lower-cased the next token's text before checking the current token's type.

Reordering is safe in one direction and this is that direction: each of these
guards only ever declines a match, so testing it later among a run of declining
guards cannot change a result.

## The stage that was not being measured

The pipeline throughput benchmark built its token stream without the normalizer,
so its per-stage breakdown described a four-stage pipeline in three numbers.

| stage | reported | measured before | now |
| --- | --- | --- | --- |
| Lex | 30.1% | 11.5% | 23.1% |
| Normalise | not measured | 51.2% | 27.5% |
| Parse and compile | 58.8% | 22.9% | 34.2% |
| Execute | 11.2% | 12.6% | 15.3% |

Normalising was the largest stage in the pipeline and was invisible. A new
`normalizer` benchmark suite now covers it directly, with a committed baseline.
The lines-per-second figures in the same file were computed per millisecond, so
every recorded one read a thousand times slower than the run had been.

## The boundary

This narrows which rules are tried, not what they do. Rule bodies, priorities and
first-match-wins are unchanged, and a rule declaring no shape is still tried
everywhere, which is why seven procedural rules (unbounded scans, a mutable
user-unit table) keep the candidate floor above zero. The multi-pass fixpoint and
the per-pass array allocation are untouched and are the next targets.

## Verification

`npm run verify` passes: 8,169 tests across 373 suites, including the 613 proven
documentation examples, plus the build, the packaged smoke test and the
bundled-consumer tree-shaking contract.

Two specs guard the index specifically, because behaviour parity alone cannot
tell a working index from one that admits everything. `NormalizerIndexFidelity`
runs every rule unfiltered over a corpus and asserts the index admits every
position a rule really matches, then asserts the indexed and unindexed walks
agree token for token; a new `ignoreRuleIndex` option exists for that comparison.
`NormalizerIndexSelectivity` asserts the candidate count actually falls, which is
the failure the older hint had: it was correct, and it filtered nothing.
