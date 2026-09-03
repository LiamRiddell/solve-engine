---
title: Adding units and keywords
description: Teach the tokeniser a new unit, keyword or operator through lexerVocabulary.
---

`lexerVocabulary` is how a package adds words and symbols to the tokeniser, the
first stage of the pipeline. It is a plain object with three fields you are likely
to use:

```ts
interface LexerVocabulary {
  keywords?: Record<string, string>;  // a word → the token type it becomes
  operators?: Record<string, string>; // a two-character symbol → a token type
  units?: string[];                    // extra unit spellings
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

Registration is all or nothing: if any keyword, operator or unit in a vocabulary
collides with a built-in, nothing from that vocabulary is registered and the
engine throws a `CONFIG` error naming the collision. Two packages may claim the
same word (the engine's compatibility check warns when they do). The one
registered last is in force, and unregistering it hands the word back to the
other rather than removing it for both.

## When not to add a keyword

A lexer keyword is **unconditional**: once you claim `prev`, that word is your
token everywhere it appears, and `:prev = 5` can no longer define a variable named
`prev`. That is fine for a word no one would assign to, but wrong for an ordinary
one. When the word is one a reader might reasonably use as a variable, `total`,
`solve`, `factor`, do not add it here. Claim it only in the position where it is
syntax, with a normalizer rule, so the variable keeps working. See
[recognising phrases and words](/packages/recognising-phrases/) for how.
