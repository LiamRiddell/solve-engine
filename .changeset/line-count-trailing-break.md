---
"solve-engine": patch
---

Both document passes count lines as an editor does, and a CRLF line's text leaves out the `\r`

`parseDocument` dropped the empty line after a trailing line break, and returned no lines for an empty note. `evaluateDocument`, which reads the note through the same line model an editor host uses, kept them, so the two passes disagreed on how many lines a note had, and a host indexing results by the editor's line number read a different list from each (#613). `evaluateDocument` also kept the `\r` of a CRLF line ending in the line's `text`, and counted it in the line's end offset.

| note | before: `parseDocument` | before: `evaluateDocument` | now: both |
| --- | --- | --- | --- |
| `""` | no lines | one empty line | one empty line |
| `"1\n2\ntotal above\n"` | 3 lines | 4 lines, the last empty | 4 lines, the last empty |
| `"1\r\n2\r\n"` | 2 lines, text `1` and `2` | 3 lines, text `1\r`, `2\r` and empty | 3 lines, text `1`, `2` and empty, at the same offsets |

The lines above the new last line read as they did. A line that names the new last line now finds an empty line there, as `evaluateDocument` already did: `line 4 with x = 1` at the end of a three-line note that ends in a line break said "There is no line 4 to re-run: the document has 3 lines." through `parseDocument`, and now says line 4 is not a calculation through both passes. `evaluateLines` returns one `ParsedLine` per line given even when the last is empty (`["1", ""]` gave one, and `[""]` none), and still none for no lines.

A lone `\r`, the line ending of classic Mac OS, still ends a line in `parseDocument` only; `evaluateDocument`'s line model splits on `\n`. No host this engine targets writes one, and changing the model's split would move the character offsets a host passes to it for an edit.

The TypeScript guide says how lines are counted.

## Verification

New tests pin the count for an empty note, notes of only line breaks of both kinds, a trailing line break after answers, errors, a heading and `total above`, and CRLF notes, each through both passes with their text and offsets; `evaluateLines` of no lines, one empty line and a trailing empty line; a what-if naming the new last line; and inline solves on CRLF lines. The cross-path suite gains CRLF notes with a trailing line break for a line reference, a category tag, a section and a what-if. The adversarial sweep's four pinned #613 documents now pass and run in the ordinary set. Four existing tests that pinned the old count (the lexer's empty document and trailing line break, and the engine's empty document) now pin the editor's count. The full suite is 13,360 tests in 554 suites, all passing (four skipped), and `npm run verify:ci` passes, including `smoke:globals`, the three-zone `test:temporal` run and the bundled-consumer contract.
