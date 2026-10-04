---
"solve-engine": patch
---

The docs site publishes an `llms.txt` and an `llms-full.txt`, generated from the cheatsheet and the proven examples

Tools that read documentation on someone's behalf, coding assistants and hosts that connect the engine to a language model, look for `/llms.txt` at a site's root, and the site had none (#783). What the engine reads is spread over 97 syntax pages, and a model that guesses a form it has not seen writes lines the engine refuses.

| file | before | now |
| --- | --- | --- |
| `llms.txt` | absent | a description of the engine, one linked line per syntax area under its sidebar group, and the guides a host starts from |
| `llms-full.txt` | absent | every proven example from the syntax pages with its answer, page by page, in the pages' own `expression // answer` notation |

`llms.txt` is read from the cheatsheet, which `lint:cheatsheet` keeps a whole map of the reference, so an area has a line when it has a page. `llms-full.txt` is read through the collector `DocExamples.spec.ts` asserts, so it carries a line with an answer only when the build proves that answer. `LlmsTxt.spec.ts` fails when the committed files under `docs/public/` differ from what the docs build, as `lint:units` does for the unit reference, and `npm run docs:llms` rewrites them. The introduction points a reader's tools at both.

The boundary: only proven lines go in. A per-line group goes in whole when any of its lines is proven, since a line with no answer is usually one that defines a name the next reads; a page with nothing proven (weather, stocks, crypto, knowledge) contributes nothing. Examples that read the clock were proven against the docs' fixed moment, and the file says which. It is a derived file, not a page to edit, and it carries no API reference beyond links to the guides.

## Verification

`LlmsTxt.spec.ts` holds 10 tests: both files current, a line for every syntax page the cheatsheet links, every answered line in `llms-full.txt` an asserted example (over a thousand of them), the live pages left out, and unit tests of `plainText`, `cheatsheetAreas` (a caption across lines, two pages sharing one, a fenced look-alike, hostile captions, an empty page), `buildLlmsTxt` and `buildLlmsFull`.

Gates run: the full suite (`npm run test:full`) ran 24,912 tests in 728 suites: 24,907 passed and 4 were skipped. The one failure was the #729 spec that keeps explain-before-show exemptions honest, since the unit reference's new headlines explain before each table and its exemption no longer named anything; the exemption is removed and that spec passes on a rerun. `npm run test:temporal` in all three zones, `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords`, `lint:links`, `lint:units`, `lint:ci-parity` and `lint:jest-configs` passed. `npm run verify:ci`, the docs site build and the bundled-consumer contract were not run whole for this change; CI runs them.
