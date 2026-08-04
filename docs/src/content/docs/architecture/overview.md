---
title: Overview
description: How the pieces fit together.
---

The engine is a pipeline with a plugin system attached to it, plus a caching
layer that makes it viable to run continuously.

```mermaid The three parts, and where each one touches the pipeline.
flowchart TD
  text["Document text"] --> lex

  subgraph pipeline["Pipeline"]
    direction TB
    lex["Lexer"] --> norm["Normaliser"]
    norm --> parse["Parser"]
    parse --> compile["Compiler"]
    compile --> vm["Virtual machine"]
  end

  vm --> value["Value"]

  packages["Packages"] --> registries["Registries"]
  registries -.-> lex
  registries -.-> norm
  registries -.-> parse

  caches["Caches"] -.-> compile
  caches -.-> vm
```

## Stages

Text goes through five stages: lexing, normalisation, parsing, compilation, and
execution. Each stage has a single responsibility and hands a well-defined
structure to the next.

The unusual stage is normalisation. It sits between lexing and parsing and
rewrites the token stream, fusing multi-word phrases into single tokens and
making implicit operators explicit. It is what allows natural phrasing without
turning ordinary words into reserved words.

## Values

Execution produces a value: a type, a payload, and sometimes a unit. Errors and
pending states are values too, which means they propagate through arithmetic
instead of being coerced into numbers.

## Packages

Every feature is a package, registered into shared registries at startup. The
pipeline itself knows nothing about percentages, dates or currencies.

## Caching

Three layers. Compiled bytecode is cached by expression text. Line results are
cached by line. A dependency graph tracks which lines depend on which variables,
so an edit recomputes only what it must.

```mermaid What happens to the other lines when line 3 is edited.
flowchart TD
  edit["Line 3 edited"] --> deps{"Dependency graph:<br/>who reads line 3?"}
  deps -->|"nobody"| one["Recompile and run line 3 only"]
  deps -->|"lines 7 and 9"| many["Invalidate 3, 7 and 9"]
  many --> bytecode{"Seen this<br/>expression text before?"}
  bytecode -->|"yes"| reuse["Reuse the cached bytecode"]
  bytecode -->|"no"| recompile["Compile it"]
  reuse --> run["Run"]
  recompile --> run
  one --> run
  run --> rest["Every other line keeps its cached result"]
```

## Further reading

The repository contains a much longer architecture document covering the
bytecode format, the virtual machine's dispatch loop, the safety limits and the
known gaps. It is aimed at contributors rather than users.
