# Comment and TSDoc standard

What comments in this codebase are for, and which parts of that a machine
checks. [AGENTS.md](../AGENTS.md) carries the short version; this is the
reasoning.

## The shape

Layered. The doc block states the contract a caller needs, because that is what
appears on hover and in generated documentation. Reasoning about the
implementation goes in short comments beside the line it explains, where someone
reading the code will actually meet it.

```ts
/**
 * Runs registered async resolvers before VM execution, so a line depending on
 * unresolved external data yields a pending value instead of computing with
 * missing inputs.
 *
 * @param program - Compiled bytecode for this line.
 * @param lineNumber - One-based line number, used for graph registration.
 * @returns `pending` when a resolver has not resolved yet, in which case the
 * caller must skip execution and return the enclosed value. `proceed` otherwise.
 */
private preflightAsync(program: BytecodeProgram, lineNumber: number): PreflightResult {
    // Fast path. Ordinary arithmetic has neither async opcodes nor registered
    // resolvers, so this costs one boolean check rather than a walk over the
    // registry.
    if (!(program.hasAsync || this.resolverRegistry.size > 0)) {
        return { kind: "proceed" };
    }
```

## The rules

1. Every exported symbol carries a doc block. Summary sentence first, then tags.
2. The summary says what the symbol does and, where it is not obvious, why it
   exists. It does not narrate history, sessions, dates, or who wrote it.
3. `@param` and `@returns` on anything with parameters or a non-void return.
   Name every parameter.
4. Implementation reasoning goes inline, at the line it explains, not in the
   doc block.
5. No em-dashes. Use a comma, a colon, parentheses, or a second sentence.
6. No emoji in comment prose. Showing one as a quoted example is fine where the
   thing being documented is an emoji.
7. Cross-reference with `{@link Symbol}` so it resolves in tooling, rather than
   prose like "see the doc comment on X".
8. Do not restate the code. A comment saying what the next line plainly says is
   deleted.

## What is enforced

Two of these are mechanical, so they are checks rather than review habits.

```bash
npm run lint:comments   # rules 5 and 6, over all engine source
npm run lint:docs       # rule 1, over the public surface
```

Both run in continuous integration.

`lint:docs` covers everything outside `src/packages`. The language packages
inside it are internals a consumer does not import directly, and 55 gaps remain
there. Holding them to the gate today would mean a red check with no route to
green, and a permanently red check is one people learn to ignore.

Rules 2, 3, 4, 7 and 8 are judgement. No check will tell you whether a summary
explains why something exists.

## Two things worth knowing

**The em-dash check used to be broken, silently.** It ran
`grep -P '\xe2\x80\x94'`, which exits 2 on a locale it cannot handle, and
`if grep ...` reads exit 2 the same as "no match". The job passed on every file
while 192 of them carried 1,752 violations. Both checks are Node now, with no
locale dependency, and each was verified to fail on a bad input rather than
only to pass on a good one. A gate nobody has watched fail is not known to work.

**Rewriting comments is not a find-and-replace.** These comments carry
hard-won detail: which words a package deliberately did not claim as keywords,
why a fusion window is two tokens wide, why a pivot strategy avoids row swaps.
The em-dash pass was safe because it changed punctuation and never words. Any
pass that rewrites prose should go file by file, keep every load-bearing fact,
discard only narration, and leave the suite green after each batch.
