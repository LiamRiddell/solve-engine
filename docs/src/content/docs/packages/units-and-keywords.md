---
title: Adding units and keywords
description: Teach the tokeniser a new unit, keyword or operator through lexerVocabulary.
---

`lexerVocabulary` is how a package adds words and symbols to the tokeniser, the
first stage of the pipeline. It is a plain object with three fields you are likely
to use, and a fourth for the rare line that is free text rather than an expression:

```ts
interface LexerVocabulary {
  keywords?: Record<string, string>;  // a word → the token type it becomes
  operators?: Record<string, string>; // a two-character symbol → a token type
  units?: string[];                    // extra unit spellings
  rawLinePatterns?: Array<{ pattern: RegExp; tokenType: string }>; // a whole line as one token, see below
}
```

You write it as a literal on your package; there is no builder to learn.

## Adding a unit

A unit is the simplest case, because the built-in units package already knows what
to do with one. List the spelling:

```ts
export const myPackage: IEnginePackage = {
  name: "my-game",
  lexerVocabulary: { units: ["gp"] },
};
```

Now `10 gp` lexes as a number followed by a `UNIT` token, and parses into a
quantity tagged `gp`, with no parselet of your own. That is because `10 gp` is
read by the same machinery as `10 km`: the units package's parselet handles every
`UNIT` token, and it is registered by default.

Two things to know. The engine already recognises roughly a thousand unit
spellings (`km`, `°C`, `mph`, and the rest), derived from its conversion tables,
so you only add a `units` entry for a spelling it does not have; adding one that
collides is refused with a clear error. And unit spellings are case-sensitive,
`C` is Celsius and `c` is a cup, so add the exact spelling you mean. Converting
your unit (`10 gp to X`) only works if a conversion is defined for it; until then
it carries as a quantity tagged with your unit, which is usually what a game
currency or a domain unit wants.

## Adding a keyword

A keyword maps a word to a token type of your choosing:

```ts
lexerVocabulary: { keywords: { prev: "PREV" } }
```

Unlike a unit, a keyword does nothing on its own, its token type is unhandled
until you register a parselet for it. Pair it with a prefix parselet keyed by the
same type:

```ts
export const myPackage: IEnginePackage = {
  name: "my-lines",
  lexerVocabulary: { keywords: { prev: "PREV" } },
  prefixParselets: { PREV: new PrevParselet() },
};
```

The lines package does exactly this for `prev`. See
[adding functions and operators](/packages/functions-and-operators/) for the
parselet.

Operators work the same way, for a two-character symbol: `operators: { "~>": "MY_OP" }`,
paired with an infix parselet. The engine's own comparison and shift operators
(`==`, `!=`, `>=`, `<=`, `<<`, `>>`) always win and cannot be overridden.
An operator is exactly two characters, and the first must be one the scanner
already reads as an operator (`+ - * / ^ % ( ) [ ] { } , : ; = ? & | ~ ! < >`);
any other shape is refused with `PLUGIN_OPERATOR_UNSUPPORTED` rather than
registered and never matched.

Registration is all or nothing: if any keyword, operator or unit in a vocabulary
collides with a built-in, nothing from that vocabulary is registered. What
happens next depends on how the package was registered:

- `engine.registerPackage(pkg)` throws a `CONFIG` error naming the collision
  (`PLUGIN_KEYWORD_COLLISION`: `Plugin keyword "sqrt" conflicts with built-in
  keyword (type: FUNC). Built-in keywords cannot be overridden.`), so the caller
  knows at once.
- The `ExpressionEngine` constructor and `createEngine({ extraPackages })` build
  the engine without the package and log the same error with `console.error`,
  so one bad package cannot stop an engine being built. Nothing is thrown, and
  every line that uses the package then fails to parse.

`createTestEngine` from `solve-engine/testing` registers the package under test
through `registerPackage`, so a test sees the thrown error rather than the log. Two packages may claim the
same word (the engine's compatibility check warns when they do). The one
registered last is in force, and unregistering it hands the word back to the
other rather than removing it for both.

## Whole-line patterns

Everything above works on words: the lexer reads a line one token at a time, and
each word you add becomes a token. A few packages need the opposite: to take a
whole line as free text, because what the reader writes there is not an
expression at all and would never lex as one. The knowledge package is the built-in
case: `ask: distance to the moon` hands `distance to the moon` to a lookup, where
the words, the apostrophes and the brackets a question might hold would otherwise
be read as variables, strings and syntax errors.

`rawLinePatterns` is that hook. Each entry is a regular expression tested against
the line as written, before the lexer reads a character of it, and a token type.
When the pattern matches and its first capture group is not empty once trimmed,
the whole line becomes a single token of that type, whose value is the trimmed
capture, and the lexer does nothing else with it. Your prefix parselet for that
token type reads the text from the token.

```ts
import type { IEnginePackage } from "solve-engine";
import type { PrefixParselet, Parser, BytecodeBuilder } from "solve-engine/parser";
import { OpCode } from "solve-engine/parser";
import type { Token } from "solve-engine/lexer";
import { stringValue, type Value } from "solve-engine/vm";

// The whole line after "shout:" arrives as one token; this pushes its text and calls the function.
class ShoutParselet implements PrefixParselet {
  readonly category = "Example";
  parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(String(token.value));
    builder.emitPluginCall("shout", 1);
  }
}

export const shoutPackage: IEnginePackage = {
  name: "example-shout",
  lexerVocabulary: {
    rawLinePatterns: [{ pattern: /^shout:\s*(.+)$/i, tokenType: "SHOUT_LINE" }],
  },
  prefixParselets: { SHOUT_LINE: new ShoutParselet() },
  pluginFunctions: { shout: (args: Value[]) => stringValue(String(args[0].value).toUpperCase()) },
  tokenCategories: { SHOUT_LINE: "string" },
};
```

`shout: it's 5 o'clock (really)` now reads `IT'S 5 O'CLOCK (REALLY)`. The
apostrophes and the brackets never reached the lexer, which is the point.

The contract:

- **The pattern sees the whole line.** Anchor it (`^...$`) so it matches only
  the lines you mean; `please shout: x` is not matched by the pattern above and
  is read as an ordinary line.
- **Capture group 1 is the text.** A match whose first group is empty, or only
  spaces, is not a match, so `shout:` alone is lexed as usual.
- **First match wins**, in registration order, across every package.
- **A `g` or `y` flag is dropped** when the pattern is registered, since either
  would carry a position from one line to the next.

The boundary: this is for a line that is free text by design. A line that is an
expression with an unusual word in it wants a keyword or a
[phrase](/packages/recognising-phrases/) instead, because a whole-line pattern
takes the line away from every other package, and from the reader's variables,
for as long as it matches.

## When not to add a keyword

A lexer keyword is **unconditional**: once you claim `prev`, that word is your
token everywhere it appears, and `:prev = 5` can no longer define a variable named
`prev`. That is fine for a word no one would assign to, but wrong for an ordinary
one. When the word is one a reader might reasonably use as a variable, `total`,
`solve`, `factor`, do not add it here. Claim it only in the position where it is
syntax, with a normalizer rule, so the variable keeps working. See
[recognising phrases and words](/packages/recognising-phrases/) for how.
