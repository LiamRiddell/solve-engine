---
title: Subpath exports
description: Every entry point, what it contains, and its stability.
---

The package exposes focused entry points so a bundler pulls in only what you
use.

## Public

Stable. Changes follow semantic versioning.

| Entry | Contains |
| --- | --- |
| `solve-engine` | `ExpressionEngine`, the package registry, common types |
| `solve-engine/engine` | Engine internals for host integration |
| `solve-engine/vm` | `Value`, `ValueType`, value construction |
| `solve-engine/format` | `formatValue` and formatting settings |
| `solve-engine/language` | Completions, token categories, highlighting |
| `solve-engine/packages` | Built-in packages and their configuration |
| `solve-engine/constants` | Locales and configuration defaults |

## Advanced

Also public, but they expose pipeline internals. Reach for them when writing a
package or building tooling.

| Entry | Contains |
| --- | --- |
| `solve-engine/lexer` | Tokeniser and vocabulary types |
| `solve-engine/parser` | Parselets, binding powers, bytecode builder |
| `solve-engine/normalizer` | Phrase fusion and normalisation rules |
| `solve-engine/variables` | Variable resolution |
| `solve-engine/resolvers` | Async resolver contracts |
| `solve-engine/errors` | Structured errors and the result type |
| `solve-engine/utilities` | Shared helpers |
| `solve-engine/uom` | Unit definitions and conversion |
| `solve-engine/services` | Data query plumbing |

## Internal

Not exported and not covered by semantic versioning: telemetry, caching,
diagnostics, worker plumbing and internal types. If you find yourself needing
one of these, that is worth raising as an issue, because it usually means a
public entry point is missing something.
