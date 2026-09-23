---
"solve-engine": minor
---

One time in several zones, the hours several places share, and a named day for both

Every timezone form took one time and one target zone, so a team spread across three cities asked three questions, and a line naming more than one target did not parse. Nor could a line say which day it meant: `3pm London in New York` read today, and the gap between two places changes on the days their clocks change, so the answer moved with the calendar and no example of it could be pinned down.

A clock-time conversion now takes a list of targets, separated by commas or `and`, and answers each one labelled with the name the reader wrote. `on <date>`, after the first place or at the end of the line, fixes the day. A new form, `overlap of <hours> in <places>`, finds the stretch of the day that falls inside the same hours in every place named, gives its length first, and reads it on each place's own clock.

| expression | before | now |
| --- | --- | --- |
| `3pm London in Tokyo, New York and Sydney` | parse error: unexpected `,` | Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day), on 23 September 2026 |
| `3pm London on 23 September 2026 in Tokyo, New York and Sydney` | parse error | Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day) |
| `3pm London on 20 March 2026 in New York` | parse error | 11:00 AM |
| `overlap of 9am to 5pm in London and New York on 23 September 2026` | parse error | 3 hours: London 2:00 PM to 5:00 PM, New York 9:00 AM to 12:00 PM |
| `overlap of 9am to 5pm in London and New York on 20 March 2026` | parse error | 4 hours: London 1:00 PM to 5:00 PM, New York 9:00 AM to 1:00 PM |
| `overlap of 8am to 6pm in Tokyo and San Francisco on 23 September 2026` | parse error | 2 hours: Tokyo 8:00 AM to 10:00 AM, San Francisco 4:00 PM to 6:00 PM (-1 day) |
| `overlap of 9am to 5pm in London and Tokyo on 23 September 2026` | parse error | No overlap between London and Tokyo |
| `1:30am London on 29 March 2026 in Tokyo` | parse error | 1:30 AM did not happen in London on March 29, 2026: the clocks went forward past it |

The overlap is anchored on the first place's day. Each further place cuts it down to the part inside that place's own hours on any of its days, because a place across the date line keeps its matching hours on its yesterday or its tomorrow, and every end is read on its own day's clock, so daylight saving is applied place by place and date by date. Hours that end before they start run past midnight, as a night shift does, and hours longer than twelve can meet another place's twice in a day, in which case both stretches are given with their total. Inside `overlap of`, `9am-5pm` reads as `9am to 5pm`, since what follows the phrase is known to be a stretch of the day.

A wall-clock time that the clocks skip or repeat on a daylight-saving day names no single moment, so a conversion refuses it by name (`TIME_ZONE_SKIPPED_TIME`, `TIME_ZONE_REPEATED_TIME`) rather than quietly moving it an hour. This applies to the existing undated form too, on the two days a year it matters: on 29 March 2026, `1:30am London in Tokyo` answered 10:30 AM, the answer for 2:30am, and now says 1:30 did not happen. On every other day that form, and the bytecode it compiles to, are unchanged. An overlap with one place (`OVERLAP_NEEDS_TWO_ZONES`), hours with no length (`OVERLAP_HOURS_EMPTY`), and an `on` clause that is not a date (`TIME_ZONE_EXPECTED_DATE`) are refused as Error values, and an unknown place after `and` is named as not a time zone rather than reported as an undefined variable.

The time zone material moves from the time page to its own page, time zones, which explains what a zone and daylight saving are before the syntax and proves every dated example.

The boundary, deliberately:

- One set of hours applies to every place in an overlap. Places that keep different hours are not compared in one line.
- Weekends and public holidays are not considered: the hours apply to every day, so a Monday morning in Tokyo that is a Sunday afternoon in San Francisco is reported like any other.
- The answers are text, written to be read, as the existing timezone forms' are, not values to do arithmetic with.
- Outside `overlap of`, a hyphen between two times is still read as subtraction, so `9am-5pm London in New York` is unchanged and wrong in the way the issue records. Reading a bare hyphen as a range everywhere is a separate decision.
- `time difference between` and `time in` still answer for the present moment; they take no `on` clause.

## Verification

A new suite pins every answer above, each spelling of the hours and of the list, the day shifts in both directions, daylight saving in both hemispheres, a transition inside the hours, the skipped and repeated readings, each refusal and parse error, and the undated forms against a pinned clock. It runs under both calendar backends and in the three zones `npm run test:temporal` uses. The time zones page is proven by the documentation examples suite. `npm run verify:ci` passes: TESTS tests across SUITES suites.
