---
"solve-engine": minor
---

Random draws can be seeded, so a note's rolls, picks and identifiers are the same on every run

Randomness came straight from `Math.random`, so a roll, a `pick`, a `shuffle`, a `coin`, a `uuid` or a `random hex` changed every time the line ran, and a note or a worked example that recorded one could not be checked or shared. A seed now makes every draw repeatable: the same seed gives the same draws on every run and every machine. A document seeds itself with a `random seed <value>` line, and a host with `createEngine({ random: { seed } })`, `engine.setRandomSeed()` or the worker client's `init({ random })`.

| document | before | now |
| --- | --- | --- |
| `random seed 42`, `roll(1, 6)` | error: Expected token type "LPAREN", then a fresh roll | random draws seeded with 42, then 1 on every run |
| `random seed 42`, `pick("north", "south", "east", "west")` | a different option each run | north on every run |
| `random seed 42`, `uuid` | a different identifier each run | 3735de41-7ba2-430d-8b81-afba841149a5 on every run |
| `roll(1, 6)` with no seed | a fresh roll each run | a fresh roll each run |

Each line draws from its own stream, worked out from the seed and the line's compiled program, so a draw changes only when its own line is edited or the seed changes: adding or editing other lines leaves it where it was, and two lines written the same way still draw separately. The `random seed` line seeds the whole document wherever it sits, and takes precedence over the host's seed. When the seed in force changes, the lines that drew under the old one are dropped from the cache and draw again, in a batch pass and in the incremental evaluator alike. Unseeded, draws come from `Math.random` exactly as before.

Draws reach the engine through the line's execution context, the way the clock already does through the calendar backend, so a builtin or a package that draws randomness reads `context.random()` rather than `Math.random`. The dice and randomness pages, which could show no fixed answer until now, gain proven examples and leave the documentation spec's unprovable list.

The boundary: a seeded draw is repeatable, not unpredictable. The generator (mulberry32) is built to look random to a reader, not to resist prediction, so a seeded `uuid` or `random hex` is not suitable as a password or a security token. An engine restored from a snapshot does not carry a seed; seed it again with `setRandomSeed`.

## Verification

A new suite pins the stream, the document seed line, repeatability across engines, variation when unseeded, reseeding and restoring, precedence, a line inserted above, identical lines, agreement between `parseDocument` and `evaluateDocument`, a re-draw after the seed line is edited in the incremental evaluator, and a single evaluated line. The dice, randomness and embedding pages are updated, with proven examples. `npm run verify:ci` passes: TESTS tests across SUITES suites.
