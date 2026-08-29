---
"solve-engine": minor
---

Add ratios and geometry (issues #252, #253).

Two everyday-maths utilities, each its own on-by-default, removable package.

## Ratios

Reduce a ratio to its lowest whole-number terms.

| expression | result |
| --- | --- |
| `ratio(1920, 1080)` | `16:9` |
| `ratio(4, 8)` | `1:2` |
| `ratio(2, 4, 6)` | `1:2:3` |

It is a function rather than a `1920:1080` literal, because a colon between two
numbers already builds a range (`1:10`). Parts must be whole positive numbers,
and there must be at least two.

## Geometry

Area, perimeter and volume of the common shapes, from their dimensions.

| expression | result |
| --- | --- |
| `area of circle radius 5` | `78.54` |
| `area of rectangle width 4, height 6` | `24` |
| `area of triangle base 3, height 4` | `6` |
| `volume of sphere radius 3` | `113.10` |
| `volume of cylinder radius 2, height 5` | `62.83` |

Circle, square, rectangle, triangle, sphere, cube, cylinder and cone are covered.
A shape with two dimensions takes them as a comma-separated pair (`width 4,
height 6`): the comma keeps the measurements apart, and it is what lets the
dimension words (`width`, `height`, `radius`, ...) stay ordinary identifiers you
can still use as names, rather than reserved keywords.

## The boundaries

Only the measure triggers (`area of`, `volume of`, ...) are fused phrases; the
shape and dimension words are read in context. Dimensions are plain numbers in
this slice (a squared or cubed result does not yet carry a unit). A measure a
shape does not define, or a missing dimension, is answered with a structured
Error naming what it needed.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks, and the docs example suite (the
ratios and geometry pages are proven live). New tests:
`packages/ratio/Ratio.spec.ts` and `packages/geometry/Geometry.spec.ts`.
