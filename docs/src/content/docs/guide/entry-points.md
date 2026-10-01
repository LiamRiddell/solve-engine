---
title: Which entry point
description: The four ways to evaluate with the engine (one expression, the batch pass, the incremental pass and a live evaluator), what each can resolve, and what an edit costs through each.
---

The engine can be asked for an answer in four ways, and they are not
interchangeable. One reads a single expression with no document around it. Two
read a whole document in one call. The fourth is an object an editor keeps for
as long as a document is open. They differ in what they can resolve (the forms
that read or re-run other lines need a document, and goal seek needs a way to
re-run one) and in what an edit costs.

| Entry point | Reads | Line references, tags, table columns, what-if | Goal seek | After a one-line edit | For |
| --- | --- | --- | --- | --- | --- |
| `engine.evaluateExpression(text)`, `engine.evaluateLine(n, text)` | one expression | refused, with a code naming the missing document | refused (`GOAL_SEEK_NO_DOCUMENT`) | runs the one line | a calculator box, a formula field, a test of one line |
| `engine.parseDocument(text)` | a whole document, top to bottom, once | resolved | refused (`GOAL_SEEK_NO_DOCUMENT`) | runs every line again (skipping the compile stages for text it has seen) | rendering a note once, a server, a report |
| `evaluateDocument(engine, text)` | a whole document, through a fresh incremental evaluator it discards | resolved | resolved | runs every line again | a note that uses goal seek, evaluated occasionally |
| a long-lived `ThreeTierEvaluator` | a document it keeps, told about each edit | resolved | resolved | runs the edited line, what reads it, and the lines on screen | a live editor |

`evaluateDocument` is exported from `solve-engine/engine`, beside
`DocumentModel` and `ThreeTierEvaluator`. `parseDocument`, `evaluateLine` and
`evaluateExpression` are methods on the engine.

## One expression

`evaluateExpression` evaluates a line with no document around it, and throws an
`EngineError` for a line it cannot read. `evaluateLine(n, text)` does the same
for the line at position `n`. With no document, a form that reads other lines
has nothing to read, so it answers with an error value that says so rather than
a guess:

```ts
import { createEngine } from "solve-engine";

const engine = createEngine();

engine.evaluateLine(1, "line 1 * 2").errorCode;                   // "LINE_REF_NO_DOCUMENT"
engine.evaluateLine(1, "total of #food").errorCode;               // "TAG_NO_DOCUMENT"
engine.evaluateLine(1, 'sum of column "cost" above').errorCode;   // "TABLE_NO_DOCUMENT"
engine.evaluateLine(1, "line 2 with price = 10").errorCode;       // "WHAT_IF_NO_DOCUMENT"
engine.evaluateLine(1, "solve line 2 for price = 150").errorCode; // "GOAL_SEEK_NO_DOCUMENT"
```

## The batch pass and the incremental pass

`parseDocument` and `evaluateDocument` both take the note's text and return the
same `ParsingResult`, one entry per line, so a host reads either the same way
(see [Using the engine from TypeScript](/guide/typescript-usage/)). They agree
value for value on every form both can resolve. The one difference is
[goal seek](/syntax/goal-seek/), which works an input backwards from a target by
re-running another line with trial values. `parseDocument` evaluates each line
once and cannot re-run one, so it refuses; `evaluateDocument` goes through the
incremental evaluator, which can.

```ts
import { evaluateDocument } from "solve-engine/engine";

const note = [":price = 100", "price * 1.25", "solve line 2 for price = 150", "line 2 with price = 10"].join("\n");

engine.parseDocument(note).lines[2].result?.errorCode; // "GOAL_SEEK_NO_DOCUMENT"
engine.formatValue(evaluateDocument(engine, note).lines[2].result!); // "= 120"

engine.formatValue(engine.parseDocument(note).lines[3].result!);     // "= 12.50"
engine.formatValue(evaluateDocument(engine, note).lines[3].result!); // "= 12.50"
```

The what-if on line 4 resolves through both, because it re-runs the lines above
its target from their text in a scratch engine of its own, which the batch pass
can do. A host that wants a whole note with some inputs changed, rather than one
line, calls `engine.whatIf(text, overrides)`, described under
[asking what if](/guide/embedding/#asking-what-if); it reads the note as
`parseDocument` does.

## What an edit costs

Neither whole-document call remembers the last one's answers: each runs every
line, since a variable's value depends on where in the note it is read, and
running from the top is what keeps it right. The compiled programs are cached
by text, so a second `parseDocument` of a mostly unchanged note skips the lexing,
parsing and compiling of every line it has seen, but it still runs them all.

A `ThreeTierEvaluator` keeps the document between calls, so it knows which lines
an edit reached. Measured on a note of 1,000 lines, each calling a counting
function, after its last line was edited:

| Entry point | Lines run |
| --- | --- |
| `parseDocument`, on the engine that ran the first pass | 1,000 |
| `evaluateDocument` | 1,000 |
| `ThreeTierEvaluator`, evaluating lines 1 to 1,000 | 1,000 |
| `ThreeTierEvaluator`, evaluating the 20 lines on screen, 981 to 1,000 | 20 |

The saving comes from the lines nobody is looking at. [Driving a live
editor](/guide/live-editor/) walks through the evaluator, and
[performance](/guide/performance/#incremental-re-evaluation) has the figures
behind the edit paths.

## Choosing

- A field that takes one formula, with no note around it: `evaluateExpression`.
- A note rendered once, or on a server, where goal seek is not needed:
  `parseDocument`. It is the simplest and the one [embedding](/guide/embedding/)
  teaches.
- The same, where the note may hold a goal seek: `evaluateDocument`.
- An editor that re-evaluates on every keystroke: a `ThreeTierEvaluator`, kept
  for the life of the document and retired with `dispose()`.
- Any of the whole-document calls off the main thread: `solve-engine/worker`
  offers `parseDocument` and `evaluateLines` behind `postMessage`; see
  [off the main thread](/guide/performance/#off-the-main-thread).

## The boundary

An engine that a live evaluator is attached to reads that evaluator's document:
its `evaluateLine` answers `line 1 * 2` from the evaluator's line 1, and a
`parseDocument` on it can read the evaluator's lines in place of its own. Keep a
live evaluator's engine for that evaluator, and use another engine for one-off
calls; `evaluateDocument` borrows an engine for its pass and puts back whatever
document it had. Nothing here changes what a line means: the four read the same
syntax, and differ only in what they have around a line.
