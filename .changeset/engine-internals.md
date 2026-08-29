---
"solve-engine": minor
---

Raise the plugin-function ceiling past 256, index the normalizer, and remove dead code.

Three internal changes, no change to any documented behaviour.

## More than 256 plugin functions

The plugin-function index is a bytecode operand and was a single byte, so a
process could register at most 256 plugin functions before the allocator threw
(the built-ins already use 137). A new `CALL_PLUGIN_WIDE` opcode carries a
two-byte index and is emitted only when an index exceeds 255; the one-byte
`CALL_PLUGIN` is unchanged, so existing compiled bytecode and snapshots are
byte-for-byte identical. The ceiling rises to 65536. A test proves a function
past index 255 dispatches to the exact slot (index 300 stays 300, not the
wrapped 44).

## Faster document parsing

The token normaliser tried every registered rule at every token position. Most
rules begin with a single first-token guard (a call-fusion rule only fires on an
identifier), so trying them at the many number and operator tokens in a document
was wasted work. Rules now carry an optional `startTokenTypes` hint and the
normaliser only tries a rule at a matching position, which is behaviour-identical
because the rule would have returned nothing elsewhere. Parse-heavy benchmarks
improve by a few per cent with no regression.

## Dead code

Removed seven unused internal exports (`isComplexOne`, `consumeVariableName`, the
`DebugInfo`/`ParseletInfo` tooling interfaces, the `EventType` alias,
`functionCallsUsed`, `registerLocale`), an accidental duplicate declaration of
`DiagnosticReportJSON`, and the imports they left behind. None was on the public
API surface.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks. The benchmark comparison
against the merge base reports no regression over threshold. New test:
`vm/WidePluginIndex.spec.ts`.
