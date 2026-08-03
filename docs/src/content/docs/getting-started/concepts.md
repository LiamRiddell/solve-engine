---
title: Core concepts
description: Lines, values, packages and the pipeline, in the order they matter.
---

Five ideas cover almost everything.

## Lines

The unit of evaluation is a line, not a file and not a cell. Each line produces
at most one result. Lines can refer to each other, which is why the engine wants
line numbers rather than only text.

## Values

Everything the engine produces is a value: a type, a payload, and sometimes a
unit. The types include numbers, but also dates, durations, matrices, ranges,
booleans, big integers, symbolic expressions, errors, and a pending state.

That last pair matters more than it sounds. An error is a value, so it flows
through arithmetic and arrives at the top with its cause intact rather than
silently becoming a confident and wrong number. Pending means the answer depends
on data that has not arrived, which is not the same as zero.

## Packages

Every piece of syntax comes from a package, including arithmetic. A package can
contribute vocabulary to the lexer, parsing rules, functions the virtual machine
can call, normalisation rules, and conversion targets.

Nineteen packages are registered by default. Two more, stocks and knowledge, are
opt-in because they need you to supply how to fetch the data.

## The pipeline

Five stages, in order:

1. **Lex.** Text becomes tokens.
2. **Normalise.** Multi-word phrases fuse into single tokens and implicit
   operators are made explicit. This is where `next friday` becomes one thing.
3. **Parse.** Tokens become a structure, using precedence climbing.
4. **Compile.** That structure becomes bytecode.
5. **Execute.** The bytecode runs on a stack virtual machine.

Compiled bytecode is cached per expression, so re-evaluating an unchanged line
skips the first four stages entirely.

## Incremental evaluation

A dependency graph records which lines read which variables. When a line
changes, only the lines that transitively depend on it are recomputed. Editing
one line of a large document does not re-evaluate the document.

That, plus the bytecode cache, is what makes it viable to run the whole pipeline
on every keystroke.
