# Internal documentation

Working notes for maintainers. These files are not part of the published documentation and are not
written for an external audience. Published documentation lives in `docs/` and on the site.

The distinction matters because these files record decisions, trade-offs, and open problems in
candid terms. That is useful when you are working on the engine and misleading when read as a
description of what the project is.

## Contents

| File | Purpose |
| --- | --- |
| `plans/ARCHITECTURE_IMPROVEMENTS.md` | Where each item of the original improvement plan stands (done, partly done with what remains, dropped, or moved to obsidian-solve or 3.0), and the order the remaining structural work is done in for the rest of 2.x: finishing L1 (EngineContext, #710), hiding the evaluator seams (#761), the interval index for span dependencies (#733), the worker offload and the word-alias extension point. |
| `plans/CROSS_SCOPE_CELLS.md` | The design for document-scoped cells, replacing the flat `global :name` store. Records the two product decisions it rests on, the release order, and the defects that ship independently of it. Its Release D completes the singleton migration that `EngineContext` began. |
| `AGENT.seed.md` | Source material carried over from the Obsidian plugin repository, used to write the root `AGENTS.md`. Retained until that rewrite is complete, then removed. |
| `CODING_STANDARDS.md` | House rules for contributors: error handling, naming, size limits, comment and TSDoc style. Linked from `CONTRIBUTING.md`. |
| `RESOURCE_GUARDS.md` | What each safety limit can and cannot see, why per-opcode counters missed the allocations that killed the process, and the rule a new opcode has to follow. |

## Conventions

Mark completed work in place rather than deleting it. A plan that records what was done and why is
more useful than one that only describes what remains, particularly when a later change needs to
understand the reasoning behind an earlier one.

When a file here becomes accurate, general, and useful to someone outside the project, move it into
the published documentation rather than maintaining two copies.
