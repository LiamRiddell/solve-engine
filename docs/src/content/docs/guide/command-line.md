---
title: The command line
description: The solve command, which evaluates an expression or a whole document from a shell, and fails a CI job when a document's check lines stop holding.
---

A command line (a shell, a terminal) is where a person types a program's name
and its arguments, and where scripts and continuous-integration (CI) jobs run
programs without anyone watching. `solve` is the engine as such a program: it
evaluates one expression, or a whole document of notes, and prints the answers.
Nothing needs to be written around it, where using the engine from code means
writing a host that builds an engine, evaluates, formats and cleans up.

It is also how a document can guard itself in CI. A [check](/syntax/conditionals/#checks)
is a line that states something the note should keep true, and `solve check`
exits with a failure status when one of them stops holding, so a pull request
that breaks a budget template, a pricing sheet or a lab calculation fails its
build the way a failing test does.

## Getting the command

The command lives in this repository as the workspace package `packages/cli`
(`solve-engine-cli`). It is kept apart from the engine on purpose: the engine
reads no files and has one runtime dependency (see
[security](/guide/security/#no-io-of-its-own)), and a command that reads your
documents off disk could not keep either promise inside the same package.

From a checkout, install and build, and `npx solve` runs it:

```sh
npm ci
npm run build
npx solve "5 km in miles"
```

It is not yet published to npm, so `npm install solve-engine-cli` does not work
yet; that needs a release of its own (see the boundary below).

## One expression

Give the expression as the argument. Quote it, since a shell reads characters
such as `*`, `$` and `(` itself. The answer is printed without the `=` a note
shows in front of it.

```sh
$ solve "5 km in miles"
3.11 miles
$ solve '20% of $85'
$17.00
$ solve 5 km in miles
3.11 miles
```

Several unquoted words are joined with spaces into one expression, which is why
the last line works. A failure goes to standard error (the stream a shell keeps
apart from the answers) and the command exits with status 1:

```sh
$ solve "5 km + 3 kg"
error: length and mass cannot be added
$ solve "check 1 km == 1 mile"
check failed: 1.00 km is not equal to 1.00 mile
```

An expression that starts with a minus sign and a digit, such as `-5 + 3`, is
read as an expression, not as an option; for anything else that starts with a
minus, put `--` before it (`solve -- -x + 1`).

## A document

A document is a note: a Markdown or plain-text file with one expression per
line, mixed with headings and prose, exactly what the playground and the
notepad on these pages evaluate. Name the file and `solve` evaluates it as a
whole, so a line can use a variable, a [line reference](/syntax/line-references/)
or a [tag](/syntax/category-tags/) from another line, and prints one row per
line that has an answer: its line number, the line, and the answer.

Take this note, saved as `groceries.md`:

```solve-doc
# Groceries

Prices from the shop on Saturday.
:apples = $3.20 // $3.20
:bread = $2.45 // $2.45
:milk = $1.10 // $1.10
apples + bread + milk // $6.75
check apples + bread + milk <= $7 // ✓
check bread == $2.50 // ERROR: check failed: $2.45 is not equal to $2.50
check apples ≈ $3 within 10% // ✓ (differs by 6.67%)
```

```sh
$ solve groceries.md
 4  :apples = $3.20                    = $3.20
 5  :bread = $2.45                     = $2.45
 6  :milk = $1.10                      = $1.10
 7  apples + bread + milk              = $6.75
 8  check apples + bread + milk <= $7  = ✓
 9  check bread == $2.50               check failed: $2.45 is not equal to $2.50
10  check apples ≈ $3 within 10%       = ✓ (differs by 6.67%)
solve: 1 line in "groceries.md" failed.
```

The heading and the sentence on line 3 print nothing. The engine cannot read
prose as an expression, and in a note that is expected rather than a failure,
so such lines are left out and do not change the exit status. `--strict`
counts them: it prints each with the reason it was not read and exits 1, which
suits a file that is meant to hold nothing but expressions.

A line that the engine did evaluate and that answered with an error (a failed
check, a unit that does not fit, live data that is switched off) is a failure,
and one failure is enough for exit status 1.

Give `-` instead of a file to read the document from standard input, which is
how a script passes a note it built itself:

```sh
$ printf ':a = 2\na * 21\n' | solve -
1  :a = 2  = 2
2  a * 21  = 42
```

A single word is read as a document when a file of that name exists, and as an
expression otherwise. In the rare case that an expression is also the name of a
file in the current directory, `-e` reads it as the expression.

## Checks in CI

`solve check` evaluates the document the same way and reports only its check
lines, with a closing count:

```sh
$ solve check groceries.md
 8  check apples + bread + milk <= $7  ✓
 9  check bread == $2.50               check failed: $2.45 is not equal to $2.50
10  check apples ≈ $3 within 10%       ✓ (differs by 6.67%)
3 checks: 2 passed, 1 failed
```

It exits 1 when any check does not pass, and 0 when every one does, whatever
the rest of the document holds. A check that could not be evaluated at all has
not passed either: a line written as a check that the engine could not read
(`check 1 km ==`), or whose comparison answered some other error, is counted as
"could not be evaluated" and fails the run, because a CI gate that quietly
skipped a broken check would be green over nothing. A document with no check
lines says so and exits 0.

In a GitHub Actions workflow it is one step:

```yaml
- run: npx solve check --network off notes/budget.md
```

`--network off` is worth the few characters in CI: a document that looks up a
live rate would otherwise answer with whatever the rate was when the job ran.

## JSON for programs

`--json` prints one JSON object instead of the text, for a script to read. Each
answer carries its status (`answered`, `failed`, `pending` or `not-read`), the
text the engine writes, the error code when it failed, and the value itself as
[`Value.toJSON`](/guide/results-as-json/) writes it:

```sh
$ solve --json "5 km in miles"
{
  "expression": "5 km in miles",
  "status": "answered",
  "display": "= 3.11 miles",
  "code": null,
  "value": {
    "type": 6,
    "value": 3.1068559611866697,
    "unit": "miles"
  },
  "exitCode": 0
}
```

For a document the object has a `lines` array of the same shape (with `line`
and `text` for each), and for `solve check` a `checks` array with the counts
beside it:

```sh
$ solve check --json groceries.md
{
  "checks": [
    ...
    {
      "line": 9,
      "text": "check bread == $2.50",
      "status": "failed",
      "display": "check failed: $2.45 is not equal to $2.50",
      "code": "CHECK_FAILED"
    },
    ...
  ],
  "passed": 2,
  "failed": 1,
  "unevaluated": 0,
  "pending": 0,
  "exitCode": 1
}
```

## The same answer on every run

A few lines read something from outside the document: the time, the time zone,
a random number, live data. [The same answer on every run](/guide/determinism/)
explains each; the command has an option for each one.

`--tz` names the time zone dates are read in, as an IANA name (the
`Region/City` names such as `Europe/London`). `--now` fixes the moment `today`
and `now` read, given as an instant with its offset or as milliseconds since
1970. Together they give a date that does not depend on where or when the
command ran:

```sh
$ solve --now 2026-01-01T09:00:00Z --tz Asia/Tokyo today
Thursday, January 1, 2026, 6:00:00 PM
$ solve --now 2026-03-29T01:00:00Z --tz Europe/London now
Sunday, March 29, 2026, 2:00:00 AM
```

A time with no offset, such as `2026-01-01T09:00`, is refused rather than
guessed at: whether it means nine o'clock in London or in the zone `--tz` names
is the very question the option settles. A zone the machine does not know is a
usage error that names it:

```sh
$ solve --tz Europe/Atlantis today
solve: --tz "Europe/Atlantis" is not a time zone this machine knows. Give an IANA name, such as Europe/London or America/New_York.
```

`--seed` makes [random draws](/syntax/random/) reproducible: with the same
seed, `roll`, `pick`, `shuffle` and the rest answer the same on every run.
`--network off` refuses live data (weather, exchange rates, prices), so a line
that would fetch answers with the code `NETWORK_DISABLED` instead:

```sh
$ solve --network off "weather in London"
error: Live data is switched off for this engine (network.enabled is false), so "current:London" was not fetched
```

## Live data, and exiting

With the network on (the default), a line that needs live data is not ready the
first time it is evaluated. The command waits for the fetch and evaluates again,
for up to ten seconds, or as long as `--wait` says in milliseconds. A line whose
data has not arrived by then is reported as pending and counts as a failure,
and the command exits then, not when the fetch finally gives up.

The command always ends. An engine that has fetched live data keeps a timer per
cached answer (ten minutes long, so a repeated lookup is served from the cache),
and that timer alone holds a Node process open after its script has finished;
a script using the engine directly has to call `engine.clear()` when it is done.
`solve` clears its engine at the end of every run and then exits explicitly.

## Exit status

| Status | Meaning |
| --- | --- |
| 0 | Every line answered, or for `solve check`, every check passed. |
| 1 | A line failed, a check did not pass, or live data did not arrive within the wait. |
| 2 | The command could not run as asked: an unknown or malformed option, a missing file, a directory or a device where a document was expected, a file that is not UTF-8 text, or a document past the size or line limit. |

A usage error is one line on standard error beginning `solve:`, never a stack
trace.

## Options

| Option | What it does |
| --- | --- |
| `--json` | Print one JSON object instead of text. |
| `--tz <zone>` | Read dates in this IANA time zone. |
| `--now <instant>` | The moment `today` and `now` read: `2026-01-01T09:00:00Z`, or milliseconds since 1970. |
| `--seed <value>` | Make random draws the same on every run. |
| `--network on\|off` | Allow or refuse live data. On unless given. |
| `--wait <ms>` | How long to wait for live data, from 0 to 600,000 (ten minutes). 10,000 unless given. |
| `--strict` | Count a line the engine could not read as a failure. |
| `-e`, `--expression` | Read the words as an expression, even when one names a file. |
| `-h`, `--help` | Show the usage. |
| `-V`, `--version` | Show the command's version and the engine's. |

## The boundary

The first cut deliberately has no interactive mode (a prompt that evaluates
each line as it is typed) and no watch mode (re-running when a file changes);
a shell loop or an editor with the notepad covers both for now. The command is
not yet on npm: publishing a new package name needs its own first release and
its own entry in the publish workflow, which are a maintainer's step, so for now
it runs from a checkout. A companion server for AI tools, on the same engine
with the network off and a fresh engine per call, is planned as a separate
package and is not part of this one.

Deciding what is prose is the engine's reading, not a list of words: a line it
cannot read is left out, so a typo that makes a line unreadable reads like a
sentence and does not fail a run on its own. Use `--strict` for a file of
expressions only, or `solve check` with a check over the value that matters.
The other way round, a sentence that begins with the word "check" and a space
is written as a check, so under `solve check` it is reported as one that could
not be evaluated; rephrase it or move the word. The largest document read is
16 MiB, and the engine's own limit of 100,000 lines applies beyond that.
