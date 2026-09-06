---
"solve-engine": patch
---

Asking about a tag no longer joins it, so one tag can answer several questions

Two aggregate lines over the same category tag made each other unreadable. Each
walked every line whose text carried the tag, found the other still being
evaluated, and reported it.

| document | before | now |
| --- | --- | --- |
| `10 #a` / `20 #a` / `total of #a` | `30` | `30` |
| `10 #a` / `20 #a` / `total of #a` / `average of #a` | `Line 4 has not been evaluated yet` and `Line 3 has an error` | `30` and `15` |

Deleting either aggregate made the other answer, which is what made it a defect
rather than a limit: asking two questions of one tagged column is the ordinary
thing to do with one.

A `#tag` after `total of`, `sum of`, `average of` or `count of` names the group
rather than joining it. The querying line's own text was already skipped, by line
number, so this only extends that to the other queries and says the same thing
about all of them.

The rule is about each `#` rather than about the line, so a line can query one
tag and be a member of another: `total of #grocery #reviewed` asks about the
first and joins the second.

The boundary, which the issue asked for explicitly: a line that genuinely has not
been evaluated is still reported rather than quietly dropped. An aggregate placed
above its own members is a forward reference, and the engine reads a document
downwards, so it still says so.

[Category tags](https://liamriddell.github.io/solve-engine/syntax/category-tags/)
gains a proven section stating the rule.
