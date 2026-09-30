---
"solve-engine": patch
---

Every docs link now reaches a page and every anchor a heading, and `npm run lint:links` keeps it so

Nothing checked the docs' internal links, and two anchors had broken without anyone noticing (#780). A broken anchor still loads the page, so a reader lands at the top and has to hunt for the part the sentence promised. The sidebar lint could not see a page listed twice either, since it collected the slugs into a set, and `guide/dates-on-temporal` appeared twice in the Embedding group.

| link or entry | before | now |
| --- | --- | --- |
| `syntax/constants.md` to `/syntax/derived-units/#named-derived-units` | no such heading (the words are the page's title) | `/syntax/derived-units/` |
| `syntax/time-zones.md` to `/guide/dates-on-temporal/#choosing-a-zone-without-temporal` | no such heading | `#choosing-a-zone-on-either-backend`, the heading it was renamed to |
| `guide/dates-on-temporal` in the sidebar | listed twice | listed once, in its reading-order slot after the live editor |
| `node scripts/check-sidebar.mjs` on the old config | `Sidebar covers all 134 documentation page(s).` | fails: `guide/dates-on-temporal (2 times)` |

`scripts/check-doc-links.mjs` walks every content page: a root-relative link must name a page on disk, and a `#fragment` must name a heading on that page, by the slug rule Astro gives a markdown heading (lowercased, punctuation dropped, spaces as hyphens, a repeat numbered `-1`), with `#_top` for a page title and an HTML `id` counting too. A fragment on its own is checked against its own page, and a relative link is reported, since only root-relative links get the site's base path. It runs in `verify:ci` and beside `lint:sidebar` in the docs job of `ci.yml`. The reading of a page's links is shared with `check-cheatsheet.mjs` through `scripts/lib/markdown-links.mjs`, so the two gates agree on what a link is.

The boundary: `/playground/` and `/api/` are allowed by name, since the pages workflow copies the playground in and starlight-typedoc generates the API reference at build time, and a path with a file extension is checked only against `docs/public`. External addresses are not followed: a network call in a gate makes it fail on a slow host. Like the sidebar lint, it reads the files as text rather than loading the Astro config.

## Verification

`hardening/DocLinksCheck.spec.ts` holds 32 tests: the script over fixture trees (a page and an anchor that land, a missing page, a renamed heading, a title anchor, a repeated heading, an HTML id, a same-page fragment, a relative link, case, index pages, the allowed prefixes, public files, links inside code), hostile pages (a page named `constructor`, twenty thousand unclosed brackets, markup in a heading, malformed percent-encoding, CRLF), unit tests of `slugifyHeading`, `headingIds`, `fragmentOf`, `slugOf` and `linkTargets`, the sidebar's repeated-slug check, and both scripts over the repository. `CheatsheetCheck.spec.ts` (28 tests) passes on the shared helpers.

Gates run: `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:links` and `lint:ci-parity` passed; the docs, hardening and integration suites with this batch's specs passed (7,467 tests in 99 suites); the docs site built (`npm run build --prefix docs`). The fast suite ran 21,483 tests in 700 suites: 21,477 passed and 4 were skipped. Of the two failures, `GuideExamples.spec.ts` timed out on one page under load and now runs with no network and a longer timeout, passing on a rerun; `TagAggregateLinearCost.spec.ts` is a timing bound that passes on its own and is untouched by this change. `npm run verify`, `lint:units` and the bundled-consumer contract were not run for this change.
