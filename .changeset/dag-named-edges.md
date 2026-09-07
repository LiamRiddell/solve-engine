---
"solve-engine": patch
---

The dependency graph indexes edges, and a kind is only a prefix

The graph began as variable tracking and grew a second, parallel mechanism for
data sources: `dataSourceDependencies` and `dataSourceConsumers` were a copy of
the `lineReads` and `consumers` pair with a hand-built string key. Two mechanisms
doing one job is the sign the first was not general enough, and category tags
would have been a third copy.

There is one key space now, namespaced by kind, and one pair of indexes over it.
`edgeKey(kind, name)` names the space: a variable's key is the bare name, which
is what every existing caller already passes and which cannot collide, since an
identifier can hold neither a colon nor a leading hash; `global:` is preserved
verbatim from where it already existed; tags and data sources take their own
prefixes. Adding a kind is adding a prefix, not a mechanism.

The half that was missing is the reverse direction. `consumers` answers "which
lines read this", and nothing answered "which lines write it" — which is exactly
what a group needs in order to know its own membership, and why a category-tag
aggregate walks the whole document rather than asking. `producers` is that index,
maintained when a line registers, unhooked when a line is re-registered into
different groups, and cleaned when a line is removed.

Data-source edges are ordinary reads in those same indexes now, and their two
maps are gone. They are tracked as *pinned* reads, because they are discovered
while a line runs rather than recovered from its text, so the registration that
follows must not treat them as edges that went away.
`getAffectedLinesByDataSource` and the diagnostic snapshot keep the shapes they
had, and the snapshot gains the new direction alongside them.

No behaviour changes: this is the mechanism the tag and positional work in #388
and #397 needs, landed on its own so those are wiring rather than redesign.
