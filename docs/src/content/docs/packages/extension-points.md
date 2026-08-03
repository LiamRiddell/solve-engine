---
title: Extension points
description: The five places a package can hook into the pipeline.
---

The pipeline has five stages, and a package can contribute to each.

## Lexer vocabulary

Adds keywords, operators and units to the tokeniser. This is how `km` becomes a
unit token rather than an identifier.

## Normalizer rules

Rewrites the token stream before parsing. This is where multi-word phrases fuse
into a single token, and where implicit operators are inserted.

Fusion is the mechanism that lets `next friday` be one thing without `next` or
`friday` becoming reserved words.

## Parselets

Parsing rules, registered per token type. A prefix parselet handles a token that
starts an expression; an infix parselet handles one that joins two.

The parser uses precedence climbing, so a parselet declares a binding power and
the parser handles associativity.

## Plugin functions

Functions the virtual machine can call, addressed by index. Register the index
through the allocator rather than hardcoding it, which is what prevents two
packages from colliding.

## Conversion targets

Entries for the `as` form. These are a flat map from name to a function, and are
the simplest extension point to use.

## A note on the fast path

The parser handles the most common token types inline for speed, ahead of the
registry. A consequence is that a handful of token types cannot be overridden by
a package. This is documented in the source next to the switch, along with the
reasoning.
