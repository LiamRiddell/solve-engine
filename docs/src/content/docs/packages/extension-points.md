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

A rule can also fuse a word only in the position where it means something. The
algebra package claims `factor`, `solve` and `expand`, all ordinary English
words, by fusing them only when the very next token is an opening parenthesis.
`factor(x^2-4)` is a call and `:factor = 1.5` is still a variable, and neither
had to be given up for the other. Prefer this over a lexer keyword whenever the
word is one a person might reasonably assign to.

### Priority, not registration order

Each rule declares a `priority`. Rules are tried highest-first at every token
position, and the normalizer runs the stream through **multiple passes**. This
is the ordering contract, and it is why the order you register packages in does
not decide composition: a rule that reads a token another rule mints just needs
a **lower** priority than that rule, and a later pass sees the minted token. The
goal-seek package reads a `LINE_REF` the lines package fuses precisely this way,
and the two work in either registration order.

So to control ordering, set priorities, not list position. Give a long phrase a
higher priority than a shorter fragment of it, and give a rule that consumes
another's output a lower one.

Name each rule uniquely, prefixed with your package name (`mypackage:my-rule`),
the way the built-ins do (`uom:compound-unit`, `lines:line-ref`). The normalizer
unregisters rules by name, so two packages sharing a rule name means removing
one drops both; `checkPackageCompatibility` warns when it sees a shared name.

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
