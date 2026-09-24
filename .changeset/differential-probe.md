---
---

The differential harness sees a changed value again

The differential harness runs a corpus of expressions through two builds and reports every place they disagree. Its probe built each engine with `new ExpressionEngine("en")`, which since 2.0 registers no package, and read the single Value `evaluateLine` answers as an array of them. Every answer that was not an error therefore recorded as no values, and two builds that disagreed about a number compared as identical. The probe now builds `createEngine()` and records the Value it gets back, and a build with no `createEngine` (1.x) is still probed through its constructor.

Two stand-in builds that differ only in what `1 + 1` answers, run through the probe and the report:

```text
before                    now
identical   2             identical   1
different   0             different   1
signatures  0             signatures  1
                          ── ok:Number -> ok:Number/value  (1)
                             "1 + 1"
```

On the real corpus the difference is the whole point of the tool. Comparing the unit algebra work (#513, #570, #571) with the main build it starts from, over the same 41,429 expressions, the old probe reported 66 differences in 10 signatures, every one of them a change of error message, while the fixed probe reports 193 in 25, among them every changed number and unit: `5 m * 3 m` going from `15.00 m2` to `15.00 m²`, `1 / (2 m)` from `0.50 m` to `0.50 /m`, and `2 kg * 3 kg` from `6.00 kg` to a refusal.

The fuzz batch the harness generates had the same fault: it read its vocabulary off a bare engine. It now reads it off `createEngine()`. `report.mjs --run=<file>` writes `differences.json` beside the run it read, so a run kept elsewhere leaves the last real one alone.

This changes the repository's tooling only; the published package behaves as before.

Fixes #572.

## Verification

A new suite runs the real probe and the real report over two stand-in builds that differ by one known value, and asserts that the value is recorded, that a build without `createEngine` is still probed, and that the report names exactly that one difference; it fails against the old probe. `npm run verify:ci` passes: 11,654 tests across 535 suites, with the bundled-consumer contract.
