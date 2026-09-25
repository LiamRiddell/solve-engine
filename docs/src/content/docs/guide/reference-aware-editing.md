---
title: Reference-aware editing
description: Find references, go to definition, hover, rename a variable, and keep line references on their lines when lines move.
---

A note refers to things by name and by position. `:tax = 20%` gives a value a
name, and `100 * tax` on another line refers to it. `line 3` refers to whatever
is on the third line. An editor that understands those references can do four
things a plain text editor cannot: list every place a variable is used, jump to
where it was given its value, show that value on hover, and rename it safely.
It can also keep `line 3` pointing at the same line when a line is added above
it, the way a spreadsheet keeps a cell reference on its row when a row is
inserted.

The [language service](/guide/editor-integration/) provides all five. This page
is for the developer building the editor: it shows each call, what comes back,
and where it stops.

```ts
import { createEngine } from "solve-engine";
import { LanguageService, applyTextEdits } from "solve-engine/language";

const engine = createEngine();
const service = new LanguageService(engine);
```

## Why the engine has to answer

Prose and variables share words. In this note the first two `tax`es are a
variable and the third is English:

```solve-doc
:tax = 20%
100 + 100 * tax      // 120
tax is due in April
```

A find and replace cannot tell them apart. The engine can, because it decides
the same thing every time it evaluates: a line is code when it parses, and a word
on a line of code is a variable when the engine reads or writes it there. The
reference calls ask exactly those questions, with the same lexer, normaliser and
parser evaluation uses, so an editor never disagrees with the answers beside it.
The third line does not parse, so nothing on it is ever a reference.

## Positions, spans and edits

Every call takes the document's whole text and a position in it. A position is a
one-based line and a zero-based character on that line, the numbering an editor
shows a reader and the offsets it stores:

```ts
const text = ":tax = 20%\n100 + 100 * tax\ntax is due in April";
const position = { line: 2, character: 12 }; // the "t" of tax on line 2
```

What comes back is spans (`{ line, from, to }`, with `to` just past the last
character) and, for the calls that change something, text edits: a span and the
text that replaces it. The service never changes the document itself. A host
owns its text, its undo history and its collaboration, so it applies the edits
the way it applies any other change.

## Finding references and definitions

`findReferences` lists every place the variable at a position is named, its
definitions and its reads, in document order:

```ts
service.findReferences(text, { line: 2, character: 12 });
// [{ line: 1, from: 1, to: 4, name: "tax", global: false, kind: "definition" },
//  { line: 2, from: 12, to: 15, name: "tax", global: false, kind: "read" }]

service.findReferences(text, { line: 3, character: 0 });
// []  (the tax on line 3 is prose)
```

A `definition` is a place the line gives the name a value: `:tax = 20%`, a bare
`tax = 20%`, a running total `total += 5`, or a function `f(x) = 2x`. Everything
else is a `read`, including the unknown in a goal seek (`solve line 4 for rate =
900`), which names the variable the seek varies.

`getDefinition` answers "where does this value come from": the last definition
above the position, or the position itself when it is a definition. When nothing
above defines the name it returns `null`, which is exactly when the engine
reports the name as undefined.

```ts
service.getDefinition(text, { line: 2, character: 12 });
// { line: 1, from: 1, to: 4, name: "tax", global: false, kind: "definition" }
```

A name defined twice reads the definition nearest above it, so in `:x = x + 1`
the `x` on the right goes to the line above, not to the line it is on.

## Hover

`getHover` gathers what a hover card shows: the occurrence, its definition, the
defining line's text, and the value that line produced. The service evaluates
nothing, since the host already has every answer, so pass the results you have:
the return value of `parseDocument` or `evaluateDocument`, or a function from a
line number to its value.

```ts
import { formatValue } from "solve-engine/format";

const results = engine.parseDocument(text);
const hover = service.getHover(text, { line: 2, character: 12 }, results);

hover.definitionText;      // ":tax = 20%"
formatValue(hover.value);  // "= 20.00%"
```

Without results the hover still carries the definition and its text, with a
`null` value.

## Renaming

`rename` changes the variable at a position to a new name, everywhere it is named
and nowhere else:

```ts
const result = service.rename(text, { line: 1, character: 1 }, "vat");
// { ok: true, edits: [{ line: 1, from: 1, to: 4, text: "vat" },
//                     { line: 2, from: 12, to: 15, text: "vat" }] }

applyTextEdits(text, result.edits);
// ":vat = 20%\n100 + 100 * vat\ntax is due in April"
```

Lines 1 and 2 change, the prose on line 3 does not, and line 2 still gives 120:

```solve-doc
:vat = 20%
100 + 100 * vat      // 120
tax is due in April
```

A rename that cannot be done safely is refused with a code and a sentence that
says why, never done partly:

| Code | When |
| --- | --- |
| `RENAME_NOT_A_VARIABLE` | The position is not on a variable: prose, a unit, a keyword, or a function's parameter. |
| `RENAME_GLOBAL_NAME` | The variable is a `global :name`, which other documents read. |
| `RENAME_INVALID_NAME` | The new name is not one identifier (`2x`, `x y`, `:vat`). |
| `RENAME_KEYWORD` | The new name is a keyword, or a word the engine reads as syntax (`pi`, `in`, `line3`). |
| `RENAME_UNIT_NAME` | The new name is a unit (`km`, `EUR`), which a line would read as the unit. |
| `RENAME_NAME_TAKEN` | The document already uses the new name, so the rename would merge two values. |
| `RENAME_CHANGES_MEANING` | An edited line would read differently afterwards. |

```ts
service.rename(text, { line: 1, character: 1 }, "pi");
// { ok: false, code: "RENAME_KEYWORD",
//   message: "\"pi\" is a keyword, so it cannot name a variable." }
```

The last check is made by reading every edited line again. A new name can be a
perfectly good identifier and still change a line: renaming a function `f` to
`sum` turns `f(3)` into `sum(3)`, which is a different call. When any edited line
comes out with a different structure, the rename is refused rather than
returned.

## Keeping line references in step

`line 3` is an absolute number. It means the third line of the note, whatever is
on it. Insert a line at the top and every line moves down one, so `line 3` would
now read what used to be the second line. Spreadsheets solved this long ago: a
reference to a cell follows the cell when a row is inserted above it.
`shiftLineReferences` does the same for a note.

The host makes its change first, then passes the new text and a description of
what moved. `insert` says new lines now stand at `line` onwards; `delete` says
the lines that stood at `line` onwards are gone.

```ts
// A heading typed above the three lines of the note.
const inserted = "# Groceries\n10\n20\nline 1 + line 2";

const shift = service.shiftLineReferences(inserted, { kind: "insert", line: 1, count: 1 });
// { ok: true, edits: [{ line: 4, from: 5, to: 6, text: "2" },
//                     { line: 4, from: 14, to: 15, text: "3" }], deleted: [] }

applyTextEdits(inserted, shift.edits);
// "# Groceries\n10\n20\nline 2 + line 3"
```

Before the insertion and after the edits, the answer is the same:

```solve-doc
10
20
line 1 + line 2   // 30
```

```solve-doc
# Groceries
10
20
line 2 + line 3   // 30
```

### Deleted lines

A reference into a line that has been deleted has no right number to become.
Leaving it alone would silently read whichever line moved up into its place, so
the edit writes it as `line deleted`, which answers with a named error, and the
result lists it in `deleted` so the host can say so:

```ts
// Line 2 (the 20) of "10, 20, 30, line 3 - line 1, line 2 * 2" was deleted.
const afterDelete = "10\n30\nline 3 - line 1\nline 2 * 2";

service.shiftLineReferences(afterDelete, { kind: "delete", line: 2, count: 1 });
// { ok: true,
//   edits: [{ line: 3, from: 5, to: 6, text: "2" },
//           { line: 4, from: 0, to: 6, text: "line deleted" }],
//   deleted: [{ line: 4, from: 0, to: 6, target: 2 }] }
```

```solve-doc
10
30
line 2 - line 1   // 20
line deleted * 2  // ERROR: This reference pointed at a line that has been deleted
```

### Ranges

The two ends of `sum(line 1 : line 3)` move independently, as a spreadsheet
range's ends do. A line inserted inside a range is inside it afterwards, so the
total includes it; a range loses the lines deleted from it; and only a range with
none of its lines left becomes `line deleted` at both ends.

```solve-doc
10
15
20
30
sum(line 1 : line 4)   // 75
```

That is the note above after `15` was inserted as line 2 into a note whose last
line was `sum(line 1 : line 3)`.

### Describing the change

The engine keeps a reference on a whole line, so the host describes its edit in
whole lines. A newline typed at the end of line 3 inserts one line at line 4. A
newline typed at the start of line 3 inserts one at line 3. Selecting lines 5 to
7 and deleting them deletes three at line 5. A split or a merge in the middle of
a line has no single answer for which half is "the same line", so the host
decides, and describes it as one of those.

## Applying the edits

The edits are all against the text passed in and never overlap, so an editor
applies them as one change, which also keeps them as one step in its undo
history. In CodeMirror:

```ts
view.dispatch({
  changes: result.edits.map((edit) => {
    const line = view.state.doc.line(edit.line);
    return { from: line.from + edit.from, to: line.from + edit.to, insert: edit.text };
  }),
});
```

A host with no editor of its own uses `applyTextEdits`, which applies them to a
string from the last to the first and keeps the document's own line breaks.

## The contract

- Every call takes the whole document and returns positions or edits. It does
  not change the document, and it does not evaluate anything.
- It has no side effects on the engine either. A running total, a bare
  assignment or a unit definition is recognised by its shape and never run, so
  asking about a note never moves a total in the engine that evaluates it.
- A line is read the way the engine's batch document pass reads it: a list
  marker is markup, each inline solve is its own expression, a `label:` before an
  expression is prose, and a heading, a blockquote or a comment is not code.
- A unit the note defines is a unit below its definition, as it is when the
  note runs: after `1 sprint = 2 weeks`, the `sprints` in `3 sprints` is not a
  variable. That holds on an engine that has never evaluated the note, such as
  one kept only for highlighting, because each line is read with the note's own
  definitions above it and the engine's unit table is left as it was.
- A refusal is a result, not an exception: `ok: false` with a code and a message.

A label before a definition shows the two readings agreeing. In
`rent: :rent = 1200` the words before the colon are a label (prose that names
the line), so the reference calls report a definition of `rent` after it, and
the note, when it runs, defines `rent` the same way:

```solve-doc
rent: :rent = 1200   // 1,200
:rent * 2            // 2,400
rent * 2             // 2,400
```

## The boundary

- **Globals are found, not renamed.** A `global :name` is shared with every
  document that reads it, and one document cannot rename it in the others.
- **Relative forms are left alone.** `prev`, `total above` and `average above`
  read whatever is above them now; that is their meaning, so a shift never
  rewrites them. Only an absolute `line N` moves, including a range's ends, a
  goal seek's target, and the line a [what-if or a sweep](/syntax/what-if/)
  re-runs (`line 4 with deposit = 150000`).
- **Inserted lines are left as written.** They were written against the note as
  it now stands.
- **The hover's value is the host's.** The service reports the value the host's
  own results hold for the defining line, so it is only as fresh as those
  results.
