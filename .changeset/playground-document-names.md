---
"solve-engine": patch
---

The playground's completions offer the names the document defines, read from the evaluating engine

The playground's editor built its own list of names for completions from the dependency graph snapshot: the keys of `consumers`, which are every name any line reads, defined or not, and every `writes` entry, which can outlive the line that wrote it. So a typo read on one line (`budgte * 2`) was offered as a name, and a name whose definition had been deleted went on being offered (found bug, no issue). The engine already answers the question itself with `documentVariableNames()`, but the evaluating engine runs in a worker and the editor's engine only highlights, so the bridge now reads the names in the worker and carries them on the report as `documentNames`, and the editor's language service reads that.

| the note | before: offered | now: offered |
| --- | --- | --- |
| `rent = 1200`, `budgte * 2` | `rent`, `budgte` | `rent` |
| `<U+202E>rent = 5`, `rent = 2` | `rent` and the hidden spelling | `rent` |

The boundary: the names are those of the active tab's last evaluation, as the snapshot's were, so a name typed since then is offered after the next evaluation. No engine behaviour changes.

## Verification

`packages/playground-bridge/__tests__/FoundBug_playgroundDocumentNames.spec.ts` holds 5 tests of the report through the batch and streaming paths: a defined name and a name only read, names of several words, a colon definition and a function, an empty and a prose-only document, a name refused for a direction control, and prototype words as names with `expectPrototypeUntouched`. The playground built (`npm ci` and `npm run build` in `playground/`, which runs `tsc -b`); its completions were not tried in a browser.

On top of main, the full suite ran 35,461 tests in 864 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,777 tests.
