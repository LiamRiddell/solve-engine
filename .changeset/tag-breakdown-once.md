---
"solve-engine": patch
---

`total by tag` is worked out once for every breakdown line that asks it of the same figures

A breakdown walked every line of the note on every call, read each line's tags again, and totalled, formatted and shared out every group, so a note of 500 tagged amounts with 500 `total by tag` lines paid for 500 full breakdowns (#734). The groups now come from the tag index the document paths already keep for `total of #tag`, which is the same object while the text is unchanged, and the answer is kept against that object, the line left out, and the member figures it was made from. Every breakdown line asking the same question of the same figures is served the kept answer; a member whose figure changes, or a line that joins or leaves a group, makes a new one.

| document | before | now |
| --- | --- | --- |
| 500 tagged amounts, 500 breakdowns, `parseDocument` | 6,834 ms | 202 ms |
| the same, `evaluateDocument` | 7,261 ms | 243 ms |
| 250 tagged amounts, 250 breakdowns, `parseDocument` | 1,644 ms | 107 ms |
| 500 tagged amounts, one breakdown, `parseDocument` | 84 ms | 83 ms |

Measured on a shared Linux container (4 cores, Node 22.22.2, load average about 4 from other work), with the engine's source bundled by esbuild, one run each, both builds in the same few minutes. The absolute figures run high on a busy machine; the shape is the point. Five hundred breakdowns cost 81 times one before, and 2.4 times one now.

The answers do not change. A breakdown line that carries a tag itself is still left out of its own breakdown, and is part of the question the kept answer is keyed on, so a breakdown line carrying `#a` and one carrying `#b` are each answered for themselves.

Beside it, the batch pass's tag index listed a line twice when it carried one tag twice, so the batch pass counted it twice where the incremental pass counted it once:

| line | before, `parseDocument` | now, both passes |
| --- | --- | --- |
| `$40 #food #Food` then `total of #food` | $80.00 | $40.00 |
| `$40 #food #Food` then `count of #food` | 2 | 1 |

The boundary: a breakdown's text still grows with the number of tags, so one line listing 2,000 tags is 2,000 entries, and a note of 2,000 such lines is refused by the retained-elements limit (#694), by name.

## Verification

`Issue734_tagBreakdownOncePerPass.spec.ts` holds 31 tests: `DocumentModel.tagGroups` (one object while the text holds, a new one after an edit, positions after an insert, a tag written twice on one line, prototype words), the handler on its own with a hand-built context (the index and the walk agree, the line left out is part of the question, a kept answer is served as a copy, a changed figure is a new answer, each refusal by name, a hostile index naming line 0 or a line past the end), the issue's document through both passes, a scaling check (500 breakdowns against one), the duplicate-tag counts, and the adversarial cases (a breakdown line carrying a tag, two carrying different tags, a member's tag and amount edited between passes, prototype words, look-alike text, 2,000 tags and 2,000 breakdowns, CRLF and a lone carriage return). The full suite (`npm run test:full`) passed, 20,630 of 20,634 tests in 676 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:changeset` and `lint:dispatch-size` (`executeBytecode` at 46,034 bytecode bytes). `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
