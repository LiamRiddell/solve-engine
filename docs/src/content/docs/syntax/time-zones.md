---
title: "Time zones"
description: A time in another zone, the same time in several zones at once, and the hours two or more places share.
---

> **Package:** `TIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A time zone is a region that keeps the same clock: when it is nine in the
morning in London it is five in the evening in Tokyo, because the two are eight
hours apart. Many places also move their clocks an hour forward in spring and
back in autumn, which is called daylight saving, so the gap between two places
changes on the days their clocks change, and not always on the same days. Name
a city, a country or a standard abbreviation and the engine looks the zone up
for you, using the same zone database your operating system reads, so the
answers follow whatever the rules are for the date in question.

## A time in another zone

Write a time, the place it is in, and `in` the place you want it shown in. The
answer is the time the clocks there show at that same moment.

```solve
3pm London in Tokyo // 12:00 AM (+1 day)
6pm Sydney in Chicago // 2:00 AM
```

On its own the line reads the time against today, so its answer can change with
the calendar: a gap that is five hours this month may be four next month. The
answers shown for a line without a date are for noon on Wednesday 11 March 2026 in London, the fixed moment these pages are checked against, and the notepad gives
yours. Add `on` and a date to ask about a particular day, and the answer is
fixed. The date can sit after the first place or at the end of the line.

```solve
3pm London on 23 September 2026 in Tokyo // 11:00 PM
3pm London in Tokyo on 23 September 2026 // 11:00 PM
```

When the date in the other place is not the date you named, the answer says by
how many days it differs. Sydney is already into the next morning, and San
Francisco is still on the evening before.

```solve
3pm London on 23 September 2026 in Sydney // 12:00 AM (+1 day)
9am Tokyo on 23 September 2026 in San Francisco // 5:00 PM (-1 day)
```

## Several zones at once

A team spread across several places rarely asks about just one of them. List the
places after `in`, separated by commas or `and`, and each is answered, labelled
with the name you wrote, so the answer reads as a small world clock for the
moment you named.

```solve
3pm London on 23 September 2026 in Tokyo, New York and Sydney // Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day)
```

The day shift is measured against the date in the first place, the one whose
clock you gave. An abbreviation or an offset from UTC works in the list as well
as a city, and keeps its own label.

```solve
3pm JST on 23 September 2026 in EST and CET // EST 2:00 AM, CET 8:00 AM
3pm GMT+9 on 23 September 2026 in London and UTC-5 // London 7:00 AM, UTC-5 1:00 AM
```

## Why the date matters

The clocks do not change everywhere on the same day. New York moves its clocks
forward on the second Sunday of March and London on the last Sunday, so for
those three weeks the two cities are four hours apart rather than five.

```solve
3pm London on 1 March 2026 in New York // 10:00 AM
3pm London on 20 March 2026 in New York // 11:00 AM
3pm London on 23 September 2026 in New York // 10:00 AM
```

The southern hemisphere has its summer in the northern winter, so its clocks go
forward in September or October, just as the northern ones are about to go back.
Sydney goes forward on 4 October 2026, while London is still on summer time.

```solve
9am Sydney on 1 October 2026 in London // 12:00 AM
9am Sydney on 5 October 2026 in London // 11:00 PM (-1 day)
```

On the day the clocks change, one hour is special. When they go forward, the
hour they jump over never happens, and when they go back, the hour they repeat
happens twice. A time inside either names no single moment, so it is refused
with the reason rather than moved an hour without saying so.

```solve
1:30am London on 29 March 2026 in Tokyo // 1:30 AM did not happen in London on March 29, 2026: the clocks went forward past it
1:30am London on 25 October 2026 in Tokyo // 1:30 AM happened twice in London on October 25, 2026, when the clocks went back, so it names no single moment
2:30am London on 29 March 2026 in Tokyo // 10:30 AM
```

The same refusal applies to a line with no date, on the two days a year it
matters.

## Working hours in common

The other question a team in several zones asks is when everyone is at work at
the same time. `overlap of` takes a stretch of the day, such as office hours,
and the places, and finds the part of that stretch that falls inside it in
every place at once. The answer gives the length of the shared stretch first,
then where it falls on each place's own clock.

```solve
overlap of 9am to 5pm in London and New York on 23 September 2026 // 3 hours: London 2:00 PM to 5:00 PM, New York 9:00 AM to 12:00 PM
overlap of 9am-5pm in London and New York on 23 September 2026 // 3 hours: London 2:00 PM to 5:00 PM, New York 9:00 AM to 12:00 PM
```

A hyphen between the two times reads the same as `to` here, because after
`overlap of` a stretch of the day is what is expected. Elsewhere a hyphen
between two times is read as a subtraction, not as a range, so write `to` there.

Each further place narrows the shared stretch to what it has in common with the
others.

```solve
overlap of 9am to 5pm in London, Paris and New York on 23 September 2026 // 2 hours: London 2:00 PM to 4:00 PM, Paris 3:00 PM to 5:00 PM, New York 9:00 AM to 11:00 AM
```

The stretch follows daylight saving day by day. During the three weeks in March
when New York has moved its clocks and London has not, the two share an hour
more.

```solve
overlap of 9am to 5pm in London and New York on 20 March 2026 // 4 hours: London 1:00 PM to 5:00 PM, New York 9:00 AM to 1:00 PM
```

The day is the first place's. A place on the far side of the date line keeps
its matching hours on its own yesterday or tomorrow, and the answer carries the
shift, so Tokyo's morning is found against San Francisco's afternoon before.

```solve
overlap of 8am to 6pm in Tokyo and San Francisco on 23 September 2026 // 2 hours: Tokyo 8:00 AM to 10:00 AM, San Francisco 4:00 PM to 6:00 PM (-1 day)
```

When the places share nothing, that is the answer. London's working day ends at
one in the morning in Tokyo, so the two only touch.

```solve
overlap of 9am to 5pm in London and Tokyo on 23 September 2026 // No overlap between London and Tokyo
```

Hours that end earlier than they start run past midnight, as a night shift does.
Hours longer than twelve can meet another place's twice in one day, once at
each end, and both stretches are given, with the length their total.

```solve
overlap of 10pm to 6am in London and New York on 23 September 2026 // 3 hours: London 3:00 AM to 6:00 AM, New York 10:00 PM to 1:00 AM (-1 day)
overlap of 5am to 11pm in London and Tokyo on 23 September 2026 // 12 hours: London 5:00 AM to 3:00 PM, Tokyo 1:00 PM to 11:00 PM; London 9:00 PM to 11:00 PM, Tokyo 5:00 AM to 7:00 AM (+1 day)
```

Without `on`, the overlap is today's.

```solve
overlap of 9am to 5pm in London and New York // 4 hours: London 1:00 PM to 5:00 PM, New York 9:00 AM to 1:00 PM
```

An overlap needs two places or more, and hours with a length, and says so when
it is not given them.

```solve
overlap of 9am to 5pm in London on 23 September 2026 // An overlap needs two or more places, as in "overlap of 9am to 5pm in London and New York"
overlap of 9am to 9am in London and Paris on 23 September 2026 // 9:00 AM to 9:00 AM has no length, so no time falls inside it
```

What the overlap does not cover, deliberately:

- **One set of hours for everyone.** The hours on the line apply to every place
  named. Places that keep different hours, an office that opens at eight beside
  one that opens at ten, are not compared in one line.
- **Weekends and public holidays.** The hours are applied to every day, so a
  Monday morning in Tokyo that falls on a Sunday afternoon in San Francisco is
  reported like any other. Working days are a separate question, on
  [working days](/syntax/working-days/).
- **The answer is text.** It is written to be read, not a value to do
  arithmetic with.

## The time there now

Three forms answer about the present moment, so their answers change as you
read them: the time in a place, its date, which can be a day either side of
yours, and how far apart two places are right now. The answers shown are for
the same fixed moment.

```solve
time in Paris // 1:00 PM
date in Vancouver // March 11, 2026
time difference between Seattle and Moscow // Moscow is 10 hours ahead of Seattle
```

The gap between two places is not fixed: it moves whenever either one changes
its clocks. To plan for a particular day, add `on` and the date, and the gap is
worked out for that day. London and New York change on different Sundays in
March, so for three weeks they are four hours apart rather than five:

```solve
time difference between London and New York on 1 March 2027 // London is 5 hours ahead of New York on March 1, 2027
time difference between London and New York on 20 March 2027 // London is 4 hours ahead of New York on March 20, 2027
time difference between London and Tokyo on 1 July 2027 // Tokyo is 8 hours ahead of London on July 1, 2027
time difference between Tokyo and Adelaide on 1 March 2027 // Adelaide is 1 hour 30 minutes ahead of Tokyo on March 1, 2027
```

A date names a whole day, and on the day a place changes its clocks the gap
changes partway through it. The dated answer is the gap at noon in the first
place named, which is clear of every clock change in use.

`time in` and `date in` answer only for now. A line such as `time in Tokyo on 1
March 2027` is refused, because the clock as it is now, carried to another day,
answers nothing useful. The two questions it usually means have their own forms:
a time converted on that day (`2pm London in Tokyo on 1 March 2027`), and the
gap between two places on it, as above.

## A date or a time in a zone

Writing `in <zone>` after a date, or after a time of day, reads it in that zone
rather than in yours, and shows it there. A bare date means midnight, so
`2026-04-03 in Tokyo` is the day that starts in Tokyo, shown as that day.

```solve
2026-04-03 in Tokyo // Friday, April 3, 2026
3 April 2026 in New York // Friday, April 3, 2026
2026-04-03T09:00 in Tokyo // Friday, April 3, 2026, 9:00:00 AM
2026-04-03 in UTC // Friday, April 3, 2026
```

A time of day works the same way: `6pm in Chicago` is six in the evening in
Chicago, and stays a time of day.

```solve
6pm in Chicago // 6:00:00 PM
```

The result is a date, not a quantity. A name that is not a zone is refused
rather than answered, and a unit is told apart from a misspelt zone, because the
two mistakes have different fixes. A zone belongs to a date: after an ordinary
number, `in` asks for a unit, so a city there is refused as a word that is not a
unit, the same as `5 km in Tokyo`.

```solve
2026-04-03 in Atlantis // "Atlantis" is not a time zone this engine knows. Name a city ("in Tokyo"), a standard abbreviation ("in JST") or "in UTC"
2026-04-03 in furlongs // A date cannot be read in "furlongs". "in <name>" after a date names a time zone, as in "2026-04-03 in Tokyo"
5 in Tokyo // "Tokyo" is not a unit.
```

A signed offset does not work after a date: `2026-04-03 in GMT+9` is read as
`(2026-04-03 in GMT) + 9`, and since a bare 9 does not say whether it means
days, hours or minutes, the line is refused rather than moved. Write `in Tokyo`
or `in JST` instead. A host that wants the whole
document computed in one zone can pin it: see
[dates on Temporal](/guide/dates-on-temporal/#choosing-a-zone-without-temporal).

## The names that work

- **Cities and places**: every place the time zone database names, about four
  hundred, from `Kathmandu` and `Hobart` to `Apia`, with names of more than one
  word written with spaces (`Ho Chi Minh`, `Dar es Salaam`, `Port au Prince`),
  and around ninety more cities the database has no zone of its own for, such
  as `Mumbai` and `San Francisco`. A place the database has renamed answers to
  both names: `Kolkata` and `Calcutta`, `Kyiv` and `Kiev`, `Ho Chi Minh` and
  `Saigon`.
- **Countries**, which read as their capital's zone: `Japan` is Tokyo, and
  `Australia` is Sydney even though the country spans several zones.
- **Standard abbreviations** such as `PST`, `EST`, `CET`, `JST` and `AEST`. Each
  names a place rather than a season, so `EST` in July is New York's summer
  time, and where an abbreviation has more than one meaning (`IST` is used in
  India, Ireland and Israel) the most common is taken, which for `IST` is India.
- **`UTC` and `GMT`**, and in the time conversions above an offset from them,
  `GMT+9` or `UTC-5:30`, which is fixed and never changes for daylight saving.

```solve
time difference between Kathmandu and Kolkata // Kathmandu is 15 minutes ahead of Kolkata
3pm London on 1 March 2027 in Hobart // 2:00 AM (+1 day)
```

A few of the database's names are left out, because reading them as a place
would mislead: ordinary words (`Easter`, `Christmas` and `Reunion` are islands in
the database), names a better-known place elsewhere holds (`Cordoba` is in Spain
as well as Argentina, and `San Juan` reads as Puerto Rico rather than the
Argentine province), and the Antarctic research stations, several of which are
named after people. Each is listed, with its reason, in the generator that builds
the table.

The full identifiers of the zone database, such as `Asia/Tokyo`, cannot be typed
directly, because the slash reads as division, and a hyphenated name is written
with spaces for the same reason: `Port au Prince`, not `Port-au-Prince`.
