---
"solve-engine": patch
---

The listing of registered phrases holds only its own entries, so a phrase spelled `__proto__` is listed rather than lost

`PhraseTrie.getAllPhrases`, which `TokenNormalizer.getPhrases` returns to the diagnostics view, built its listing in a plain object literal. A phrase spelled exactly `__proto__` went through the prototype setter and was silently missing, and a lookup of `constructor` or `toString` in the listing found the inherited function rather than nothing (found bug, no issue). The listing now has no prototype.

| phrase registered | before | now |
| --- | --- | --- |
| `__proto__` | missing from the listing | listed with its token type |
| none named `toString` | `listing["toString"]` is a function | `listing["toString"]` is undefined |
| `total of`, `average of`, ... | listed | listed, unchanged |

The boundary: only the container changed. The keys, the values and their order are as before, `Object.entries` and `JSON.stringify` read the listing the same way, and the return type is still a record of phrase to token type. A separate change that builds each phrase as one string instead of copying the word list at every level touches the same method and merges cleanly with this one.

## Verification

`FoundBug_phraseListingPrototypeWords.spec.ts` holds 6 tests: ordinary phrases, an empty trie with nothing inherited, every word in `PROTOTYPE_WORDS` registered alone and as `<word> of` with `expectPrototypeUntouched`, a hostile token type, a JSON round trip, and the engine's built-in listing. Five of the six fail with the plain object literal restored. `PhraseTrie.spec.ts` still passes.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, and the normaliser suite.

On top of main, the full suite ran 33,251 tests in 839 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,740 tests.
