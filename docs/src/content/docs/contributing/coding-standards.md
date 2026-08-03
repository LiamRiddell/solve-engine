---
title: Coding standards
description: Conventions for contributions.
---

## Errors

Never throw a bare error. The engine has a structured error type carrying a
code, a category and a recoverability flag, and the taxonomy is what lets a host
distinguish a user typo from an internal fault.

## Comments

Documentation comments state the contract a caller needs, since that is what
appears on hover. Reasoning about the implementation goes in short comments
beside the line it explains, not in the documentation block.

Write for someone reading the code cold. Avoid narrating history, and avoid
restating what the next line already says plainly.

## Types

No implicit or explicit escape hatches from the type system. If a type is hard
to express, that usually indicates the design needs adjusting rather than the
checker needing silencing.

## Size

Keep functions small enough to read without scrolling and classes focused on one
responsibility. Both limits are guidance rather than a lint rule, but a function
that has outgrown a screen is usually doing two things.

## Before submitting

```bash
npm run verify
```
