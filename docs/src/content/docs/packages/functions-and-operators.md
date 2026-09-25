---
title: Adding functions and operators
description: A parselet parses your syntax, a plugin function computes the result; here is the whole path from word to value.
---

A new function like `double(x)` or a new operator uses three fields together:

- a **prefix parselet** (or an **infix parselet**) parses the syntax into bytecode,
- a **plugin function** is the handler the virtual machine runs,
- and the lexer turns the word into a token in the first place (see
  [adding units and keywords](/packages/units-and-keywords/)).

The flow is: the lexer turns `double` into a token, your parselet parses the
arguments and emits a call, and the VM runs your handler on the evaluated
arguments and pushes its result. This page walks a complete `double(x)` through
it.

## The whole package

Here is `double(x)`, end to end, in one file:

```ts
import type { IEnginePackage } from "solve-engine";
import type { PrefixParselet, Parser, BytecodeBuilder } from "solve-engine/parser";
import type { Token } from "solve-engine/lexer";
import { BindingPower } from "solve-engine/parser";
import { numberValue, errorValue, type Value } from "solve-engine/vm";

const DOUBLE_FN = "double";

// 1. The handler the VM calls with the evaluated arguments.
function doubleHandler(args: Value[]): Value {
  if (args.length !== 1) return errorValue("DOUBLE_BAD_ARGS", "double(x) takes one number");
  return numberValue(args[0].toNumber() * 2);
}

// 2. The parselet that parses `double( ... )` and emits the call.
class DoubleParselet implements PrefixParselet {
  readonly category = "Example";
  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    parser.consume("LPAREN");
    parser.parseExpression(BindingPower.Lowest, builder); // emits the argument's bytecode
    parser.consume("RPAREN");
    builder.emitPluginCall(DOUBLE_FN, 1);                 // 1 = argument count
  }
}

// 3. The package wires the word, the parselet and the handler together.
export const DOUBLE_PACKAGE: IEnginePackage = {
  name: "example-double",
  lexerVocabulary: { keywords: { double: "DOUBLE_KEYWORD" } },
  prefixParselets: { DOUBLE_KEYWORD: new DoubleParselet() },
  pluginFunctions: { [DOUBLE_FN]: doubleHandler },
};
```

`double(21)` now reads `42`. The three pieces agree by name: the parselet calls
`emitPluginCall("double", 1)`, and `pluginFunctions` registers the handler under
`"double"`. You never write a numeric index, the engine assigns one when it
registers the package and stores your handler at it, so the emit site and the call
site cannot drift.

## The parselet

A prefix parselet is a token that **starts** an expression, a function name, a
literal. It implements one method:

```ts
interface PrefixParselet {
  readonly category: string; // a label for diagnostics
  parse(parser: Parser, token: Token, builder: BytecodeBuilder): void;
}
```

Its job is to consume its tokens (`parser.consume(...)`), parse any sub-expressions
(`parser.parseExpression(bindingPower, builder)`, which emits their bytecode for
you), and emit the call. `emitPluginCall(name, argCount)` is the important line: it
looks the name up in the engine's function table and emits `CALL_PLUGIN`, the
assigned index, and the argument count. The example package is the smallest
complete one to read; the colour package's call parselet shows a comma-separated
argument list.

## The plugin function

A handler takes the already-evaluated arguments and returns a `Value`:

```ts
type PluginFunctionHandler = (args: Value[], context?: LineExecutionContext) => Value | Promise<Value>;
```

`args[0]` is the first argument, evaluated. Read a number with `args[i].toNumber()`,
a string with `args[i].value as string`, and check `args[i].type` against
`ValueType` for a typed argument. Build the result with a factory: `numberValue`,
`stringValue`, `uomValue(n, "hours")`, `boolValue`, `percentageValue`. The optional
`context` (a `LineExecutionContext`, exported from `solve-engine/vm`) carries the
line's cross-line data and the engine's calendar backend; ignore it unless you
need it. A handler that reads or steps a date takes the backend with
`calendarOf(context)` from `solve-engine/engine` rather than reading
`context.calendar` directly, because the context is optional (a direct call from
a test passes none) and `calendarOf` answers the built-in `Date` backend in that
case.

A handler may return a `Promise<Value>` for data it has to fetch. The line goes
pending, and when the promise settles the engine announces the line
(`lines-updated`) and re-evaluates it, calling the handler once more. A handler
that stored what it fetched can answer that call directly, and its answer is
used. A handler that returns another promise instead is answered with what the
first one settled to, and is not called again for that argument list, so it is
called at most twice per distinct argument list. A re-evaluation while the
promise is still in flight gets the same promise, and two lines with the same
arguments share the call. Arguments that differ in type or unit (`5`,
`"5"`, `5 m`) are separate calls. A rejection settles to a `PLUGIN_CALL_FAILED`
error carrying the rejection's message, and a promise that resolves to anything
other than a Value settles to `PLUGIN_RESULT_NOT_A_VALUE`.

What a call settled to is kept for the life of the engine (up to a thousand
calls, oldest dropped first) and is dropped when the package is unregistered.
A raw handler has no refresh cadence and no retry, so a value that goes stale,
or a request that should be tried again after a failure, wants an
[async data source](/guide/async-data-sources/) built on `createQueryResolver`,
which pairs the fetch with its own cache and refresh interval.

Check your own arguments, and return an `errorValue(code, message)` rather than
throwing when they are wrong, as `doubleHandler` does above. A returned error is a
value the reader sees on that one line; a thrown one is harder for a host to place.

### Asking what another line would say

Sometimes a handler needs another line's answer under different inputs, rather
than its answer as the note stands: what line 4 would be if `deposit` were
200,000. `context.rerunLines(lineNumber)` opens that question. It is the
primitive the [what-if and sweep](/syntax/what-if/) forms are built on: the lines
from the top of the document down to `lineNumber` are run again from their text,
in a scratch engine, with the names you pass held at the values you pass, and the
note itself is not touched. Because the lines are re-run rather than read, an
input reaches the line through every line between.

```ts
import { numberValue, errorValue, Value, type LineExecutionContext } from "solve-engine/vm";

// atDoubleDeposit(4): line 4's answer with deposit at 200,000.
function atDoubleDepositHandler(args: Value[], context?: LineExecutionContext): Value {
  const opened = context?.rerunLines?.(args[0].toNumber());
  if (opened === undefined) {
    return errorValue("NEEDS_DOCUMENT", "atDoubleDeposit only works inside a document.");
  }
  if (opened instanceof Value) return opened; // why the re-run could not open
  try {
    if (!opened.uses("deposit")) {
      return errorValue("DEPOSIT_NOT_USED", "No line up to that one uses deposit.");
    }
    return opened.run(new Map([["deposit", numberValue(200000)]]));
  } finally {
    opened.close();
  }
}
```

The contract, in the order a handler meets it:

- `rerunLines` is absent where there is no document, the single-expression
  entry point. Answer with an error that says a document is needed.
- It returns either an open session or an error Value: the line is out of range,
  the handler is already running inside another re-run, or a line in the span
  sets a `global :name` (which other documents read, so it is never re-run).
  Pass the error on.
- `uses(name)` says whether any line in the span, other than the one asking,
  mentions the name. Overriding a name nothing uses cannot change the answer, so
  refuse it as the likely misspelling it is.
- `run(overrides)` returns the line's answer, or an error Value when it has none:
  the line is prose or a heading, holds several inline answers, fails, or waits
  on live data the scratch engine does not fetch. Call it as many times as you
  need; each call is a fresh pass from the top.
- `close()` releases the scratch engine. Call it once, in a `finally`.

Each `run` re-runs every line above the target, so bound how many a handler
makes. The sweep form caps itself at 1,000 values and 100,000 line re-runs, and
refuses past either by name. A handler that re-runs lines should also charge them
to the pass through `context.spendWork(lineRuns, form)`, as the built-in what-if
and sweep do: it returns the refusal when the note's budget
(`vm.maxLineRunsPerPass`) would be crossed, and null once the work is counted.

## Operators, not just functions

An **infix** parselet handles a token that **joins** a value already parsed to the
next one, an operator. It adds a binding power, which is its precedence:

```ts
interface InfixParselet {
  readonly category: string;
  readonly bindingPower: number;
  parse(parser: Parser, left: Token, token: Token, builder: BytecodeBuilder): void;
}
```

By the time `parse` runs, the left operand's bytecode is already emitted, so the
parselet only parses the right operand and emits the operator:

```ts
class BinaryOpParselet implements InfixParselet {
  readonly category = "Example";
  readonly bindingPower = BindingPower.Sum; // higher binds tighter
  constructor(private readonly opcode: OpCode) {}
  parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
    parser.parseExpression(this.bindingPower, builder); // the right operand
    builder.emitOpcode(this.opcode);
  }
}
```

The parser reads precedence from the binding power, so `2 + 3 * 4` groups
correctly without the `+` parselet knowing anything about `*`. Associativity,
which way a chain of the same operator groups, is a separate declaration:
`rightAssociative: true` on the parselet makes `2 ^ 3 ^ 2` read as
`2 ^ (3 ^ 2)`, and leaving it out gives the left grouping every other operator
wants. Parse the right operand through `parseRightOperand(this, parser, builder)`
rather than calling `parser.parseExpression` with a power of your own, and the
declaration does the work: it parses one power below the operator's own for a
right-associative operator, and at the operator's own power otherwise. The
registry reports the declaration (`getAllInfix()` carries `associativity`), so
a precedence table built from it says what the parser does.
The named ladder (`Sum`, `Product`, `Exponent`, `Call`, and the rest) is what to
pick a level from. Register it under `infixParselets` keyed by the operator's token
type. Arithmetic's `+` is the reference; currency's `in` and the conditionals'
`==` are operators that read differently but hook in the same way.

## Do not hardcode the index

`emitPluginCall(name, ...)` exists so you never touch the numeric index. The VM's
function table is one shared map keyed by number; two packages that both hardcoded
the same index would overwrite each other's handler, and the loser's calls would
silently run the wrong function. Registering by name lets the engine hand each
function a distinct slot. The one time a package reads the raw index is to bridge
to something else, an async resolver that scans bytecode for its own call, and
even then it asks `pluginFunctionIndexFor("package:fn")` for a stable one rather
than writing a literal.

## A note on the fast path

The parser handles the most common token types inline for speed, ahead of the
parselet registry. A consequence is that a handful of token types cannot be
overridden by a package. As a prefix (the start of a value) the fast path claims
`NUMBER`, `BIGINT`, `STRING`, `IDENT`, `LPAREN`, `MINUS` and `PLUS`; as an
infix (an operator between values) it claims `+`, `-`, `*`, `/`, `mod`, `^`,
`|`, `xor`, `&`, `<<`, `>>`, `>>>`, the postfix `%` and `of`. A parselet
registered for one of those is kept for diagnostics but never runs. The reasoning
is documented in the source next to the switch, so if a parselet you register
never seems to run, check whether its token type is in that list.
