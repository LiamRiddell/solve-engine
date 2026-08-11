# Differential harness

Runs a large corpus of expressions through the **last published** build of
`solve-engine` and through the **candidate** build, and reports every place the
two disagree.

## Why this exists

A test suite answers "does what I asserted still hold". Before a release the
question is the other one: **"did anything change that I did not intend"**, and
no assertion can answer it, because the changes worth finding are exactly the
ones nobody thought to write down. The 1.0.0 pass made a dozen deliberate
behaviour changes and around sixty bug fixes; the risk was never the deliberate
ones.

The baseline is an *installed package*, not a git checkout. The tarball is the
artefact a user receives, and comparing two working trees compares two things no
consumer ever ran.

## Running it

```sh
# 1. Baseline: install the last published version into a scratch project.
mkdir -p /tmp/solve-baseline && cd /tmp/solve-baseline
echo '{"name":"b","private":true,"version":"1.0.0","type":"module"}' > package.json
npm install solve-engine@1.0.0            # the version you are comparing against

# 2. Candidate: build the working tree.
cd <repo> && npm run build

# 3. Compare.
node tools/differential/run.mjs --baseline=/tmp/solve-baseline/node_modules/solve-engine/dist

# 4. Read the result.
node tools/differential/report.mjs
node tools/differential/report.mjs --signature="ok:Number -> error:UNKNOWN_TOKEN"
```

Useful flags on `run.mjs`:

| flag | meaning |
| --- | --- |
| `--count=30000` | generated expressions (the rest of the corpus is fixed) |
| `--seed=20260811` | generator seed; the same seed always produces the same batch |
| `--skip-generate` | reuse the last generated batch |
| `--caseTimeout=20000` | how long one expression may take before it counts as a hang |
| `--repeat=false` | skip the self-stability passes (faster, noisier) |

Intermediate files land in `node_modules/.cache/solve-differential/`.

## What the corpus is

Four sources, deduplicated by exact source text:

| source | roughly | why |
| --- | --- | --- |
| documented examples | 270 | what a reader is promised |
| test-suite string literals | 13,000 | every shape somebody cared about, prose included |
| recorded fuzz corpus | 10 | inputs that already broke something once |
| generated expressions | 27,000 | the only source nobody curated |

The generated batch comes from the engine's own grammar-aware fuzzer
(`packages/engine/tools/fuzz/ExpressionFuzzer.ts`), which draws its words out of
a live engine, so a package added next month is covered with no edit here.

Prose literals like `"should add two numbers"` are kept on purpose. Two builds
disagreeing about how to fail on prose is precisely the kind of unintended
change this run exists to find.

## Determinism

Nondeterminism is pinned rather than filtered, because a filter only excludes
the sources somebody remembered. Before the engine is imported, `probe.mjs`
freezes:

- **the clock** to `2026-05-14T12:30:00Z`, via `Date.now` and a `Date` subclass,
  so `today`, `now` and every relative date answer identically in both builds;
- **the timezone** to UTC, in the child's environment, so a run reproduces on a
  machine in another zone;
- **`Math.random`** to a seeded xorshift, so `random` and `roll` draw the same
  sequence on both sides;
- **`fetch`** to a promise that never settles, so currency, weather and stock
  lookups stay `Pending` in both builds and nothing touches the network.

Whatever leaks past that is caught rather than assumed away: each build is
probed **twice**, and any expression that disagrees with itself across its own
two runs is dropped from the comparison entirely and counted as `unstable`.

## Surviving the corpus

The corpus contains inputs designed to break things, so the probe process is
expected to die. It writes the index it is about to evaluate to a progress file
before evaluating it, and appends results a line at a time. The runner watches
that file: a child that exits, aborts on heap exhaustion, or stops advancing for
`--caseTimeout` is killed, the expression it died on is recorded as `FATAL(...)`,
and probing resumes at the next index.

That failure mode is a first-class result. "This input kills the process in one
build and not the other" is the most interesting difference there is.

## Reading the report

Tens of thousands of expressions produce thousands of differences, and a flat
list of them is unreviewable, which in practice means unreviewed. Every
difference is given a **signature** describing the shape of the change:

```
ok:Number -> ok:Number/value      the same type, a different number
ok:Number -> ok:Number/formatting the same number, printed differently
ok:String -> error:UNKNOWN_TOKEN  used to work, now refused
error:X -> ok:Uom                 used to be refused, now works
ok:Uom -> FATAL(hang)             now kills the process
```

The report lists signatures by frequency with a few examples each, so a reviewer
makes one judgement per shape rather than one per row. `--signature=...` then
dumps every row of one shape.

Each difference belongs in exactly one bucket, and the bucket is a human
judgement, not something the tool decides:

- **INTENDED**: matches a documented deliberate change.
- **BUG FIXED**: clearly an improvement, even if unlisted.
- **REGRESSION**: worse, or changed with no justification.
- **UNCLEAR**: needs a person. Leave it here rather than forcing it.

## The 1.0.0 run

`--seed=20260811 --count=30000`, baseline `solve-engine@1.0.0-beta.6`.

| | |
| --- | --- |
| expressions compared | 40,368 |
| unstable (dropped) | 0 |
| identical | 38,426 |
| different | 1,942, in 117 signatures |
| candidate process deaths | 0 (baseline: 68) |

One regression and three unresolved differences, all recorded as `test.failing`
in `packages/engine/__tests__/hardening/DifferentialRegressions.spec.ts`. The
regression is a cross-measure conversion error being swallowed by a following
conversion and answering `0.00 <target>`; the existing suite could not see it,
because the case is already a `test.failing` on a different assertion.

The other 1,938 are the deliberate changes and the fixes: operator precedence,
relative percentages, unit-unifying comparisons, calendar date arithmetic,
string literals losing their quotes, enforced builtin arity, and the safety
limits that turned 68 process deaths into ordinary errors.

## The re-run, after the four were resolved

Same seed and count, same baseline. The corpus is a few hundred expressions
larger because it reads the test suite's own string literals and the suite
gained some.

| | |
| --- | --- |
| expressions compared | 40,892 |
| unstable (dropped) | 0 |
| identical | 38,982 |
| different | 1,910, in 114 signatures |
| candidate process deaths | 0 (baseline: 68) |

All four findings are closed, and each is now a passing test in
`DifferentialRegressions.spec.ts` rather than a `test.failing`:

- The regression is fixed at the root rather than at the two conversion
  opcodes it was found through. `faultedOperand()` in `vm/Value.ts` is the
  shared check, and the fifty-odd opcode cases that read an operand's number
  now ask its type first. `5 kg to m to s` and `abs(5 kg to m)` report the
  conversion error; `60 km/h in m/s` and `$100/hour in $/day` are back to
  being errors, with a different message than beta.6's.
- An exact shift or power past the 65,536-bit ceiling is refused in every
  spelling, rather than one of them answering `Infinity`.
- `1 ^ Infinity` is 1, following C99/IEEE 754 (and Python and Ruby) rather
  than ECMAScript, so `1^2^3^4^5` is 1 again.
- A bare ISO 8601 timestamp is parsed, offset included, by the same
  `parseIso8601()` the quoted form has always used.

The remaining differences from the row above are the same deliberate changes
and fixes, minus the four rows those decisions removed.
