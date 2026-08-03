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

## Deployment

Built as a static site and published alongside the documentation at
`/<repository>/playground/`.

The base path is supplied at build time through `BASE_PATH`, because GitHub
Pages serves a project site from a subdirectory. Building without it produces a
page that loads its HTML and then fails to find any of its assets. The deploy
workflow sets it and then asserts it was actually applied, because that failure
is silent at build time and obvious only once deployed.

```bash
BASE_PATH=/Solve-Engine/playground/ npm run build
```
