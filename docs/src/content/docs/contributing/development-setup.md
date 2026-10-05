---
title: Development setup
description: Getting the repository running locally, and what each script is for.
---

```bash
git clone https://github.com/LiamRiddell/solve-engine.git
cd solve-engine
npm install
```

That is everything the engine needs. The documentation site and the playground
sit outside the npm workspaces, because each pulls in a front-end dependency
tree that has no business in the published package's lockfile, so they take one
more step:

```bash
npm run setup
```

It builds the engine (the site depends on it through `file:`, and that package
publishes only `dist`), then installs `docs` and `playground`. Rerun it after
pulling changes that touch either project's dependencies, and after any change
to the engine, since a stale `dist` leaves the site running yesterday's engine.

## The two verification commands

```bash
npm run verify
```

The fast loop: the type check, the default test run, and the package build.
Run it while iterating.

```bash
npm run verify:ci
```

The gate. Every check continuous integration applies, as one command, in the
order the table below lists them. Continuous integration runs the same named
scripts split across jobs for speed, and a release runs this whole command
again before anything reaches npm, so if it passes locally the pull request
passes. It takes several minutes; run it before pushing anything that touches
the lexer vocabulary, a unit, the public exports, the docs examples or the
bundle.

The difference between the two is four test suites and a dozen lint and
packaging checks. `verify` skips `heavy/MemoryLeak`, `LexerFuzz`,
`LexerVocabularyFuzz` and `LongDocumentRobustness`, which are slow and
memory-hungry; `verify:ci` runs them and then checks everything the site and
the registry depend on. The coverage floor is the one gate outside it,
measured daily by its own workflow because the measurement is slow; run
`npm run test:coverage` for a change that removes tests.

## Every script

| Script | What it does |
| --- | --- |
| `npm run verify` | Type check, default test run, build, smoke checks. The fast loop. |
| `npm run verify:ci` | The gate: every check CI applies, run as one command. The rows below are the main ones. |
| `npm run typecheck` | The type check of the engine source, through TypeScript 7's `tsc` (installed as `typescript7`); TypeScript 5.9's `tsc` runs as a second check via `typecheck:tsc`. |
| `npm run typecheck:tests` | The spec files and test tools, type-checked by the same compiler against a per-file baseline in `packages/engine/__tests__/typecheck-baseline.json` that may only fall. A new error fails; a fixed one rewrites the baseline lower, to commit. |
| `npm test`, `npm run test:ci` | The default test run: every suite except the four slow ones. |
| `npm run test:full` | Every suite, single-threaded with a raised heap. Writes the report `stats:tests` reads. |
| `npm run test:coverage` | Every suite with coverage measured against the floor in `jest.coverage.config.cjs`. Slow; CI runs it daily rather than per pull request. |
| `npm run test:light` | The default run minus the fuzz and robustness suites, for a quick signal on a slow machine. |
| `npm run lint` | oxlint over the engine source, the spec files, the tools, the playground bridge and the scripts. Correctness rules fail; style rules warn. |
| `npm run lint:comments` | Comment style, over the whole tree. |
| `npm run lint:messages` | The messages the engine writes for a reader (`errorValue`, `lineMessage`, `ErrorFactory`, `console.warn`): no em-dash, British spelling, no JavaScript operator, and no host method named in a line's result. |
| `npm run lint:docs` | Every public export carries a doc block. |
| `npm run lint:actions` | Every GitHub Action in the workflows is pinned to a commit. |
| `npm run lint:action-inputs` | Every `with:` input a workflow passes is one its action declares, read from `.github/action-inputs.json`. After moving a pin, refresh that list with `node scripts/check-action-inputs.mjs --update`. |
| `npm run lint:licenses` | The runtime dependency and everything under it carry an allowlisted licence. |
| `npm run audit:deps` | `npm audit` at high severity. The docs and playground lockfiles are audited in their own CI jobs. |
| `npm run build` | tsup: ESM, CJS and declarations into `packages/engine/dist`. |
| `npm run smoke`, `npm run smoke:bundled` | Import the built package by subpath; prove the `sideEffects: false` claim survives bundling. |
| `npm run lint:package` | publint and arethetypeswrong against the built package, both pinned. |
| `npm run lint:stats`, `npm run stats:tests` | Check, or regenerate, the test counts the site quotes, from the last `test:full` report. |
| `npm run lint:size`, `npm run stats:size` | Check, or regenerate, the bundle and tarball sizes the site quotes. The tarball is packed under a pinned npm so the figure is the same on every machine; the brotli figure is measured on the exact Node in `.nvmrc`. Regenerate only after a clean `npm run build`. |
| `npm run lint:units`, `npm run stats:units` | Check, or regenerate, the unit reference page, generated by probing the built engine. |
| `npm run lint:keywords` | Every word and phrase the built engine reads (its keywords, function names, `as` converters, call words and normaliser phrases) is mentioned on a syntax page. A name that should not be documented yet is set aside, with its reason, in `scripts/keyword-docs-allowlist.json`. Needs `npm run build` first. |
| `npm run lint:sidebar` | Every documentation page is on the sidebar, once. |
| `npm run lint:links` | Every root-relative docs link reaches a page, and every `#fragment` a heading on that page (a page title is `#_top`). `/playground/` and `/api/` are built separately and allowed by name; external addresses are not followed, so the gate never waits on the network. |
| `npm run docs:llms` | Regenerate `docs/public/llms.txt` and `llms-full.txt` from the cheatsheet and the proven examples. `LlmsTxt.spec.ts` fails in every test run while the committed copies are stale, so run this after changing a syntax page's examples or the cheatsheet. |
| `npm run data:cpi` | Regenerate the bundled price indices, one per currency, each from its recorded source: the US CPI-U in `packages/finance/data/CpiTable.ts` from BLS series CUUR0000SA0 (#700, `scripts/build-cpi-table.mjs`), the UK index in `UkCpiTable.ts` from ONS series CDKO (#756, `scripts/build-uk-cpi-table.mjs`), and the euro-area HICP in `EuroHicpTable.ts` from ECB series ICP.M.U2.N.000000.4.INX (#756, `scripts/build-euro-hicp-table.mjs`). By default each rebuilds from the snapshot in `scripts/fixtures/cpi/`, so a plain run reproduces the committed tables; `-- --check` fails when any table has drifted from its snapshot. The options that pick a source belong to one index, so they take `--index=us`, `--index=uk` or `--index=euro`: `-- --index=us --from-bls --save-csv=scripts/fixtures/cpi/cpiai.csv` fetches the BLS public API (a `BLS_API_KEY` raises its window from 10 to 20 years), `-- --index=uk --from-ons --save-csv=scripts/fixtures/cpi` fetches the ONS generator, `-- --index=uk --from-mirror=<dir>` reads a newer copy of the Frictionless Data mirror, and `-- --index=euro --from-ecb --save-csv=scripts/fixtures/cpi/ecb-icp-hicp-euro-area.csv` fetches the ECB data API, each recording what it fetched. The engine never fetches an index at runtime. |
| `npm run stats:parity` | Regenerate the parity counts the internal audits quote (`docs-internal/parity-stats.json` and the markers in the audits) from `SoulverParity.spec.ts` and `OtherAppsParity.spec.ts`, which fail while a quoted count is not the measured one. |
| `npm run lint:cheatsheet` | Every syntax page is linked from the cheatsheet, and every link there reaches a page. A page that is a reference rather than an area of the language is set aside, with its reason, in `scripts/check-cheatsheet.mjs`. |
| `npm run test:consumer` | Pack the tarball, install it into a scratch project, and use it by bare specifier. |
| `npm run size` | Report the bundled size. It does not gate. |
| `npm run bench`, `npm run bench:compare`, `npm run bench:baseline`, `npm run stats:bench` | Run the benchmarks, compare two runs, refresh the committed baselines, and record the throughput figures the site quotes. See [performance](/guide/performance/). |
| `npm run fuzz` | The fuzzer's soak mode, across four generators: `bytecode` corrupts an opcode stream, `expression` writes a line of source, `document` edits a whole document and checks every answer against a plain pass over the same text, and `crosspath` asks one document of both `parseDocument` and `evaluateDocument` and checks they agree line for line. Runs nightly in CI; run one with `-- --generator=document`, or reproduce a finding with `-- --seed=<seed>`. |
| `npm run verify:all` | `verify` plus the playground build. |
| `npm run changeset:version` | What the version pull request runs: bump, lockfile, build, full suite, and every regenerated figure. |
| `npm run release:check` | The release preflight, read-only: npm against the changelog and the GitHub releases, stuck or cancelled publish runs, pending changesets, a throwaway `changeset version`, and a release-note skeleton. Needs the network and `gh`; see [releasing](/contributing/releasing/). |

## Layout

| Path | Contents |
| --- | --- |
| `packages/engine` | The published package |
| `packages/playground-bridge` | Shared glue between the engine and the playground |
| `playground` | The interactive playground application |
| `docs` | This documentation site |
| `docs-internal` | Maintainer notes, not published |

## Running the playground

```bash
npm run dev --prefix playground
```

## Running the docs site

```bash
npm run dev --prefix docs
```

On Windows, stop the dev server before rerunning `npm run setup`. Astro holds a
native binary open inside `docs/node_modules`, and reinstalling over it fails
with `EPERM`.
