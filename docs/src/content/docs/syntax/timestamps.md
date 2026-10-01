---
title: "Timestamps"
description: Reading a Unix timestamp as a date, and writing a date as one.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A Unix timestamp, also called an epoch timestamp, is a moment written as a
count of seconds: the seconds since midnight at the start of 1 January 1970,
in UTC. Computers store and pass times this way, so a log line, a database row
or an API response often carries one, such as `1710000000`. Solve reads a
timestamp as the date and time it names, and writes a date as a timestamp.

A date is shown in the zone the engine reads dates in. The answers on this page
are shown in London, the zone these pages are checked in, and the notepad shows
yours.

## Reading a timestamp as a date

`to date` reads a timestamp as a date and time, and `as date` is the same thing
spelled the way the other conversions are (`as iso8601`, `as weekday`).

```solve
1710000000 to date // Saturday, March 9, 2024, 4:00:00 PM
1710000000 as date // Saturday, March 9, 2024, 4:00:00 PM
```

JavaScript and many APIs count milliseconds rather than seconds. A timestamp
that large is recognised by its size: a number of a trillion or more is read as
milliseconds, and a smaller one as seconds. The two ranges cannot be confused
for any real date, since a count of seconds only reaches a trillion some thirty
thousand years from now.

```solve
1710000000000 as date // Saturday, March 9, 2024, 4:00:00 PM
```

ISO 8601 text, the `2024-03-09T16:00:00Z` form, is read the same way, and a
timestamp before 1970 is a negative count:

```solve
"2024-03-09T16:00:00Z" as date // Saturday, March 9, 2024, 4:00:00 PM
-86400 as date // Wednesday, December 31, 1969, 1:00:00 AM
```

## Writing a date as a timestamp

`to timestamp` and `as timestamp` write a date as a Unix timestamp in whole
seconds. A timestamp in milliseconds written `as timestamp` comes back in
seconds, which is how to convert one to the other.

```solve
2024-03-09 to timestamp // 1,709,942,400
2024-03-09 as timestamp // 1,709,942,400
1710000000000 as timestamp // 1,710,000,000
```

`current timestamp` is the timestamp for now. It moves with the clock; the answer
shown is for noon on Wednesday 11 March 2026 in London, the fixed moment these
pages are checked against.

```solve
current timestamp // 1,773,230,400
```

## As ISO 8601 text

`as iso8601` writes a date, or a timestamp, as ISO 8601 text, with the offset
of the zone it is read in:

```solve
1710000000 as iso8601 // 2024-03-09T16:00:00+00:00
```

## What is refused

A quantity, money, true or false and a list have no reading as a timestamp, so
each is refused by name rather than read through its number:

```solve
5 kg as date // as date reads a Unix timestamp (in seconds or milliseconds), ISO 8601 text or a date, and this value is none of them.
```

A timestamp further than about 273,000 years from 1970 is refused too, since a
date that far out cannot be held. To show only the time of day a date falls at,
write it `as time` (see [time](/syntax/time/)).
