---
"solve-engine": patch
---

Category tags: an aggregate of a tag whose name is a package keyword now sums instead of erroring.

`total of #tag` fuses to an internal aggregate token whose value is the tag name. When that name was also a lexer keyword, `assuming` from the finance package, the phrase trie re-read the fused token's value on the next normalizer pass and turned it back into the keyword, so `total of #assuming` collapsed to a bare `ASSUMING` and errored. A non-keyword tag (`total of #column`) and a plain data-line tag (`1200 #assuming`) were already fine; only the aggregate of a keyword-named tag broke.

```
expression                result
1200 #assuming            = 1,200
800 #assuming             = 800
total of #assuming        = 2,000
```

The phrase trie's tag guard now covers the fused `TAG_SUM` / `TAG_COUNT` / `TAG_AVERAGE` tokens as well as the raw `TAG`, so a tag name is never re-interpreted as a keyword once the aggregate has claimed it.

## Verification

- A regression spec (`Issue213`) aggregates a keyword-named tag through `total` / `sum` / `count` / `average`, and asserts the line fuses to a `TAG_SUM` token rather than the bare keyword.
- The existing tag, finance and normalizer suites pass unchanged, and `npm run verify` is green.
