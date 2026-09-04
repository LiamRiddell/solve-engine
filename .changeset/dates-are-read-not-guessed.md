---
"solve-engine": minor
---

A date the engine cannot read is refused by name, instead of quietly becoming arithmetic.

A written date is ambiguous. `03/04` is 3 April or 4 March depending on where you are, and the engine used to settle it by the separator: a slash date read day first, a hyphen date month first. When that guess failed there was nowhere to fail to, so the line fell through to the arithmetic it is spelled like and showed a plausible number. A wrong date is bad; a wrong date wearing the clothes of a right answer is worse.

| expression | before | now |
| --- | --- | --- |
| `29 February 2026` | `51,327,216,000,000` | not a real date: February 2026 has 28 days |
| `31 April 2026` | `55,024,938,000,000` | not a real date: April 2026 has 30 days |
| `12/25/2026` | `0.00` | not a date read day first: there is no month 25. Read month first it is 25 December 2026 |
| `2026-13-45` | `1,968` | not a real date: there is no month 13 |
| `31/04/2026 + 1 day` | `1.01 day` | the refusal, carried through the line |

The refusal is a value, not a throw, so one bad line never takes the document down with it. Every message names the reading that failed and the one that would have worked, because a reader who typed `12/25/2026` meant something, and the engine knows what.

The divisions that are divisions stay divisions: `1024/8/2` is still `64`, `2000/12/25` still `6.67`, `1000/10/5` still `20`, and `2024 - 5 - 3`, written with spaces, is still `2,016`. A run of one- and two-digit groups (`12/13/14`) keeps its old reading too. What changed is only a run carrying a four-digit year that no configured order can read.

Set `date.onAmbiguous: "arithmetic"` to restore the old behaviour exactly, value for value.

**The order can now come from the reader's locale.** `date.inputOrder: "locale"` infers day-month order from the host, and `date.inputLocale` names a tag when the host's own locale is not the reader's, which on a server it never is. Inference is opt-in in this release and stays so until the next major; nothing infers unless asked, and an engine given no configuration constructs no `Intl` formatter at all.

**A line can say how it was read.** `engine.getDateReading()` reports the order in force and where it came from, `engine.readDates(text)` reports one reading per literal with its span, and `explainLine` gains a first step for a literal whose reading was not obvious.

```
03/04/2026 read as 3 April 2026, day first, the default for a slash date.
Month first would be 4 March 2026.
```

Nothing about `formatValue` output changes for a date that reads cleanly.

**A date can be read in a time zone.** `<date> in <zone>` names the zone and shows the answer in it.

| expression | before | now |
| --- | --- | --- |
| `3 April 2026 in Tokyo` | `1,775,170,800,000.00 Tokyo` | `Friday, April 3, 2026` |
| `2026-04-03T09:00 in Tokyo` | `1,775,203,200,000.00 Tokyo` | `Friday, April 3, 2026, 9:00:00 AM` |
| `3 April 2026 in New York` | a parse error | `Friday, April 3, 2026` |

A two-word city name works, so does a standard abbreviation, and so does `UTC`. A signed offset does not: `in GMT+9` reads as `(in GMT) + 9`, which adds nine milliseconds, because a date plus a bare number is milliseconds throughout the engine. The time page says so and points at `in Tokyo` or `in JST`.

The boundary this release draws: an ISO literal carrying `Z` or an explicit offset records that offset and keeps displaying in the zone the engine computes in, unchanged. Whether such a literal should display in the offset it names is a separate question, and moving it would change every document that pastes a timestamp, so it waits for the next major.

Two defects found while building this and fixed here: a wall-clock reading near a daylight-saving transition resolved backwards in any zone behind UTC, so asking for midnight on a spring-forward morning in Santiago landed on the previous day; and a calendar day re-anchored into another zone read the host's wall clock rather than the day, which named the wrong day on a host whose local midnight does not exist.
