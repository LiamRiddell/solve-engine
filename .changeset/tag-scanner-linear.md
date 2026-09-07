---
"solve-engine": patch
---

The tag scanner is linear again, so a long line cannot stall a document

A regression introduced in 2.38.1. Teaching `lineCarriesTag` to examine every
occurrence of a tag, so a line can query one group and join another, made each
occurrence cost the length of the line: it copied the whole prefix, then ran the
opener pattern over that copy. The pattern is anchored at its end but not its
start, so the regex engine scans from every position.

A line whose occurrences are all queries never takes the early return, so it paid
that per occurrence.

| occurrences | line | 2.38.0 | 2.38.1 | now |
| --- | --- | --- | --- | --- |
| 1,000 | 12 KB | 0.10 ms | 11.4 ms | 0.52 ms |
| 4,000 | 48 KB | 0.02 ms | 143 ms | 1.28 ms |
| 16,000 | 192 KB | 0.09 ms | 2,145 ms | 4.44 ms |
| 200,000 | 2.4 MB | — | ~5 min | 62 ms |

Whether anything precedes a `#` is one property of the line, so it is found once
rather than by copying the prefix at each occurrence. And the opener pattern is
anchored at its end, so only the characters immediately in front of the `#` can
match it: testing a fixed window of those is the same answer, in constant time.

The boundary, and it is the old behaviour rather than a new answer: past that
window an opener is not recognised, so `total of` separated from its tag by more
than fifty-three characters of whitespace reads as a member, which is what such a
line was before queries were distinguished at all.

Every reading 2.38.1 established is unchanged and pinned: a mark joins, a query
names without joining for all four openers, a line can do both, a heading is not
a tagged line, and the tag must be the whole word.

The shape that reached this is not a hand-written line. `aggregateTagged` runs
the scanner over the raw text of every line, including ones the evaluator
classifies as skippable markdown, so a table cell holding the text is enough and
the expression-length guard never applies.
