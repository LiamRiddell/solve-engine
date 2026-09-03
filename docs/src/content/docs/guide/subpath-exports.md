---
title: Subpath exports
description: Every entry point, what it contains, and its stability.
---

The package exposes focused entry points so a bundler pulls in only what you
use.

## Public

Stable. Changes follow semantic versioning;
[versioning and support](/guide/versioning-and-support/) says exactly what that
promises, including how deprecations are handled and which Node versions are
tested.

| Entry | Contains |
| --- | --- |
| `solve-engine` | `ExpressionEngine`, `createEngine`, `IEnginePackage`, common types |
| `solve-engine/engine` | Engine internals for host integration |
| `solve-engine/vm` | `Value`, `ValueType`, value construction |
| `solve-engine/format` | `formatValue` and formatting settings |
| `solve-engine/language` | Completions, token categories, highlighting |
| `solve-engine/packages` | Built-in packages and their configuration |
| `solve-engine/constants` | Locales and configuration defaults |
| `solve-engine/worker` | Off-main-thread evaluation: the worker proxy, transports and result DTO |
| `solve-engine/testing` | A test kit for package authors: `createTestEngine`, `expectExpression`, `expectPackage` |

## Advanced

Also public, but they expose pipeline internals. Reach for them when writing a
package or building tooling.

| Entry | Contains |
| --- | --- |
| `solve-engine/lexer` | Tokeniser and vocabulary types |
| `solve-engine/parser` | Parselets, binding powers, bytecode builder |
| `solve-engine/normalizer` | Phrase fusion and normalisation rules |
| `solve-engine/resolvers` | Async resolver contracts |
| `solve-engine/errors` | Structured errors and the result type |
| `solve-engine/utilities` | Shared helpers |
| `solve-engine/uom` | Unit definitions and conversion |
| `solve-engine/services` | Data query plumbing |

## Internal

Not exported and not covered by semantic versioning: telemetry, caching,
diagnostics, the internal compile/execute worker managers, and internal types.
(The public `solve-engine/worker` entry above is the supported way to move
evaluation off the main thread.) If you find yourself needing
one of these, that is worth raising as an issue, because it usually means a
public entry point is missing something.
