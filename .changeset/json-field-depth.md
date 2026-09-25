---
"solve-engine": patch
---

`field(...)` refuses JSON nested more than 512 levels deep, the same on every runtime

`field(...)` left the depth of a JSON text to the runtime's own `JSON.parse` and `JSON.stringify`, so the answer depended on the Node version. A text nested a hundred thousand levels deep was refused as `TEXT_NOT_JSON` on Node 22 and 24, and the new Node 26 job found it was not refused that way there (#621).

| line | before | now |
| --- | --- | --- |
| `field(("[" repeated 100000 times) + ("]" repeated 100000 times), "[0]")` | refused on Node 22 and 24, not on Node 26 | refused on every runtime: field(...) reads JSON nested at most 512 levels deep, and this text nests deeper |
| `field(("[" repeated 512 times) + "1" + ("]" repeated 512 times), "[0]")` | answered | answered |

The engine now counts the nesting itself before parsing. Five hundred and twelve levels is far past any API's answer and inside what every runtime reads and writes. Brackets inside a JSON string are text and do not count. The code is `TEXT_NOT_JSON`, as before.

## Verification

The text suite pins the limit on either side of 512 and a string full of brackets, and the Node 26 job in CI runs it there.
