# solve-engine

## Writing style (rule)

All reader-facing prose follows the same voice as the docs: the docs pages under
`docs/src/content/docs/`, the changeset entries in `.changeset/`, the engine
`CHANGELOG.md`, and every **GitHub release**. When writing or editing any of
these, match that voice. It is not a house preference to be improvised around; it
is the established style, and release notes in particular are written this way.

What the voice is, concretely:

- **Declarative and measured.** State what changed in a plain sentence. No
  marketing language, no hype, no exclamation marks, no emoji.
- **Lead with the behaviour, then show it.** Follow a claim with a `before / now`
  table or an `expression    result` code block. Every example must be a real
  result the engine produces, never an invented one.
- **British spelling** (`colour`, `behaviour`, `recognised`).
- **Explain the why, and name the boundary.** Say what a change deliberately does
  *not* cover, and why, rather than leaving it implicit.
- **Punctuation:** prefer colons, commas, and parentheses over em-dashes, the same
  discipline the comment-style lint enforces in source.
- **End a substantial release note with a `## Verification` section** citing the
  real test and suite counts (from `docs/src/data/testStats.json`) and the gates
  that ran (`npm run verify`, the bundled-consumer contract).

The published `solve-engine@1.0.0` and `solve-engine@1.0.2` GitHub releases are
the reference for tone and structure.

## Documentation examples (rule)

Every worked example in the docs is a **live, proven** block, never a static
fence. The reader edits it in place in a Plate notepad and watches the answer
follow, and `packages/engine/__tests__/docs/DocExamples.spec.ts` evaluates it at
build time and asserts the `// expected` value beside each line, so an example
cannot drift from the engine without the build going red.

- A per-line example is a ` ```solve` block: each line is proven on its own.
- A whole-document example is a ` ```solve-doc` block: the lines are evaluated
  together, which is what the cross-line forms need (line references, category
  tags, table columns, goal seek), and a blank line inside it is a boundary the
  aggregates read, not a break between examples.
- The value to the right of the last `//` is a **real result the engine
  produces**, taken from a run, never invented. The notepad strips it as a
  comment before mounting, so the reader sees the live answer, not the assertion.

The boundary: a result that is not a fixed string (a random roll, a live network
value, a date relative to now) carries no `// expected` and its page is listed,
with a reason, in the `unprovable` map in that spec. Everything else is proven.

## Testing whole-document features (rule)

A whole-document feature is one that reads or re-runs other lines: line
references, category tags, table columns, goal seek. Each behaves differently
through the engine's entry points, so each is tested through **all** of them, in
`packages/engine/__tests__/integration/CrossPathDocumentFeatures.spec.ts`:

- **`evaluateLine`** (the single-expression path): the form has no document to
  read, so it must return a **structured Error value that says so**, never a
  wrong number and never a throw. A raw markdown table row is the one exception,
  it is not an expression at all and a parse error is the honest answer.
- **`parseDocument`** (batch): line references, category tags and table columns
  resolve; goal seek refuses here too, since the batch pass cannot re-run a line.
- **`evaluateDocument`** (incremental): adds the re-run primitive, so goal seek
  resolves, and it must **agree with `parseDocument` value for value** on every
  form both support.

Adding a new cross-line form means adding it here in that same shape: the
document result, the cross-path agreement, and the single-line refusal. A
per-feature test that exercises only one entry point is not enough, because the
drift this catches is a form that works through one path and misbehaves through
another.

## Feature placement in the docs (rule)

Before documenting a new feature, look at where it belongs in the syntax
reference as it stands. A feature that extends an existing area goes on that
area's page; a feature that is genuinely a new area gets its **own** page,
created and registered in the sidebar (`docs/astro.config.mjs`, in its
alphabetical slot), never appended to the nearest existing page because that is
where the cursor happened to be. A page that has grown to cover several unrelated
features is the sign the split was missed, and it is broken apart. Both shapes
have precedent: `line-references.md` had category tags, goal seek and table
columns carved out into their own pages while it stayed a focused line-reference
page, and `live-data.md` was dissolved entirely into `weather.md`, `stocks.md`
and `knowledge.md`. Either way, each area ends up found under its own name. A page whose results are not fixed strings (live network data, random
rolls, dates relative to now) carries no proven examples and is listed, with a
reason, in the `unprovable` map in `DocExamples.spec.ts`.

## Developer-side documentation (rule)

The docs have two audiences, and a feature is not finished until both are served.
The reader-facing syntax pages under `docs/src/content/docs/syntax/` are one; the
package-author pages under `docs/src/content/docs/packages/` (and the async data
source guide under `guide/`) are the other. A change that alters what a package
creator can do, a new or changed `IEnginePackage` extension point
(`lexerVocabulary`, `prefixParselets`, `infixParselets`, `pluginFunctions`,
`normalizerRules`/`phrases`, `asConverters`, `asyncResolvers`, `tokenCategories`,
`completionItems`), or a new option on a helper a package uses
(`createQueryResolver`'s `refetchIntervalMs`, say), updates the developer-side
docs in the **same change**. Each extension point has its **own** hands-on guide
under `docs/src/content/docs/packages/` that walks an author through it end to end,
in the `async-data-sources.md` style (the worked example, the contract, the
boundary), not one combined reference and not a one-line mention. A new or changed
extension point gets its guide written or revised, and the routing table in
`packages/authoring-a-package.md` (Field, Purpose, How-to) stays in step, in the
same change. The developer experience is only as good as the half
that is documented, and the half that drifts is the package surface, because it
has no reader typing an expression to notice.
