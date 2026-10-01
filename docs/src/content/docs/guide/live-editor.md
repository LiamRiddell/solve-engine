---
title: Driving a live editor
description: Keeping a document's answers current on every keystroke with DocumentModel and ThreeTierEvaluator, and retiring the evaluator when the document closes.
---

An editor asks for answers far more often than a batch job does: after every
keystroke, and again whenever the reader scrolls. Running every line of the note
each time is correct and wasteful, because almost every line is the same as it
was a moment ago. The engine's incremental path keeps what did not change and
runs only what the reader can see or what the edit reached.

It is two objects from `solve-engine/engine`, kept for as long as the document
is open:

- a **`DocumentModel`**, the note as a list of lines. Each line keeps an id of
  its own for its whole life, its compiled program, its last answer, and whether
  it is **dirty** (changed, or reading something that changed, since it last
  ran);
- a **`ThreeTierEvaluator`**, which decides for each line whether it has to run
  again, and runs it. It works to a **viewport**, the range of lines on screen,
  so a line nobody is looking at can wait.

[Which entry point](/guide/entry-points/) compares this with `parseDocument`
and `evaluateDocument`; this page is the walkthrough.

## The loop

Build the model from the note's text, wrap it in an evaluator, and evaluate the
lines on screen. The same engine then serves every edit.

```ts
import { createEngine } from "solve-engine";
import { DocumentModel, ThreeTierEvaluator } from "solve-engine/engine";

const engine = createEngine();
const doc = new DocumentModel();
doc.setDocument(["# Groceries", ":apples = 3 * £0.40", ":bread = £1.20", "apples + bread"].join("\n"));

const evaluator = new ThreeTierEvaluator(doc, engine);
const first = evaluator.evaluate({ startLine: 1, endLine: 30 });

engine.formatValue(first.resultMap.get(4)![0]); // "= £2.40"
first.tierCounts;                                // { tier1: 3, tier2: 0, tier3: 0, skipped: 1 }
```

The heading on line 1 is prose, so it is skipped. The other three lines are new,
so each goes through the whole pipeline once.

When the reader edits a line, tell the evaluator what changed, then evaluate
again. A keystroke inside a line is one line replaced by its new text:

```ts
evaluator.applyTransaction([{ startLine: 3, deleteCount: 1, insertLines: [":bread = £1.50"] }]);
// { inserted: [], removed: [], edited: [3] }: the ids of the lines whose text changed

const next = evaluator.evaluate({ startLine: 1, endLine: 30 });
engine.formatValue(next.resultMap.get(4)![0]); // "= £2.70"
next.tierCounts;                               // { tier1: 1, tier2: 2, tier3: 0, skipped: 1 }
```

Only the edited line went through the pipeline again. The other two ran the
programs they had already compiled, which is what makes a keystroke cheap:
line 4 read the new price without being lexed, parsed or compiled again.

When the document closes, or the editor switches to another one, retire the
evaluator:

```ts
evaluator.dispose();
```

That is the whole loop: `applyTransaction` on each edit, `evaluate` (or
`setViewport`, below) for the lines on screen, read the results, and `dispose`
at the end.

## Telling the evaluator about an edit

`applyTransaction` takes a list of changes, each a first line (counted from 1),
a number of lines to delete, and the lines to insert in their place. That is the
shape most editors already describe a change in, CodeMirror's change sets among
them.

- A change that deletes as many lines as it inserts moves no line, so the
  evaluator applies it in place: each line keeps its id and its compiled
  program, and the result lists the edited lines' ids in `edited`.
- A change that alters the line count (Enter pressed, a line deleted, a paste of
  a different length) is structural: the lines below move, and each is followed
  to its new position. The result lists the new lines' ids in `inserted` and the
  deleted ones in `removed`.

```ts
evaluator.applyTransaction([{ startLine: 4, deleteCount: 0, insertLines: [":milk = £0.95"] }]);
// { inserted: [5], removed: [], edited: [] }
evaluator.evaluate({ startLine: 1, endLine: 30 });
```

`doc.editLine(lineNumber, text)` is the one-line form of an in-place edit, for a
host that tracks lines itself. Either way the model only records the change and
marks the lines dirty; nothing runs until the next `evaluate`.

A text with a line break in it is more than one line, wherever it arrives. A
line feed, a carriage return on its own, or the two together each end a line,
as they do in a document loaded with `setDocument` or read by `parseDocument`:
`doc.editLine(2, "5\r6")` replaces line 2 with two lines, and an inserted
`"7\r8"` in a transaction inserts two. Such an edit changes the line count, so
it is applied as a structural one, through the evaluator, and the lines below
it are followed to their new positions.
[Performance](/guide/performance/#telling-the-evaluator-about-an-edit) has the
measured difference between the two kinds of edit.

## Reading the results

`evaluate` returns an `EvalResult`:

| Field | Holds |
| --- | --- |
| `lines` | one `EvalLineResult` per line from line 1 to the end of the viewport, in order |
| `resultMap` | the answers of the lines in the viewport, by line number, each an array, since a line with several inline solves has one answer per solve |
| `tierCounts` | how many lines each tier handled, which is how a slow document is diagnosed |

Each `EvalLineResult` carries the line's `lineNumber`, its persistent `lineId`,
the `tier` that handled it, its first answer in `result`, and, for a line that
failed, the message in `error` with the same `errorCode` and `errorSpan` a
document line has (see the [quick start](/getting-started/quick-start/)). Write
an answer out with `engine.formatValue(value)`, which uses the engine's own
locale and calendar; see [formatting results](/guide/formatting/).

## What each tier does

The evaluator's name comes from the three ways it can handle a line.

| Tier | A line that is | What happens |
| --- | --- | --- |
| 1 | dirty, on screen or above it | the whole pipeline: lexed, parsed, compiled and run, and its program kept |
| 2 | on screen and clean | its kept program is run again, with no lexing, parsing or compiling |
| 3 | below the screen and dirty, in a `backgroundCompile` | compiled so the evaluator knows what it reads and writes, and run only if it defines a variable a later line may read |
| skipped | clean off screen, blank, or prose | nothing |

A clean line on screen still runs (tier 2), because what it reads may have
changed: a variable's value depends on where in the note it is read, so the
evaluator walks the note from the top down to the end of the viewport. A dirty
line above the viewport runs in full as well, because a line on screen may read
it by position (`prev`, `line 2`, `total above`) as well as by name. The lines
below the viewport are not visited at all. They keep their last answers, or
wait, until they are scrolled into view.

Each line reads the note as a pass from the top would leave it at that line,
however the pass got there. A name only a line further down defines is not
defined yet (`x * 2` above `x = 5` answers `Undefined variable: x`, as
`parseDocument` does), a name defined twice has the value of the definition
above the reader, and a name of several words (`hourly rate`) is one name only
below the line that defines it. The evaluator keeps the variables at the line it
last ran and moves them to each line it runs next, so a pass pays for the
distance between the lines it runs rather than for the length of the note.

Which lines are dirty after an edit is decided by a dependency graph: the
evaluator records which variables each line reads and writes, and an edit marks
the edited line and everything that reads what it writes, however far down.

## Scrolling

When the reader scrolls without editing, call `setViewport` with the new range.
It moves the variables to where they stood just above the viewport, from the
checkpoints recorded on the last pass, and runs only the lines in view. The
move costs the distance scrolled, so a scroll costs about the same on a note of
twenty thousand lines as on one of five thousand:

```ts
const view = evaluator.setViewport({ startLine: 4, endLine: 5 });
view.lines.map((line) => line.lineNumber); // [4, 5]
view.tierCounts;                           // { tier1: 0, tier2: 2, tier3: 0, skipped: 0 }
view.lines.map((line) => engine.formatValue(line.result!)); // ["= £0.95", "= £2.70"]
```

Its `lines` and `resultMap` hold the lines in view only. If a line above the
viewport is dirty and defines a variable, or has not run since it was loaded or
edited, `setViewport` cannot trust the checkpoints and runs as `evaluate` does,
from line 1. A host that has just applied an edit can call
either; `evaluate` is the plain choice after an edit, and `setViewport` the fast
one for a scroll.

## When live data arrives

A line that fetches (a currency conversion, the weather) answers with a pending
value first, and the fetch continues in the background. When it lands, the
engine re-runs the lines that read it and says so. A live editor learns about
it in one of two ways:

- **`engine.getBatcher().onLineResult`**, a callback given each re-run line's
  number and new value, for a host that mirrors answers into state of its own;
- **`engine.getEventStream()`**, the stream of `lines-updated` events, for a
  host that re-evaluates the lines named. See
  [async and live data](/guide/async-and-live-data/#waiting-for-the-answer).

```ts
const liveEngine = createEngine();
const liveDoc = new DocumentModel();
liveDoc.setDocument("$100 in EUR");
const live = new ThreeTierEvaluator(liveDoc, liveEngine);

liveEngine.getBatcher().onLineResult = (lineNumber, value) => {
  render(lineNumber, liveEngine.formatValue(value)); // 1, "= €90.00", once the rate lands
};

const pending = live.evaluate({ startLine: 1, endLine: 30 });
liveEngine.formatValue(pending.resultMap.get(1)![0]); // "…", the pending value
```

Wire one of them before the first `evaluate`. With neither, the value lands in
the cache and the line keeps showing as pending, and the engine warns once on
the console to say why. The figure above is from a stubbed rate of 0.9; a real
one is whatever the service answers.

## Retiring an evaluator

`dispose()` is the call a host makes when it has finished with a document. It
does three things:

- stops the background compilation worker, if the evaluator started one;
- drops the evaluator's subscription to the shared store of `global :name`
  values, which otherwise keeps the evaluator reachable, and marking its lines
  dirty, for as long as the process runs;
- detaches the evaluator from the engine, so the engine no longer reads the
  retired document: afterwards `engine.evaluateLine(1, "line 1 * 2")` refuses
  for want of a document, rather than reading a line of a note the host closed.

It is safe to call more than once. `terminateWorker()`, the older name, still
does the first two and nothing else. A retired evaluator is not used again:
build a new one for the next document. The model and the engine are left as
they are, so a host may reuse either.

## The boundary

- **One engine per open document.** An engine holds one document's state (its
  variables, its units and names, and the lines a reference reads), so two
  evaluators open at once on the same engine take turns with it: each pass
  first checks whether another document used the engine since its own last
  pass, and if so takes it back and runs its lines again from the top, which
  is what a first pass costs. The answers are each document's own either way
  (`line 1 * 2` reads its own line 1), and so after a `parseDocument` or an
  `evaluateDocument` on the same engine between two passes. Give each open
  document its own engine (`createEngine()` is cheap next to a document) and
  no pass ever pays for that. A retired evaluator does not take the engine
  back.
- **Not behind a worker.** The evaluator runs on the thread that owns the
  engine. `solve-engine/worker` offers the whole-document calls
  (`parseDocument`, `evaluateLines`) behind `postMessage`, not the evaluator;
  see [off the main thread](/guide/performance/#off-the-main-thread).
- **Asked for everything, it runs everything.** `evaluate` over the whole
  document runs every line from the top, because the order of the lines is what
  makes each variable's value right. The saving comes from the lines off screen.
