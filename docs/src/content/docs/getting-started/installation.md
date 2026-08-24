---
title: Installation
description: Installing the package, what ships in it, and which environments it supports.
---

```bash
npm install solve-engine
```

The package ships both ESM and CommonJS builds with TypeScript declarations for
each, so it works whether your project uses `import` or `require`.

## Requirements

Node 22 or newer, or any browser from the last few years. The engine has no DOM
dependency and no Node-specific dependency, so the same build runs in a browser
tab, a web worker, a Node process, or a serverless function.

TypeScript is optional. If you use it, everything is typed and no separate
`@types` package is needed.

## Verifying the install

```ts
import { createEngine } from "solve-engine";

const engine = createEngine("en");
const [result] = engine.evaluateExpression("2 + 2 * 10");

console.log(result.toNumber()); // 22
```

If that prints `22`, you are set up.

## Entry points

The main entry gives you the engine and the common types. There are also focused
subpath entries, so a bundler only pulls in the part you actually use.

| Import | Contains |
| --- | --- |
| `solve-engine` | `ExpressionEngine`, the package registry, common types |
| `solve-engine/vm` | `Value`, `ValueType`, and value construction helpers |
| `solve-engine/format` | `formatValue` and formatting settings |
| `solve-engine/language` | Editor support: completions, token categories, highlighting |
| `solve-engine/packages` | The built-in packages and their configuration types |
| `solve-engine/constants` | Locale definitions and engine configuration defaults |
| `solve-engine/errors` | The structured error type and its taxonomy |

A further set of entries exposes the pipeline internals for advanced use, listed
in [subpath exports](/guide/subpath-exports/). Anything not documented there is
internal and can change between releases without a major version.

## A note on live data

Currency conversion, weather and stock lookups reach the network. Currency and
weather work out of the box against free, keyless endpoints. Stocks and the
knowledge package are opt-in and require you to supply the fetching function
yourself, which means the engine never holds an API key. See
[async and live data](/guide/async-and-live-data/).
