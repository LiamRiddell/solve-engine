## What this changes

<!-- A sentence or two. What is different after this that was not before? -->

## Why

<!-- The problem being solved. -->

Closes #

## Tests

<!-- Name the spec files. A behaviour change needs a test that fails before this
     and passes after, or there is nothing holding it in place. -->

- [ ] A test covers the behaviour that changed, and fails without the change
- [ ] A regression test named after the defect, if this is a fix (see `__tests__/bugs`)
- [ ] Existing tests that assert the old behaviour are updated rather than deleted

<!-- `npm run verify` deliberately skips four suites to keep the dev loop fast:
     heavy/MemoryLeak, LexerFuzz, LexerVocabularyFuzz and LongDocumentRobustness.
     `npm run verify:ci` (under Checks) is the run that includes them, along
     with every other gate continuous integration applies. -->

## Documentation

- [ ] Syntax reference updated, if an expression now evaluates differently
- [ ] Examples in `docs/` still pass, and any new ones are in a `solve` block so they run
- [ ] Every new public export carries a doc block (`npm run lint:docs`)
- [ ] A changeset describes the change from the reader's side, if the published package changed
- [ ] The package-author pages under `docs/.../packages/` are updated, if an `IEnginePackage` extension point changed

<!-- Documentation examples are executed by the test suite, so a stale one fails
     the build rather than quietly misleading somebody. Note that a `solve`
     block is evaluated as a bare expression: a markdown-context example needs a
     plain fence instead. -->

## Checks

- [ ] `npm run verify:ci` passes locally

<!-- That is every check continuous integration applies, as one command: lint,
     comment style, doc coverage, action pins, licences, the audit, the type
     check, every test suite, the stats, the build, the smoke checks, publint,
     the size, the unit reference, the sidebar, and the packed tarball
     installed and used. `npm run verify` is the fast loop for iterating; it
     is not the gate. The coverage floor runs daily on its own; run
     `npm run test:coverage` if this removes tests. -->

## Anything worth a closer look

<!-- Trade-offs, alternatives you rejected, or parts you are unsure about.
     This section is genuinely useful; leaving it blank when there is something
     to say makes review slower, not faster.

     If this touches the lexer, the parser, the virtual machine dispatch loop or
     any caching layer, say so here. The engine runs on every keystroke, so
     performance is a correctness concern rather than a nicety. -->
