---
"solve-engine": minor
---

Add text operations on String values (issues #236, #237).

Text in quotation marks has always been a value, but there was no way to operate
on one. This adds the everyday string handling a note needs alongside its sums:
measuring text, testing it, and reshaping it, in a new `solve-text` package that
is on by default and removable like the other utilities.

## Measuring and joining

| expression | result |
| --- | --- |
| `length of "hello"` | `5` |
| `words in "the quick brown fox"` | `4` |
| `characters in "hello"` | `5` |
| `"hello" + " world"` | `hello world` |

Counting is by character, not by byte, so an accent or an emoji counts as one.

## Testing

`contains`, `starts with` and `ends with` each answer a boolean, so they sit
inside a condition.

| expression | result |
| --- | --- |
| `"hello" contains "ell"` | `true` |
| `"report" ends with "port"` | `true` |

## Reshaping

| expression | result |
| --- | --- |
| `trim "  spaced out  "` | `spaced out` |
| `reverse "hello"` | `olleh` |
| `"ha" repeated 3 times` | `hahaha` |
| `"the lord of the rings" as title` | `The Lord Of The Rings` |
| `"Hello, World!" as slug` | `hello-world` |
| `replace("banana", "a", "@")` | `b@n@n@` |

Every measuring and reshaping form has a call spelling too (`length("hi")`,
`upper("hi")`, `slug("A B C")`).

## The boundaries

Two forms give way to words the language already owns, and the give-way is
deliberate rather than a gap:

- **`replace` is a function**, `replace(text, find, replacement)`, not the
  sentence "replace A with B in C", because "with" is already the word form of
  "+" (`40 with 2` is 42).
- **"times" in `X repeated N times` is optional**, because it is the word form of
  "\*" (`8 times 9` is 72); it is recognised here only as a trailing flourish on
  the count, so `"ha" repeated 3` works too.
- **Replacement is literal**: `find` is matched character for character, with no
  pattern matching. Regular expressions are a possible later addition.
- **A join is text with text**: `"a" + "b"` is `ab`; a text value plus a number
  is left alone rather than coerced.

Non-text input to any operation is answered with a structured Error that names
what it wanted, never a wrong value.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks, and the docs example suite (the
text-operations page's examples are proven live). New tests:
`packages/text/TextOperations.spec.ts`.
