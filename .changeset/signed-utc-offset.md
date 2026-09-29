---
"solve-engine": patch
---

A signed offset after a date is read as the fixed clock it names: `2026-04-03T15:00 in UTC-5` is three in the afternoon on that clock

After a date or a time of day, `in` took one name, so `in UTC-5` read `UTC` as the zone and left `-5` to be subtracted from the answer (#730). That was once five milliseconds off (`3pm in UTC-5` gave 2:59:59 PM), and since a date and a bare number are refused, a refusal that spoke of lengths of time. With minutes, `05:00` was first read as a clock time, so the line became one date less another and answered a span of thousands of hours. The time package's conversion form, `3pm London in UTC-5`, already read the offset; the `in` after a date now reads it through the same reader, and the date is read and shown on that clock, as a named zone's is.

| line | before | now |
| --- | --- | --- |
| `3pm in UTC-5` | 2:59:59 PM | 3:00:00 PM |
| `2026-04-03T15:00 in UTC-5` | `A date or time moves by a length of time, and a plain number does not say whether it means days, hours or minutes.` | Friday, April 3, 2026, 3:00:00 PM |
| `2026-04-03T15:00 in GMT+9` | the same refusal | Friday, April 3, 2026, 3:00:00 PM |
| `2026-04-03T15:00 in UTC-05:00` | `-4286:00` on a UTC host on 29 September 2026 (a span to today's 5am, so it changes daily) | Friday, April 3, 2026, 3:00:00 PM |
| `2026-04-03T15:00 in UTC+5:45` | `Cannot add two datetimes together` | Friday, April 3, 2026, 3:00:00 PM |
| `2026-04-03T15:00Z in UTC-5` | the same refusal as the first line | Friday, April 3, 2026, 10:00:00 AM |
| `2026-04-03T15:00 in UTC+25` | the same refusal as the first line | `"UTC+25" is not an offset a clock keeps: write whole hours and minutes from UTC-12 to UTC+14, as in "UTC-5" or "UTC+5:45"` |
| `time in UTC+25` | answered, on a clock twenty-five hours ahead | refused with the same message |

The offset is a sign, whole hours and optional minutes after `UTC` or `GMT`, in either case and with or without a space either side of the sign. A wall-clock reading (`2026-04-03T15:00`, `3pm`) is kept and read on the offset's clock, a time of day shown as a time of day; a date is that day there; an instant (`now`, or a literal written with its own offset) is moved onto it. Clocks are kept from twelve hours behind UTC to fourteen ahead, so an offset outside that range, one with sixty minutes or more, a fraction of an hour, or a time of day after the sign is refused by name, after a date as an Error value and in the time package's forms (`time in`, `3pm London in`) as the parse error those forms give an unknown zone. The two readers are one function, so the forms accept and refuse the same spellings.

The boundary: a number with a unit after it is still arithmetic, so `2026-04-03T15:00 in UTC - 5 hours` is the time in UTC less five hours, as before, and bare `in UTC` is unchanged. A named offset is shown on its own clock, which is new; an offset an ISO literal carries (`2026-04-03T15:00+09:00`) still displays in the engine's own zone, as it did. After a plain number, `in UTC-5` asks for a unit, as `in Tokyo` does. The time-zones page shows the form working, with proven examples, where it described the old reading as a pitfall.

## Verification

`Issue730_signedUtcOffset.spec.ts` holds 158 tests: the issue's lines and each spelling it lists (`UTC+14`, `UTC-12`, `UTC+5:45`, lower case, `GMT`, a space either side of the sign), a date, a date-time and an instant, the refusals (`UTC+25`, `UTC-5:60`, `UTC+14:01`, `UTC+5.5`, a time of day), the boundary, the three entry points agreeing, and unit tests of the offset reader, the range check, the label, the refusal, the named-offset encoding and the display. The adversarial cases: prototype words in the base name's place, an offset ten thousand digits long, two thousand offset lines, a minus sign and digits from other scripts, zero-width characters and markup, a date from the line above, an edit, a snapshot round trip, both ends of the range, negative zero, a leap day and month ends. It passes on both calendar backends in London, New York and Auckland. The adversarial sweep gains five offset forms over the numeric edges and one over the prototype words, and `ZoneSpellings.spec.ts`, which pinned the old reading as a boundary, now pins the new one.
