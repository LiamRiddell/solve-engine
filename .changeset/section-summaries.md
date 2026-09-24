---
"solve-engine": minor
---

A section is totalled by its heading, and a tagged note is broken down by every tag at once

A note's figures can now be added up by the heading they sit under. `total above` stops at the first blank line or heading, so it only works written directly under its own block, and `sum(line 2 : line 4)` names line numbers that go stale as soon as a line is inserted above them. `total of section "Travel"` names the block by its heading instead, and reads whatever is under it from anywhere below, a summary at the bottom of the note included. Category tags answered one tag at a time, and each tag's share of the whole had to be worked out by hand; `total by tag` gives every tag's total and share on one line.

| expression | before | now |
| --- | --- | --- |
| `total of section "Travel"` | error: unexpected token "Travel" | $720.00 |
| `total by tag` | error: unexpected token "by" | food $65.00 (68%) · transport $30.00 (32%) |

The first row is a note with `Flights: $450`, `Hotel: $220` and `Taxi: $50` under `# Travel`; the second has `$40 #food`, `$25 #food` and `$30 #transport`. `sum of section`, `average of section` and `count of section` read the same block, and `sum by tag` is a synonym:

```
average of section "Travel"    $240.00
count of section "Travel"      3
total of section "travel"      $720.00
```

A section is the lines under a heading, down to the next heading at the same level or above, so `# Travel` takes in the `## Flights` and `## Hotels` inside it, and `total of section "Flights"` reads only its own part. The name is matched without regard to case or extra spaces. Blank lines, the smaller headings and comment lines are passed over. A line that is itself a summary of other lines (`total above` and its siblings, a `sum(line a : line b)` span, a tag total, another section total, `total by tag`) is left out, because the figures it sums are already counted: a section that ends in its own subtotal is not counted twice. A line that reads one other line, such as `prev`, is a figure and is counted. Money and units carry through in the first unit written, as they do for `total above`.

Every refusal is a named error rather than a number. A name no heading carries is `SECTION_NOT_FOUND`, and the message lists the headings the note has; a name two headings carry is `SECTION_AMBIGUOUS`, naming both lines; a section with no figures is `SECTION_EMPTY` for a total or an average, and zero for `count`. A line that is not a number is refused with `AGGREGATE_NON_NUMERIC`, naming the line and its section, and a mix of measures is refused by dimension, the rules `total above` and the inline aggregates already follow.

In the breakdown, each tag's amount is the one `total of #tag` gives, and the tags appear in the order they are first written. The whole is every tagged line counted once, so when each line carries one tag the shares describe how the whole divides; a line carrying two tags counts toward both, and overlapping shares can add up to more than 100%. Each share is rounded to a whole percentage on its own, and a share too small to round to 1% reads `<1%`. A note with no tags (`TAG_EMPTY`), a tagged line that is not a number (`TAG_NON_NUMERIC`), tags in different measures (`INCOMPATIBLE_UNITS`) and tagged lines that add up to zero (`TAG_BREAKDOWN_NO_WHOLE`) are each refused.

The refusal `total of "Travel"` gives, a quoted name read as text, now names the section form as well as the tag form: `To gather the lines under a heading, write total of section "Travel"; to gather tagged lines, use "total of #tag".`

Both forms read the whole document. Through the single-expression entry point each returns a structured error that says a document is needed (`SECTION_NO_DOCUMENT`, `TAG_NO_DOCUMENT`), never a number. The word `section` is only special with a quoted name after it, and `total by tag` needs all three words, so a variable named `section`, `tag` or `total` keeps working.

The boundary, and each part is deliberate:

- **A total goes below the block it reads.** It reads lines that have already been worked out, the way `total above` and the tag totals do, so one written above its section reports the first line not yet evaluated. It can sit at the foot of its own section, and leaves itself out.
- **One heading per name.** Two headings with the same name are refused rather than added together, and a heading path such as `"April / Travel"` is not read. Tagging the lines is the form for gathering a heading repeated under every month.
- **Only `total`, `sum`, `average` and `count`** over a section; its median, smallest and largest are not offered.
- **A summary line is recognised from its text**, the way the tag scanner tells a tag query from a tag member. A label is set aside first, so `Total above budget: $50` is still the figure `$50`.
- **The breakdown is text, not a structured value.** Several labelled figures fit none of the engine's existing value types, and a labelled result shape is left for the scenario comparison that would share it. It cannot be carried into arithmetic (`total of #tag` is the form for that), and a host's own number formatting does not reach the amounts inside it.
- **A section total walks the note's headings once per evaluation**, so its cost grows with the length of the note rather than the size of the section.

The syntax reference gains a Sections page under "Working across lines", and the category tags page a section on the breakdown, both as proven examples. The line references, statistics, trigger words and cheatsheet pages point to the new forms, and a stale boundary on the category tags page, which said a note could hold only one aggregate per tag, is removed.

## Verification

New suites pin the section reader's rules (headings, name matching, summary lines); every section form and refusal through both document passes; a live editor's answer after an insert, an in-place edit, a delete, a heading renamed away and back, and a heading inserted into a block, each against a fresh pass over the edited text; the dependency edges a section total takes, and that a summary it leaves out cannot close a cycle; and the breakdown's shape, ordering, overlap, rounding and refusals. `CrossPathDocumentFeatures.spec.ts` adds both forms through all three entry points: the document result, the agreement of the two document passes, and the single-line refusal. The differential document fuzzer's vocabulary gains named headings at two levels, section totals and the breakdown, and 1,600 editing sessions across four seeds agreed with a fresh pass throughout. `npm run verify:ci` passes: 10,709 tests across 517 suites, with the bundled-consumer contract.
