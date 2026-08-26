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
`context` carries the line's cross-line data; ignore it unless you need it. A
handler may return a `Promise<Value>` for data it has to fetch, but for that an
[async data source](/guide/async-data-sources/) is usually the better fit.

Check your own arguments, and return an `errorValue(code, message)` rather than
throwing when they are wrong, as `doubleHandler` does above. A returned error is a
value the reader sees on that one line; a thrown one is harder for a host to place.

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

The parser reads associativity and precedence from the binding power alone, so
`2 + 3 * 4` groups correctly without the `+` parselet knowing anything about `*`.
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
overridden by a package. This is documented in the source next to the switch,
along with the reasoning, so if a parselet you register never seems to run, check
whether its token type is one the fast path claims.
