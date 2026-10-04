---
"solve-engine": minor
---

A German or French engine reads the decimal comma: `1,5 + 1` is 2.50, `;` separates a function's arguments, and a French engine reads thousands grouped with a space

Most of continental Europe writes one and a half as `1,5`, and the engine refused it in every locale, `de` and `fr` included, whose packs declare a comma decimal. Under those two it read a comma as a decimal point only when exactly three digits followed it, and inside a call the comma was always an argument separator, so under `de` a reader's `max(1,5, 2)` answered 5, a confident wrong answer (#740). The number scanner now reads a comma between two digits as the decimal comma in a comma-decimal pack, inside a call or a bracket as much as outside one, and a `;` inside a call separates its arguments there, as a spreadsheet in those languages does.

| line, under `de` | before | now |
| --- | --- | --- |
| `1,5 + 1` | refused at `,` | 2.50 |
| `1,50` | refused at `,` | 1.50 |
| `1,5000` | refused at `,` | 1.50 |
| `€9,99 * 2` | refused at `,` | €19.98 |
| `12,5%` | refused at `,` | 12.50% |
| `max(1,5, 2)` | 5 | 2 |
| `max(1,5; 2)` | refused at `;` | 2 |
| `1.500,5` | refused at `,` | 1,500.50 |
| `1,500` | 1.50 | 1.50 |
| `1,500,000` | refused: a second decimal mark | refused: a second decimal mark |

A French engine groups thousands with a space, and now reads one: `1 500` is fifteen hundred, and so is the `1 500,50` it writes with a narrow no-break space. A group after the space is exactly three digits, after a first group of one to three, so `1 50` and `12345 678` stay two numbers and are refused.

The rule that keeps the two commas apart: a comma between two digits is always the decimal comma, a comma with a space after it separates arguments and elements (a decimal comma never has one), and `;` separates arguments inside a call. So `max(1, 2)` is still 2, `max(1,2)` is 1.2, and `max(1,5,2)` and `rgb(255,0,0)` are one literal with two decimal commas, refused by name rather than split. A matrix keeps `;` for its rows: `[1, 2; 3, 4]` is unchanged, and `[1,5; 2,5]` is a column of 1.5 and 2.5. Each `;` belongs to the bracket it is written in, so one in a call inside a matrix separates the call's arguments.

The boundary: the reading follows the engine's locale only, never a guess per line. An English engine is unchanged, and so is every tag without a pack of its own (`es`, `it`, `nl`), which reads as English even though the engine writes its answers with a decimal comma; typing such an answer back into that engine is not covered. A German engine that relied on `rgb(255,0,0)` or `[100,200]` without spaces reads them as decimals now and refuses them, and writes `rgb(255; 0; 0)` or `rgb(255, 0, 0)` instead. A `;` outside a call still separates nothing. Pasted text (`numbers in`) keeps its own reading. The locales page gains a section on the decimal comma and the argument separator, with a table of what each pack reads, and the pasted-text and percentages pages no longer say a typed decimal comma is not read.

## Verification

`Issue740_decimalComma.spec.ts` holds 73 tests: the issue's lines under `en`, `de` and `fr` side by side; the regional tags and the tags with no pack; one to four digits after the comma, two commas, a thousands group before it; money, a unit, a percentage and a list; calls, nested calls, a matrix, a `;` in each kind of bracket, `rgb`, a grouping bracket, a `;` outside a call, and `en` unchanged; French space grouping and what it does not group; a round trip of what `engine.formatValue` writes under `de`, `fr`, `de-DE` and `fr-FR` for nine values; both document passes; the tokens the lexer emits; unit tests of `spaceGroupEnd` and `withoutGroupSpaces`; and the adversarial cases (prototype words as tags and beside a decimal, a 2,000-term sum and a 2,000-argument call, look-alike commas and digits from other scripts, a zero-width space, markup-shaped text, the numeric edges, stray commas and CRLF). Two specs that pinned the old reading were updated to the new one: `Issue655_regionTagFallback.spec.ts` (`max(1,234,567)` under `de` was 567) `Issue675_localeClaims.spec.ts` (a typed `3,20 + 12,50` under `de` was refused), and `Issue657_lakhGrouping.spec.ts`, whose `₹1,00,000` under `de` is still not read but is now refused as a literal with two decimal commas rather than at its second comma. `AdversarialFeatureSweep.spec.ts` gains comma-decimal templates under `de` and `fr`. This change touches the lexer's number scanner: the added checks run only under a comma-decimal or space-grouping pack. Gates run: the full suite (`npm run test:full`) passed, 22,120 of 22,124 tests in 685 suites with 4 skipped, as did `npm run typecheck`, `npm run typecheck:tests` (no new errors), `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
