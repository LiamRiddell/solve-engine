---
title: "A developer scratchpad"
description: "The sums a programmer reaches for between commits, in one note: transfer times and data sizes, Unix timestamps, hashes, number bases and bit masks."
---

Most programming days have a handful of small calculations in them: how long a
download takes, what a timestamp in a log means, whether two files hash the
same, what a flag mask comes to. They usually go to a search box, a terminal and
a browser console in turn. This note keeps them in one place, where the answers
stay beside the question.

```solve-doc
# Sizes and transfers
4 GB at 50 Mbps                              // 10.67 min
1 TB in GiB                                  // 931.32 GiB
1.5 GiB in MB                                // 1,610.61 MB
100 MB * 3                                   // 300.00 MB

# Timestamps
1700000000 to date in UTC                    // Tuesday, November 14, 2023, 10:13:20 PM
"2026-03-11T12:00:00Z" to timestamp          // 1,773,230,400
(1773230400 - 1700000000) seconds in days    // 847.57 days

# Hashes
sha256("hello")                              // 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
crc32("hello")                               // 3610a686

# Bases and bits
0xDEADBEEF                                   // 3,735,928,559
255 as hex                                   // 0xFF
4096 as binary                               // 0b1000000000000
0xFF & 0x0F                                  // 15
1 << 10                                      // 1,024
2^32 - 1                                     // 4,294,967,295
```

## What each part is doing

**Sizes.** `GB` and `MB` are the decimal units a disk is sold in (a thousand to
the next), and `GiB` and `MiB` the binary ones an operating system often
reports (1,024 to the next), which is why a 1 TB disk shows as 931 GiB. A lower
case `b` is bits, so `50 Mbps` is megabits a second, and `4 GB at 50 Mbps` is
the time the transfer takes. See [data sizes](/syntax/data-sizes/).

**Timestamps.** A Unix timestamp counts the seconds since the start of 1970 in
UTC, which is how most logs and APIs write a moment. `to date` turns one into a
date, and `in UTC` shows it in UTC rather than in your own time zone, so it
reads the way the log does. `to timestamp` goes the other way, from a date and
time written in the ISO 8601 form (`2026-03-11T12:00:00Z`, the `Z` meaning UTC).
The difference of two timestamps is a number of seconds, and `seconds in days`
says how long that is.

**Hashes.** A hash turns any text into a short fixed-length fingerprint: the
same text always gives the same hash, and a change of one character gives a
different one. `sha256` is the one to use for checking a download or a file;
`crc32` is a quick checksum for spotting accidental corruption, not tampering.
See [hashing](/syntax/hashing/).

**Bases and bits.** `0x` writes a number in hexadecimal and `0b` in binary, and
`as hex` and `as binary` show an answer in them. `&` keeps the bits two numbers
share, which is how a mask picks out a flag, and `<<` shifts the bits left, so
`1 << 10` is two to the tenth. See [number bases](/syntax/number-bases/),
[bitwise operators](/syntax/bitwise-operators/) and
[bit shifting](/syntax/bit-shifting/).

## What the note leaves out

A hash of a file needs the file's contents, and this note has only the text you
type into it, so it hashes text. A timestamp in milliseconds (thirteen digits,
as JavaScript's `Date.now()` gives) is read as milliseconds by `to date`, so the
two kinds of log line both work, but a timestamp with no zone written as text
(`2026-03-11 12:00`) is read in your own zone, which is why the example above
writes its `Z`.
