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
- [ ] `npm run test:full` passes

<!-- `npm run verify` deliberately skips the heavy, fuzz and long-document
     suites to keep the dev loop fast, which is sixteen spec files that nothing
     else runs locally. `npm run test:full` is the one that includes them. -->

## Documentation

- [ ] Syntax reference updated, if an expression now evaluates differently
- [ ] Examples in `docs/` still pass, and any new ones are in a `solve` block so they run
- [ ] `npm run lint:units` passes, if a unit was added or renamed
- [ ] `npm run lint:sidebar` passes, if a page was added
- [ ] A changeset describes the change from the reader's side, if the published package changed

<!-- Documentation examples are executed by the test suite, so a stale one fails
     the build rather than quietly misleading somebody. Note that a `solve`
     block is evaluated as a bare expression: a markdown-context example needs a
     plain fence instead. -->

## Checks

- [ ] `npm run verify`
- [ ] `npm run lint`
- [ ] `node scripts/check-comment-style.mjs --all`

## Anything worth a closer look

<!-- Trade-offs, alternatives you rejected, or parts you are unsure about.
     This section is genuinely useful; leaving it blank when there is something
     to say makes review slower, not faster.

     If this touches the lexer, the parser, the virtual machine dispatch loop or
     any caching layer, say so here. The engine runs on every keystroke, so
     performance is a correctness concern rather than a nicety. -->
