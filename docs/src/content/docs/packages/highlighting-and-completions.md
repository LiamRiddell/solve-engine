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

`completionItems` is the list an editor offers as the reader types. A single-word
keyword you add through [lexer vocabulary](/packages/units-and-keywords/) already
appears in completions on its own, so this field is for candidates that are **not**
keywords: a vocabulary of names, for instance.

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

## Where they surface

Both flow through the `LanguageService`. `getSemanticTokens` reads your categories
to colour a line, and `getCompletions` merges your items with the built-in
keywords and units and the document's own variables. An editor integration calls
those two methods and never needs to know which package a colour or a suggestion
came from.
