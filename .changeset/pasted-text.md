---
"solve-engine": minor
---

Numbers, amounts of money, pattern matches and JSON fields are read out of pasted text

A receipt, a log line or an API response pasted into a note was text the engine could measure but not read: the numbers in it had to be typed out again to be totalled, and `jwt(...)` and `query(...)` returned JSON with no way to take one value out of it. The text package now reads four things out of such text: its numbers, its amounts of money, the part a pattern matches, and a field of JSON.

| expression | before | now |
| --- | --- | --- |
| `numbers in "Coffee 3.20, lunch 12.50, taxi 18"` | parse error: unexpected text after the expression | [3.20, 12.50, 18] |
| `total of numbers in "Coffee 3.20, lunch 12.50, taxi 18"` | parse error: unexpected text after the expression | 33.70 |
| `total of amounts in "2 coffees £3.20, 1 cake £2.50"` | parse error: unexpected text after the expression | £5.70 |
| `match("Order #4471 shipped", "#(\d+)")` | error: undefined function `match` | 4471 |
| `matchcount("GET 200, GET 404, POST 200", "\b200\b")` | error: undefined function `matchcount` | 2 |
| `matches("2026-09-23", "^\d{4}-\d{2}-\d{2}$")` | error: undefined function `matches` | true |
| `field(query("name=John+Doe&page=2"), "name")` | error: undefined function `field` | John Doe |

`numbers in X` lists every number written in a piece of text, and `amounts in X` only the ones with a currency sign or code beside them. Written straight after an aggregate (`total of`, `sum of`, `average of`, `median of`, `count of`, `spread of`, `mode of`, the standard deviations and variances), either phrase hands the aggregate the numbers themselves, so the answer is the shipped aggregate's: a total of amounts keeps its currency, and a mix of currencies with no rate is refused as incompatible units, as `total of €3, $4` is. The text is read in the engine's configured number format rather than guessed from the text, so a German engine reads `1.234,56` as one number and an English engine as two, and a French engine accepts the no-break spaces a copied French number carries. A minus sign counts only in front of a number, so `10-20` is two numbers.

`match(text, pattern)` returns the text of the first group that took part in the first match (or the whole match), `matches` whether the pattern occurs, and `matchcount` how often. The patterns never reach JavaScript's `RegExp`. They run on the package's own matcher, which tries every way of matching at once and reads each character once, so `(a+)+$` against forty letters and a full stop answers at once where a backtracking engine would take hours. It follows JavaScript's syntax and its choices between alternatives, including resetting a loop's groups on each pass and refusing an optional pass that matched nothing, and a seeded differential run against `RegExp` holds it to that, groups and match counts included. `(?i)` at the start ignores case by JavaScript's rule.

`field(json, "path")` reads one value out of JSON by a path such as `order.items[0].price`: a number as a number, a string as text, a boolean as a boolean, and a list or object as its JSON. JSON typed into a line, where each quotation mark is written `\"`, is read as the JSON it spells.

Every form answers or refuses with a named Error value, never a throw and never a guessed number: `TEXT_NO_NUMBERS`, `TEXT_NO_AMOUNTS`, `TEXT_NO_MATCH`, `TEXT_PATTERN_INVALID`, `TEXT_PATTERN_UNSUPPORTED`, `TEXT_FIELD_NOT_FOUND` (which lists the fields that are there), `TEXT_FIELD_NULL`, `TEXT_NOT_JSON` and the rest, each a stable code a host can read without parsing the sentence. The work is bounded: a text gives up to 10,000 numbers, a pattern may be 500 characters with 32 groups and repeat counts up to 1,000, and the pattern forms on one line share 5,000,000 steps. The step count is kept per evaluation rather than per call, so fifty calls on one line cannot take fifty allowances; `vm/AllocationBudget.ts` gains `currentEvaluation()` for that, and `docs-internal/RESOURCE_GUARDS.md` lists the new limits. No VM builtin was added: the forms are the text package's phrases, a normaliser rule and plugin functions.

The boundary, and why:

- **No backreferences, lookahead or lookbehind.** They are refused by name, since no matcher can promise to answer a backreference in time proportional to the text, and the guarantee is the point. The only flag is `(?i)`, at the start.
- **A list holds plain numbers.** `amounts in X` on its own shows the amounts without their currency; the aggregates, which read the amounts directly, keep it. A list among other values (`total of 1, numbers in X`) is still one value, and the aggregate refuses it as before.
- **Only the common currency codes are read**: the ones the engine shows with a sign of its own. `TOP 10` is not ten Tongan pa'anga. `$` is the US dollar, as everywhere in the engine.
- **Only the number is read.** `15%` is 15, `1.5e3` is 1.5 and 3, and a date is the numbers it is written with.
- **A character in a pattern is a code point**, so a skin-toned emoji is two characters to `.`, where the text operations count it as one.
- **A JSON key containing a dot or a bracket cannot be reached by a path**, and a whole number past 2^53 is refused rather than rounded.
- Pasted text is only searched. Nothing in it is evaluated.

A new syntax page, pasted text, explains each form for a reader meeting it for the first time, with proven examples; the text operations page points to it where it used to call regular expressions a later addition, and the text encoding page shows `field` reading what `jwt` and `query` return.

## Verification

Two new suites. One pins the matcher: its syntax, its refusals, its limits, the exponential patterns answering in one pass, and 8,000 generated patterns (half with loops that may match nothing) agreeing with `RegExp` on the first match, its groups and the match count. Outside the suite, seeded runs of 400,000 more generated patterns on the finished matcher agreed, half of them with loops that may match nothing, and `(?i)` agreed with `RegExp` on every character of the Basic Multilingual Plane against its case partners, alone and in a class. The other drives every form through the engine: the number formats of the three locales, currency placement, each aggregate against its written-out list, the refusals, big pastes refused quickly, the per-line step budget, and the batch and incremental document passes agreeing. The pasted text page's examples are proven by the documentation suite. `npm run verify:ci` passes: TESTS tests across SUITES suites.
