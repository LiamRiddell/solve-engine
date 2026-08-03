<div align="center">

<img src="playground/public/solve-logo.svg" alt="Solve" width="96" />

# Solve Engine

**A calculator that reads like a sentence.**

Type what you mean. Units, currencies, percentages, dates, matrices and
plain-English phrasing all work in the same expression, and the answer appears
as you type.

[![npm](https://img.shields.io/npm/v/solve-engine?color=%230b7285&label=npm)](https://www.npmjs.com/package/solve-engine)
[![CI](https://github.com/LiamRiddell/Solve-Engine/actions/workflows/ci.yml/badge.svg)](https://github.com/LiamRiddell/Solve-Engine/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/solve-engine)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Documentation](https://liamriddell.github.io/Solve-Engine/) &nbsp;•&nbsp;
[Playground](https://liamriddell.github.io/Solve-Engine/playground/) &nbsp;•&nbsp;
[Syntax reference](https://liamriddell.github.io/Solve-Engine/syntax/cheatsheet/) &nbsp;•&nbsp;
[Contributing](CONTRIBUTING.md)

</div>

---

```solve
1024 * 8                      // 8,192
15% of 2400                   // 360
100 cm + 2 m                  // 300.00 cm
30 fps * 3 minutes            // 5400.00 frames
[1, 2; 3, 4] * [5, 6; 7, 8]   // [19, 22; 43, 50]
```

Every example in this file, and every example in the documentation, is executed
by the test suite. If one of them stops being true, the build goes red.

## Install

```bash
npm install solve-engine
```

```typescript
import { ExpressionEngine } from "solve-engine";

const engine = new ExpressionEngine();
const [value] = engine.evaluateExpression("2 + 2 * 10");

console.log(value.toNumber()); // 22
```

No dependencies on a UI framework, a DOM, or an editor. It runs in Node, in a
browser, and in a worker.

## What it can do

**Units, converted and carried through arithmetic.** Not string matching on a
suffix: units participate in the calculation and the result keeps the right one.

```solve
72F to C                      // 22.22 C
5 miles in km                 // 8.05 km
2 cups to ml                  // 473.18 ml
250 kg to pounds              // 551.16 pounds
1 GB in MB                    // 1000.00 MB
90 minutes in hours           // 1.50 hours
2 hours + 45 minutes          // 2.75 hours
```

**Percentages, in the several different things people mean by them.**

```solve
15% of 2400                   // 360
increase 100 by 10%           // 110.00
100 to 150                    // 50.00%
5% of what is 6               // 120
```

**Named values, across lines.** A document is a calculation, not a set of
unrelated sums.

```solve
:subtotal = 240
```

**Matrices, ranges, and symbolic algebra.**

```solve
[1, 2; 3, 4] * [5, 6; 7, 8]   // [19, 22; 43, 50]
det([1, 2; 3, 4])             // -2
```

**Everything else you reach for.** Number bases, comparisons, conditionals,
money, dice, live weather, and a function library.

```solve
0xFF + 0b1010                 // 265
255 as hex                    // 0xFF
2.5k * 4                      // 10,000
max(3, 9, 2)                  // 9
10 mod 3                      // 1
if 5 > 3 then 100 else 200    // 100
$100 + $250                   // $350.00
```

The [syntax reference](https://liamriddell.github.io/Solve-Engine/syntax/cheatsheet/)
is the complete list. There is rather more of it than fits here.

## How it works

Text goes through a lexer, a normaliser that fuses multi-word phrases into
single tokens, a Pratt parser that emits bytecode, and a register-based virtual
machine. Results are cached per line, and a dependency graph means editing one
line re-evaluates only the lines that actually depended on it.

That is more machinery than a calculator strictly needs, and the reason for it
is the typing. The engine is built to run on every keystroke, on a document
rather than a single expression, where most lines have not changed and the one
that did should not cost a full re-evaluation of the rest.

Everything above the pipeline is a package. All 21 of them, arithmetic
included, register through the same public interface: token vocabulary,
normaliser rules, parselets, and VM functions. There is no privileged built-in
tier, which means an extension can do anything the built-ins can. Nineteen
register by default; stocks and knowledge stay out until a host supplies a data
source.

[Architecture](https://liamriddell.github.io/Solve-Engine/architecture/overview/)
covers this properly, including a candid list of what is not finished.

## Design

**Natural phrasing, without hijacking English.** A calculator that understands
sentences has an obvious failure mode: claim `in`, `to`, `at` and `for` as
keywords and you break every line of prose that happens to contain one, and you
make those words unusable as variable names. So bare common words are almost
never keywords here. Multi-word phrases get fused by the normaliser only in
positions where nothing else is plausible.
[Trigger words and fusion](https://liamriddell.github.io/Solve-Engine/syntax/trigger-words/)
explains where the lines are drawn and why.

**An error, never a guess.** When a resolver has not returned yet the result is
a pending value that resolves later. When a data source is not configured the
result says so. The engine does not invent a plausible number, because a wrong
answer that looks right is worse than no answer.

**Bounded on untrusted input.** Expression length, parse depth, instruction
count and stack depth all have limits, and each produces a named error rather
than hanging. Input arriving one keystroke at a time from a person who is still
mid-thought is the normal case, not the edge case.

## Non-goals

- **Not a general-purpose language.** No loops, no I/O, no arbitrary code
  execution. Expressions compile to a fixed instruction set.
- **Not a computer algebra system.** The symbolic layer simplifies and
  rearranges within deliberate bounds. It will not do your integrals.
- **Not a spreadsheet.** Lines reference earlier lines. There are no sheets,
  no cells, and no circular references to resolve.
- **Not arbitrary-precision by default.** Ordinary arithmetic uses doubles, and
  a big-integer type is available where exactness matters.

## Repository

| Path | What is in it |
| --- | --- |
| `packages/engine` | The published package |
| `packages/playground-bridge` | Shared glue between the engine and the playground |
| `playground` | The interactive playground, with every pipeline stage exposed |
| `docs` | The documentation site |
| `examples/osrs` | A worked example of a third-party package |

```bash
npm install && npm run verify
```

`verify` is the whole gate: type check, test suite, and package build. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Status

Working toward `1.0.0-beta`. The engine is stable and heavily tested, but the
API surface may still move before 1.0. Open items are tracked as issues rather
than hidden, and the beta release notes will name the ones that matter.

## Licence

MIT. See [LICENSE](LICENSE).

If it is useful to you, [sponsorship](https://github.com/sponsors/LiamRiddell)
is welcome and never expected.
