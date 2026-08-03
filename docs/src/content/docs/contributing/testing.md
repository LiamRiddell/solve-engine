---
title: Testing
description: How the suite is organised, including the documentation tests.
---

```bash
npm run test:ci
```

Around 3,800 tests across 175 suites. They run against source rather than the
built package, so a failure points at a line you can edit.

## Organisation

Tests live beside the area they cover: lexer, parser, virtual machine, each
package, and a set of integration suites that drive a real engine end to end.

There is also a directory of regression tests named after the specific defect
each one prevents, which is the most useful documentation of past mistakes the
repository has.

## Documentation tests

Every example in the syntax reference is executed when the suite runs, and
compared against the documented result.

The format is a fenced block tagged `solve`, with the expected result after a
comment marker:

```
50% of 200 // 100
```

Because the marker is the language's own comment syntax, every documented line
is valid input a reader can paste unchanged. A blank line starts a fresh engine,
so examples cannot leak variables into one another.

If you change behaviour, the documentation fails the build rather than going
quietly out of date.

## Benchmarks

Excluded from the normal run because they are slow and timing-sensitive.
