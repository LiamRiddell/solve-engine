---
title: The MCP server
description: solve-mcp, a Model Context Protocol server that lets an AI tool evaluate an expression, a document or its checks, with the network off, a fresh engine per call and no global variables.
---

An AI assistant is good at deciding what to calculate and less reliable at the
arithmetic itself, the unit conversions and the date counting. The Model
Context Protocol (MCP) is the common way such a tool calls a function outside
itself: a program called a server lists what it offers, each with a
description and the shape of its arguments, and the assistant calls one and
reads back the answer. `solve-mcp` is that server for the engine, so an
assistant can hand `5 km in miles`, a whole note or its checks to the engine
and quote the engine's answer rather than its own estimate.

It is the [`solve` command](/guide/command-line/)'s sibling: the same waiting
for live data and the same result objects, reached through a protocol instead
of a shell.

## Getting the server

The server lives in this repository as the workspace package `packages/mcp`
(`solve-engine-mcp`), kept apart from the engine because it depends on the
official MCP SDK, which the engine's one-dependency promise has no room for
(see [security](/guide/security/#the-mcp-server)). From a checkout, install
and build:

```sh
npm ci
npm run build
```

An MCP client starts the server itself, as a child process that it talks to
over standard input and output. Most clients are configured with a block like
this one, naming the command to run:

```json
{
  "mcpServers": {
    "solve": {
      "command": "node",
      "args": ["/path/to/solve-engine/packages/mcp/dist/solve-mcp.js"]
    }
  }
}
```

Like the command, it is not yet published to npm; it runs from a checkout.

## The tools

| Tool | Takes | Answers |
| --- | --- | --- |
| `evaluate_expression` | `expression` | one answer, as `solve --json "<expression>"` prints it |
| `evaluate_document` | `document`, and `strict` | one answer per evaluated line, as `solve --json <file>` prints it |
| `check_document` | `document` | each check line and the counts, as `solve check --json <file>` prints it |

Every tool also takes `tz`, `now` and `seed`, which pin the time zone, the
clock and random draws exactly as the command's `--tz`, `--now` and `--seed`
do (see [the same answer on every run](/guide/determinism/)); given `now`
without `tz`, dates are read in UTC.

A call answers with its result object twice: as `structuredContent`, for a
client that reads JSON, and as a text block holding the same JSON, for one
that shows text. Each object carries `ok`, which is true when every line
answered or every check passed, in place of the command's exit status. A call
to `evaluate_expression` with `5 km in miles` answers:

```json
{
  "expression": "5 km in miles",
  "status": "answered",
  "display": "= 3.11 miles",
  "code": null,
  "value": { "type": 6, "value": 3.1068559611866697, "unit": "miles" },
  "ok": true
}
```

and `check_document` with a note whose second check does not hold:

```solve-doc
:a = 2 // 2
check a == 3 // ERROR: check failed: 2 is not equal to 3
```

```json
{
  "checks": [
    {
      "line": 2,
      "text": "check a == 3",
      "status": "failed",
      "display": "check failed: 2 is not equal to 3",
      "code": "CHECK_FAILED"
    }
  ],
  "passed": 0,
  "failed": 1,
  "unevaluated": 0,
  "pending": 0,
  "ok": false
}
```

A line that answered with an error is still an answer: `ok` is false and the
line carries its code, but the call itself succeeded. A call the engine refuses
as a whole comes back marked as an error (`isError`), with a code and a
message and nothing else, such as a document past the engine's limit of
100,000 lines:

```json
{ "error": { "code": "DOCUMENT_TOO_LARGE", "message": "This document has more than 100,000 lines, which is the most the engine will hold at once" } }
```

The server's own refusals are `INPUT_TOO_LARGE`, for an expression or document
longer than a million characters, and `INPUT_INVALID`, for an empty
expression, a zone the server does not know, or a `now` that is not a moment.

## What a call cannot do

A tool call is text a model wrote, which may carry whatever was in the
document or the conversation it was reading. So the server's defaults are the
narrow ones, and none of them can be changed by a call:

- **The network is off.** A line that would fetch live data (weather, exchange
  rates, prices) answers with the code `NETWORK_DISABLED` instead. Whoever
  starts the server can allow it with `--network on`; a call cannot.
- **Every call gets a fresh engine**, cleared when the call ends, whatever
  happened. A variable, a unit defined with `1 sprint = 2 weeks`, a cached rate:
  none of it survives into the next call, so one call cannot read what another
  wrote.
- **There are no global variables.** `global :name` is the one form that reaches
  outside a document, into a store every engine in the process shares. The
  server's engines are built without the package that provides it, so the line
  is a parse error (`NO_PREFIX_PARSELET`) and the store cannot be reached.

A call that asks for live data under `--network on` waits for it for up to ten
seconds (`--wait <ms>` changes that, up to ten minutes); a line whose data has
not arrived by then is reported as `pending`, and the call ends at the deadline
rather than when the fetch gives up.

## Options

| Option | What it does |
| --- | --- |
| `--network on\|off` | Allow tool calls to fetch live data. Off unless given. |
| `--wait <ms>` | How long a call waits for live data, from 0 to 600,000. 10,000 unless given. |
| `-h`, `--help` | Show the usage, on standard error. |
| `-V`, `--version` | Show the server's version and the engine's, on standard error. |

Standard output carries the protocol and nothing else: anything the engine or a
package logs is sent to standard error, since a stray line on standard output
would reach the client as a malformed message. The process exits when the
client closes its end.

## The boundary

The server offers tools only: no prompts, no resources, and no transport but
standard input and output, which is what a client that starts the server as a
child process uses. It does not read files; a document reaches it as the text
of a call. The JSON Schema description of the engine's syntax that a
`solve-engine/tool` subpath might one day carry is set aside, and the tools'
schemas live in this package. Publishing to npm needs a first release of its
own, as the command does.
