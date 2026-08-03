---
title: The pipeline
description: Lexing, normalisation, parsing, compilation and execution.
---

## Lexing

Characters become tokens. The lexer is vocabulary-driven, so packages add
keywords, operators and units without modifying it.

## Normalisation

The token stream is rewritten. Two things happen here.

Phrase fusion collapses a sequence of tokens into one. `next friday` becomes a
single token that the parser sees as one unit, which is why neither word has to
be reserved.

Implicit operator insertion makes hidden operations explicit, so that `2m` and
`50%` parse without special cases in the parser.

## Parsing

Precedence climbing, sometimes called a Pratt parser. Each token type has an
associated parselet and a binding power, and the parser combines them. Adding an
operator is registering a parselet, not editing a grammar.

For speed, the most common token types are handled by an inline fast path ahead
of the registry lookup.

## Compilation

The parse emits bytecode directly rather than building a syntax tree first. The
result is a compact program plus constant pools for numbers and strings.

## Execution

A stack virtual machine runs the bytecode. The dispatch loop bounds instruction
count and stack depth on every instruction, so a pathological expression fails
with a clear error instead of hanging.
