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
