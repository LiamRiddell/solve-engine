---
"solve-engine-mcp": minor
---

`solve-mcp` is a Model Context Protocol server for the engine, so an AI tool can evaluate an expression, a whole document or its checks, with the network off, a fresh engine per call and no global variables

An AI tool had no way to hand a calculation to the engine without someone writing a host for it (#774). MCP is the common way such a tool calls a function outside itself: the server lists its tools with a schema for their arguments, and the tool calls one with JSON.

`packages/mcp` (`solve-engine-mcp`) is that server, on the official `@modelcontextprotocol/sdk` over standard input and output, in a package of its own because the engine's promise of one runtime dependency has no room for the SDK. It offers `evaluate_expression`, `evaluate_document` and `check_document`, each taking `tz`, `now` and `seed` as the `solve` command's options do, and each answering with the object `solve --json` prints (built on `Value.toJSON`), with `ok` in place of the exit status, as `structuredContent` and as text. The waiting for live data and the result objects are the command's own code, bundled in. The defaults are the issue's, and a call can change none of them: the network is off unless the server is started with `--network on`; every call builds a fresh engine and clears it in a `finally`; and the engines leave out `solve-global-variables`, whose `global :name` is the one form that reaches a store every engine in the process shares. An input the engine refuses as a whole is a coded refusal (`isError`) that leaves the next call unaffected.

| call | before | now |
| --- | --- | --- |
| `evaluate_expression` with `5 km in miles` | no server | `{ "status": "answered", "display": "= 3.11 miles", "value": { "type": 6, "value": 3.1068559611866697, "unit": "miles" }, "ok": true, ... }` |
| `check_document` with `:a = 2` and `check a == 3` | no server | `{ "passed": 0, "failed": 1, "ok": false, ... }`, the check's code `CHECK_FAILED` |
| `evaluate_expression` with `weather in London` | no server | `status: "failed"`, `code: "NETWORK_DISABLED"` |
| `evaluate_document` with 100,001 lines, then `evaluate_expression` with `2 + 2` | no server | `isError`, `{ "error": { "code": "DOCUMENT_TOO_LARGE", ... } }`, then `= 4` |
| `evaluate_document` with `global :secret = 42` | no server | `not-read`, `NO_PREFIX_PARSELET`: the store is unreachable |
| a document longer than a million characters | no server | `isError`, `INPUT_TOO_LARGE`, before an engine is built |
| a live line that never answers, under `--network on --wait 150` | no server | the line `pending`, the call over within the wait |

The boundary: tools only, over standard input and output; no prompts, resources or network transport. The server reads no files: a document reaches it as the text of a call. The `solve-engine/tool` subpath with JSON Schemas for the syntax stays set aside, as the survey left it. The package is private and runs from a checkout (`node packages/mcp/dist/solve-mcp.js`), as the command does, until its name has a first release. `lint:licenses` now walks the command's and the server's production dependencies as well as the engine's, and every licence in the SDK's tree is on the allowlist.

The guide gains [the MCP server](/guide/mcp-server/), registered under Set up after the command line, and security gains a section on the server's defaults.

## Verification

`Issue774_mcpServer.spec.ts` holds 33 tests: the parts (`parseServerArguments`, `engineOptionsFor`, `toCallResult`, each tool as a plain function), the calls through the SDK's own client over its in-memory transport (the tool list and schemas, structured content, a hostile document past the engine's line limit refused with `DOCUMENT_TOO_LARGE` and the next call answering, an input past the size limit refused before any engine is built, arguments of the wrong type), one call unable to read another's variable, unit or global (with two engines that do have the package as the control), live data under `--network on` (answered, never answered and over within the wait, three calls in flight at once each on its own engine), and the adversarial cases (prototype words as expressions, documents, zones and seeds with `Object.prototype` unchanged, the resource probes, the numeric, text and document edges, escape sequences kept as data, CRLF, a typo and a unit that does not fit). `npm run smoke:mcp`, now part of `npm run verify`, starts the built server and makes the same calls over real standard input and output for 10 checks, including that nothing but protocol messages reaches standard output and that the process exits when the client closes its end.

The fast suite ran across 706 suites (23,268 of 23,272 tests passed, 4 skipped). `npm run build` (now the engine, the command and the server), `smoke`, `smoke:bundled`, `smoke:globals`, `smoke:cli` and `smoke:mcp` passed, as did `npm run typecheck` (all three packages), `typecheck:tests` (at its baseline of 94 errors in 30 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:error-codes`, `lint:cheatsheet`, `lint:sidebar`, `lint:ci-parity`, `lint:jest-configs`, `lint:licenses`, `audit:deps` and the proven docs examples. `npm run verify` as one command and the bundled-consumer contract (`npm run test:consumer`) were not run.
