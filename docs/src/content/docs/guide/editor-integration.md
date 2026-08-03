---
title: Editor integration
description: Completions, syntax highlighting and token categories.
---

The language entry point provides what an editor needs, without assuming which
editor.

```ts
import { LanguageService } from "solve-engine/language";
```

## Completions

The service produces completion candidates for the current input, including
function names, unit names, and package-contributed keywords.

## Highlighting

Every token carries a category such as number, unit, function or operator. Map
those categories to your own theme rather than hardcoding colours, so that a
package adding new syntax is highlighted without further work.

## Checking a line parses

For deciding whether to decorate a line at all, there is a non-throwing check
that avoids constructing an error object for the common case of prose that is
not an expression. On a document that is mostly prose, that difference is
substantial.
