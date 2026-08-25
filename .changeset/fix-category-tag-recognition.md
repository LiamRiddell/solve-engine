---
"solve-engine": minor
---

Category tags are now recognised the same way everywhere, fixing two cases where a tag was half-recognised or lost.

## A tag glued to a word or number is no longer half-recognised

The lexer tagged any `#` followed by a letter, ignoring the character before it, while the aggregate scanner only counted a tag at a word boundary. So `100#food` was stripped from its own line as if tagged, yet left out of `total of #food`: a line that looked tagged but did not count.

| line | before | now |
| --- | --- | --- |
| `100#food` | stripped to `100`, but excluded from the total | left whole (`#food` reads as a comment), and excluded |
| `100 #food` | tagged and counted | tagged and counted |

A `#` glued to the end of a word or number is now not a tag in either half, so `100#food` and `a#food` stay whole and only `100 #food`, with a space, tags the line. A `#` inside a word is kept out of the feature.

## A tag named after a grammar word is no longer swallowed

The phrase trie fuses multi-word phrases by their written value, ahead of the tag rules, so a tag whose name completed a phrase was consumed as the bare word. `total of #column` errored ("expected a column name"), and `1200 #assuming` errored ("unexpected token"), instead of tagging the line.

```
expression            result
40 #column            = 40      (tagged #column)
55 #column            = 55
total of #column      = 95
1200 #assuming        = 1,200
```

The trie now skips a `TAG` token: a typed `#tag` never starts or completes a phrase, so a category can be named after a word wherever that word appears in the grammar.

The boundary: aggregating a tag whose name is a package keyword (`total of #assuming`) is a separate, deeper collision, tracked as a follow-up rather than fixed here.

## Verification

- Two regression specs pin the fixes. `Issue197` covers the two reported cases, the tag still being stripped from its own line, and a property test that every built-in phrase word survives as a `TAG` rather than fusing. `Issue198` covers the lexer now agreeing with the scanner on every boundary case, and a glued tag being neither shown as tagged nor counted.
- The existing tag, lexer, normalizer, finance and math-phrase suites pass unchanged, and `npm run verify` (typecheck, `test:ci`, build, smoke, the bundled-consumer contract) is green.
