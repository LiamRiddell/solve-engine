---
title: Highlighting and completions
description: Give a package's own tokens a highlight colour, and its vocabulary editor completions.
---

Two fields wire a package into an editor: `tokenCategories` colours the tokens it
introduces, and `completionItems` offers its vocabulary as suggestions. Both feed
the engine's editor-agnostic language service, so one entry serves every editor
integration rather than one per editor.

## Highlighting your tokens

A token type your package introduces, a unit you lexed or a phrase you fused, is
lexed and parsed correctly on its own. But an editor has no colour for it until
you give it one. `tokenCategories` maps each of your token types to a category:

```ts
tokenCategories: {
  FACTOR_FN: "keyword",
  IMAGINARY: "number",
  MY_ITEM: "my-plugin-item",
}
```

The keys are your token types, the ones your parselets and fusion rules produce;
the values are categories. The built-in categories cover the core token types:
`number`, `string`, `keyword`, `operator`, `comparison`, `bitwise`, `function`,
`variable`, `unit`, `datetime`, `vector`, `punctuation`, `error`. You can also
coin your own string, `"my-plugin-item"` above, for a token that is genuinely new,
and an editor adapter maps it to a class of its own.

A category is a name, not a colour. An adapter turns it into a CSS class or a
semantic-token index, which is why the same package highlights the same way in
every editor, and why a token with no entry here simply renders uncoloured rather
than wrongly.

## Offering completions

`completionItems` is the list an editor offers as the reader types. Much of a
package's vocabulary is offered without it:

- a **lexer keyword** (added through [lexer vocabulary](/packages/units-and-keywords/)),
  provided its token type has a `tokenCategories` entry. A keyword with no
  category is still lexed and parsed, but it is never offered, since a completion
  carries its token's category;
- a **call word** (`callFusions`), offered as a function: `sha` offers `sha256`;
- a **phrase** (`phrases`), offered whole by its opening words: `averag` offers
  `average of`, and `net pres` offers `net present value of` across the words
  already typed.

So this field is for candidates that are none of those: a vocabulary of names,
for instance.

```ts
completionItems: [
  { label: "Abyssal whip", category: "my-plugin-item", detail: "Item" },
]
```

Each item is a `label`, a `category` (reusing the highlighting taxonomy, so a
suggestion can carry its token's colour), and an optional `detail` shown beside
it. It is a plain, static list rather than a callback: completions are meant to be
cheap, so build the list once when you construct the package, not per keystroke. A
long vocabulary is fine; a computed one is what to avoid.

When a word reaches the list by two routes, a function your package defines that
is also a call word, your `completionItems` entry is the one kept, so its
`detail` (a signature, say) is what the editor shows.

Suggestions come in a fixed order, at most 50 of them: the document's own
variables first, then the grammar (functions, keywords, operators and the other
built-in categories), then units, then every category the table does not list,
your own (`my-plugin-item` above) among them. Within a group they are
alphabetical in the default locale's collation, and two with the same label keep
the order they were gathered in, your `completionItems` before the built-in
vocabulary. A category named after a property every object inherits
(`constructor`, `toString`) is an unlisted one like any other.

A phrase matched across the words already typed carries `replaceLength`, the
number of characters before the cursor the label replaces (8 for `net pres`). An
editor that replaces only the word under the cursor would otherwise write `net
net present value of`.

## Where they surface

Both flow through the `LanguageService`. `getSemanticTokens` reads your categories
to colour a line, and `getCompletions` merges your items with the built-in
keywords, call words, phrases and units, and with the document's own variables and
the units it defines (`1 sprint = 2 weeks` makes `spr` offer `sprint`). An editor
integration calls those two methods and never needs to know which package a
colour or a suggestion came from.

## One engine's categories

The categories belong to the engine the package is registered on. An editor
asks that engine, `engine.getTokenCategory(type)`, or its language service,
`languageService.getTokenCategory(type)`, and the answer reads the engine's own
packages first and the built-in table after. Two engines in one process each
answer from their own packages, so unregistering a package from one leaves its
colours in place on another that still holds it.

The boundary: the module-level `getTokenCategory(type)` from
`solve-engine/language` still exists, deprecated, so existing imports compile.
It reads the built-in table and nothing any engine registered, since it has no
engine to ask; a highlighter that painted a package's token through it paints
it uncoloured until it asks the engine. It is removed in 3.0, with the
module-level `registerTokenCategory` and `unregisterTokenCategory`, which write
a table no engine reads.

## Highlighting what the normaliser fuses

By default a line is highlighted from the lexer's tokens alone, so a word the
normaliser turns into something else later is coloured as what it was lexed as.
A call word is the common case: `sha256("abc")` highlights `sha256` as a
variable, because the lexer reads an ordinary word, and only the normaliser makes
it a call. Pass `normalizeForHighlighting: true` when building the service and the
line is normalised before it is coloured, so `sha256` is a `function` and a
phrase or a fused date reads as one span:

```ts
import { LanguageService } from "solve-engine/language";

const service = new LanguageService(engine, { normalizeForHighlighting: true });
service.getSemanticTokens('sha256("abc")', 1)[0].category; // "function"
```

It is off by default because it is work on every keystroke. On the language
service benchmark a short line took about 0.003 ms to highlight and about
0.007 ms normalised, and a long one about 0.027 ms and 0.094 ms: roughly two to
three and a half times the cost, still far inside a keystroke. A cached line
costs the same either way, since only a changed line is highlighted again.
