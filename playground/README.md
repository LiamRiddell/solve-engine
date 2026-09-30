# Solve Playground

An interactive environment for evaluating Solve expressions and inspecting how
the engine arrives at each result.

It is a development tool as much as a demonstration. Alongside the editor and
its results, it exposes every stage of the pipeline: the token stream, what the
normaliser fused, which parselets matched, the compiled bytecode, the virtual
machine trace, cache state, the dependency graph, and per-stage timings.

## Running it

```bash
npm install
npm run dev
```

The development server listens on port 5174.

Dependencies are installed separately from the workspace root, because this app
is not a workspace member. It keeps its own lockfile so that a React or Vite
upgrade here cannot disturb the engine's dependency tree.

## How it reaches the engine

Vite aliases resolve directly to engine **source** rather than to the built
package:

| Alias | Resolves to |
| --- | --- |
| `@solve-js/*` | `../packages/engine/src/*` |
| `@solve-js-examples/*` | `../packages/engine/examples/*` |
| `@bridge/*` | `../packages/playground-bridge/src/*` |

Editing the engine is reflected immediately without a rebuild, which is the
point of the arrangement. The trade-off is that this app type-checks engine
source under its own, newer TypeScript, so it occasionally surfaces errors the
engine's own build does not. Those are usually real imprecision and worth fixing
rather than suppressing.

## How a document is evaluated

The debug pipeline evaluates one line at a time, which is what lets it show each
line's tokens, stages and bytecode. One line at a time cannot re-run another
line, which is what goal seek (`solve line 3 for deposit = 900`) and the what-if
lines need, so each line's **answer** comes from the incremental document pass
instead (`evaluateDocument`, the pass a live editor runs), and the pipeline data
beside it stays the debug pipeline's. A table's rows, which that pass reads as
markup, are skipped. The document pass runs with live data off, so a currency or
weather line keeps the debug pipeline's own, possibly live, answer rather than
being fetched twice.

## Host calls

The **Host calls** tab runs, against the active tab, the calls a host makes for
the document features:

- **Explain** the line under the cursor: how it reached its answer, step by step
  (`engine.explainLine`).
- **Trace** it: which other lines it read (`engine.traceLine`).
- **What if**: re-run the note with inputs changed, without editing it
  (`deposit = 200000, rate = 5%`, through `engine.whatIf`), listing the lines
  that change.
- **References**: go to the definition of the variable under the cursor, find
  every line that names it, or rename it in all of them at once. With "keep
  line N references" on (the default), inserting or deleting a line rewrites the
  `line N` references that pointed past it, as a spreadsheet keeps a reference
  on its row.

Each runs on its own engine with live data off, and changes nothing in the note
except a rename or a moved reference, which are ordinary edits.

## Sharing a document

**Share** in the header copies a link that carries the document in the URL
fragment, the part after `#`, which a browser never sends to a server. The text
is compressed and written in base64url behind `#doc=v1.`, so nothing is uploaded
anywhere. A link opens its document in a new tab with **live data off**, so
opening someone's link cannot make your browser fetch rates or weather you did
not ask for; the header's live data switch turns it back on.

A link that cannot be read is refused with a message, and the playground opens
as it was: one longer than 200,000 characters, one that is not a playground
link, damaged data, data that unpacks to more than 100,000 characters (the
unpacking stops at the limit rather than filling memory), and bytes that are not
text.

## Deployment

Built as a static site and published alongside the documentation at
`/<repository>/playground/`.

The base path is supplied at build time through `BASE_PATH`, because GitHub
Pages serves a project site from a subdirectory. Building without it produces a
page that loads its HTML and then fails to find any of its assets. The deploy
workflow sets it and then asserts it was actually applied, because that failure
is silent at build time and obvious only once deployed.

```bash
BASE_PATH=/solve-engine/playground/ npm run build
```
