---
title: Tracing where a number came from
description: Following a line's answer back through the lines it read, for hover highlights and a "how was this worked out" panel.
---

A note that builds on itself hides its own structure. Line five reads a payment
from line four, which reads a deposit from line two and a rate from line one,
and none of that is visible in the answers. [Explaining a
line](/guide/explaining-lines/) says how one line did its arithmetic; tracing
says which *other* lines it took its numbers from, and which lines those took
theirs from, all the way up.

`traceLine` returns that as a tree, so a host can highlight the lines a result
depends on when the reader hovers it, or open a "how was this worked out"
disclosure beside the answer.

```ts
import { createEngine, formatLineTrace } from "solve-engine";

const engine = createEngine();
const document = engine.parseDocument(
  [":rate = 4%", ":deposit = 100000", "", ":payment = monthly repayment on deposit over 25 years at rate", "payment * 12"].join("\n"),
);

const trace = engine.traceLine(5, { document });
formatLineTrace(trace);
// "6,334.04 (line 5) <- payment 527.84 (line 4) <- [deposit 100,000 (line 2), rate 4.00% (line 1)]"
```

The reader can ask the same question in the note itself with
[`inputs of line N`](/syntax/tracing-inputs/), which answers with exactly that
text.

## What comes back

A `LineTrace` is one line and the lines it read, each in the same shape:

```ts
interface LineTrace {
  line: number;              // 1-based line number
  name: string | null;       // the variable it defines ("payment"), or null
  value: Value | null;       // its answer
  via: string[];             // how the line above reached it: "deposit", "line 2", "prev", "above", "#food"
  inputs: LineTrace[];       // the lines it read, in the order its text reads them
  cycle: boolean;            // already on the path above: not followed again
  forward: boolean;          // below the line that read it
  truncated: boolean;        // has inputs the depth or size bound left out
}
```

For the payment above, `trace.inputs[0]` is line four, whose `via` is
`["payment"]` and whose own `inputs` are line two (`via: ["deposit"]`) and line
one (`via: ["rate"]`). `value` is the same `Value` the document holds for that
line, so it formats with [`formatValue`](/guide/formatting/) like any answer.

## Highlighting the lines behind an answer

Every line a result depends on is somewhere in the tree. Collecting the line
numbers is a short walk:

```ts
import type { LineTrace } from "solve-engine";

function linesBehind(trace: LineTrace): Set<number> {
  const lines = new Set<number>();
  const walk = (node: LineTrace) => {
    for (const input of node.inputs) {
      lines.add(input.line);
      walk(input);
    }
  };
  walk(trace);
  return lines;
}

linesBehind(engine.traceLine(5, { document })); // Set { 4, 2, 1 }
```

## How a line reads another

The trace follows every way one line can take a number from another:

| Way | Written as | Traced to |
| --- | --- | --- |
| a variable | `deposit` | the nearest line above that defines it |
| a position | `line 2`, `prev`, `total above`, `sum(line 1 : line 3)` | those lines |
| a category tag | `total of #food` | every line carrying the tag |

A variable resolves to the nearest definition above the reader, not the latest
one on the page, because a variable's value is positional: `:x = 100` on line
nine does not change what line three read.

## Which document it reads

A live editor attaches its document to the engine through a
`ThreeTierEvaluator`, and `traceLine(n)` reads that document with no options.
A host that evaluates a whole document in one pass passes the result instead,
from either `parseDocument` or `evaluateDocument`, as `options.document`.

The trace is built from each line's text and answer, never by evaluating
anything, so tracing leaves the document exactly as it was, and both passes
give the same trace for the same document.

## Cycles, forward references and bounds

Two lines that read each other (`line 2 + 5` above `prev + 5`) have no order to
trace. The second time a line appears on the path it comes back with
`cycle: true` and no inputs, so the walk ends there rather than looping. A line
that reads one below it comes back with `forward: true`: in a single pass, that
line had not been worked out when it was read, which is usually why the reader
shows an error.

The walk is bounded. It follows ten levels of inputs and lists two hundred lines
in all; a line with inputs past either bound comes back with `truncated: true`,
so a panel can say "and more" rather than imply the line read nothing. Both
limits are options:

```ts
engine.traceLine(5, { document, maxDepth: 3, maxLines: 50 });
```

## When it refuses

`traceLine` throws an `EngineError` in two cases, both about the request rather
than the document:

| Code | When |
| --- | --- |
| `TRACE_NO_DOCUMENT` | no document is attached and none was passed |
| `TRACE_NO_SUCH_LINE` | the line number is not a line of the document |

## What it does not cover

A [table column](/syntax/table-columns/) is read from the table's text, not from
other lines' answers, so a column aggregate lists no inputs. A package that
reads other lines' results by its own means, rather than through the forms in
the table above, is not seen by the trace. And the trace says *which* lines fed
a result, not *how* each line combined them: for that, pass the line's text to
[`explainLine`](/guide/explaining-lines/).
