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

## Dispatch

A switch over the opcode. The most frequent arithmetic paths have an inlined
fast path for the case where both operands are plain numbers, which avoids a
function call and an allocation in the common case.

## Safety

Every instruction increments a counter and checks the stack depth. Both limits
are configurable and both produce a named error. This matters because the input
is untrusted and arrives one keystroke at a time.

## Values on the stack

The stack holds values, not raw numbers, so a unit, an error or a pending state
survives an operation instead of being flattened into a number.
