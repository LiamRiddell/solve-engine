---
title: The bytecode virtual machine
description: Why bytecode, and how the machine is structured.
---

## Why bytecode

Walking a syntax tree repeatedly is slow, and the engine re-evaluates constantly.
Compiling to a flat instruction sequence once and executing it many times is
substantially faster, and it makes execution easy to bound.

## Shape

The program is a byte array of opcodes and operands, with separate pools for
numeric and string constants. Operands are single bytes, which caps a pool at
256 entries and is checked at compile time.

```mermaid A compiled program. Operands index into the pools, never into the code.
flowchart LR
  subgraph program["Program"]
    direction TB
    code["<b>Code</b><br/>PUSH_NUM 0 · PUSH_NUM 1 · ADD"]
    nums["<b>Number pool</b><br/>[0] 25 · [1] 80"]
    strs["<b>String pool</b><br/>[0] USD"]
  end

  code -->|"operand 0"| nums
  code -->|"operand 1"| nums
  program --> stack["<b>Stack</b><br/>values, not raw numbers"]
```

## Dispatch

A switch over the opcode. The most frequent arithmetic paths have an inlined
fast path for the case where both operands are plain numbers, which avoids a
function call and an allocation in the common case.

## Safety

Every instruction increments a counter and checks the stack depth. Both limits
are configurable and both produce a named error. This matters because the input
is untrusted and arrives one keystroke at a time.

```mermaid One turn of the dispatch loop. Both limits are checked before any work happens.
flowchart TD
  fetch["Fetch the next opcode"] --> budget{"Instruction budget<br/>left?"}
  budget -->|"no"| limitErr["Named limit error"]
  budget -->|"yes"| depth{"Stack depth<br/>within bounds?"}
  depth -->|"no"| limitErr
  depth -->|"yes"| switchOp{"Which opcode?"}

  switchOp -->|"arithmetic"| fast{"Both operands<br/>plain numbers?"}
  fast -->|"yes"| inline["Inlined path:<br/>no call, no allocation"]
  fast -->|"no"| general["General path:<br/>units, errors, pending"]

  switchOp -->|"anything else"| general

  inline --> next["Advance"]
  general --> next
  next --> fetch
  switchOp -->|"HALT"| done["Return the value on top of the stack"]
```

## Values on the stack

The stack holds values, not raw numbers, so a unit, an error or a pending state
survives an operation instead of being flattened into a number.
