---
"solve-engine": minor
---

What a note keeps is bounded: its answers hold at most ten million elements, set by `vm.maxRetainedElements`

Each line's answer stays in memory while the note is open, and every limit counted one line at a time: `vm.maxAllocatedElements` stops one evaluation making more than two million elements, and nothing stopped many lines keeping that much between them (#694). Five hundred lines of `:m = map(10*x, 0:99999)`, 13 KB of text, each inside every per-line limit, kept 50,000,000 elements and 385 MB of heap.

One count per pass now bounds it, in elements: a list or matrix counts its cells, text one element to eight characters, and any other answer one. The line whose answer would take the note past the ceiling is refused with `DOCUMENT_ELEMENT_LIMIT_EXCEEDED`, naming its size and the setting, and a name it assigned is let go, so the value is not kept through a variable either. The lines above keep their answers.

| 500 lines, `:m0 = map(10*x, 0:99999)` to `:m499 = ...`, default settings | before | now |
| --- | --- | --- |
| lists kept | 500 | 100 |
| elements kept | 50,000,000 | 10,000,000 |
| heap the note holds | 385 MB | 80 MB |
| lines refused | none | 101 to 500 |

Measured on one Windows 11 machine under Node 24.16, heap after two collections with the engine still held.

Ten million is a hundred 100,000-element lists, or five lines at `vm.maxAllocatedElements`; an ordinary note of numbers, text and small tables is nowhere near it. The count starts again on every pass, so an edited or deleted line stops counting when it does, and both document passes count alike and refuse the same line. A line waiting on a live value keeps nothing until the value lands; its re-run is then charged against what the whole note keeps, and an answer no larger than the one it replaces is always kept, so a background refresh never refuses a line.

The boundary: this bounds memory, not time. A line is refused once its answer is known, so the work of making it is done, within the per-line limits; the 500-line note takes as long as it did. The re-run after a live value lands is charged against the whole note rather than its position, so near the ceiling it can refuse a line a fresh pass would keep; the next pass counts every line in place again. The single-expression path keeps no note and is not counted. The security page's limits table states the setting.

## Verification

`Issue694_retainedElementsBudget.spec.ts` holds twenty-two tests. A list counts its cells, text its length in eights and anything else one, and the refusal names the line, its size and the setting. The line that crosses the ceiling is refused, its name let go (a line reading it answers `Undefined variable`) while the kept names stay; an answer that reaches the ceiling exactly is kept and one element more is refused; re-parsing a note twenty-five times refuses nothing new; the default answers 2,000 ordinary lines in full; and a refused line assigning each prototype word lets go of that name only. The incremental path agrees with a fresh pass after an edit that shrinks a line above, after a heavy line is edited back and forth or deleted and re-inserted twenty times, after the refused line is moved to the top, in a viewport below the heavy lines, and for a definition above the viewport that runs out of view after an edit. A line waiting on a `global` value is refused on its re-run at the line a fresh pass refuses, with its name let go; a re-run no larger than the answer it replaces is kept fifty times over; and before any pass a re-run keeps its answer. `CrossPathDocumentFeatures.spec.ts` holds the cross-path case: both document passes refuse the same line, and the single-expression path keeps its answer.

The full suite (`npm run test:full`) passed, 15,581 of 15,585 tests in 613 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (2,869 tests in 90 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,363 documented examples). `executeBytecode` is unchanged at 47,528 bytecode bytes on Node 24.16.0.
