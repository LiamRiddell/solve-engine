---
"solve-engine": minor
---

Token CSS class names are no longer prefixed `cm-`, and the prefix is now configurable.

`categoryClassName()` lived in the CodeMirror adapter and returned `cm-solve-<category>`. Nothing about it was CodeMirror-specific, but every host inherited CodeMirror's naming convention whether or not it used CodeMirror, which was wrong for an editor-agnostic library.

It is replaced by `tokenClassName()`, exported from `solve-engine/language`, which returns `solve-<category>` and takes an optional prefix. For hosts that already own a namespace there is `createTokenClassName(prefix)`, which binds one once.

```ts
import { tokenClassName, createTokenClassName } from "solve-engine/language";

tokenClassName("number");             // "solve-number"
tokenClassName("number", "app-tok-"); // "app-tok-number"

const className = createTokenClassName("cm-solve-");
className("number");                  // "cm-solve-number"
```

To migrate, swap the import and rename the matching CSS rules from `.cm-solve-*` to `.solve-*`. To keep the old class names instead, use `createTokenClassName("cm-solve-")` and change nothing else.

`completionItemToOption()` stays in `solve-engine/language/adapters/codemirror`, where it belongs: it maps onto CodeMirror's own completion types and is genuinely editor-specific.
