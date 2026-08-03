# Internal documentation

Working notes for maintainers. These files are not part of the published documentation and are not
written for an external audience. Published documentation lives in `docs/` and on the site.

The distinction matters because these files record decisions, trade-offs, and open problems in
candid terms. That is useful when you are working on the engine and misleading when read as a
description of what the project is.

## Contents

| File | Purpose |
| --- | --- |
| `plans/ARCHITECTURE_IMPROVEMENTS.md` | Long-form improvement plans, each with a status marker. Contains the authoritative specification for L1 (EngineContext), including the migration order that must be followed. |
| `AGENT.seed.md` | Source material carried over from the Obsidian plugin repository, used to write the root `AGENTS.md`. Retained until that rewrite is complete, then removed. |
| `CODING_STANDARDS.md` | House rules for contributors: error handling, naming, size limits, comment and TSDoc style. Linked from `CONTRIBUTING.md`. |

## Conventions

Mark completed work in place rather than deleting it. A plan that records what was done and why is
more useful than one that only describes what remains, particularly when a later change needs to
understand the reasoning behind an earlier one.

When a file here becomes accurate, general, and useful to someone outside the project, move it into
the published documentation rather than maintaining two copies.
