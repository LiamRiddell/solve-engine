---
"solve-engine": patch
---

A cooking conversion to a unit that is not a mass or a volume says "recognised", and `expectPackage(...).toBeWellFormed()` no longer counts a token category that only the deprecated module-level table holds

The cooking refusal was the one message the message-style lint (#775) still listed as pending, waiting on #736: it spelt "recognized" where every other message is in British English. It is reworded, and the lint's pending list is empty.

| line | before | now |
| --- | --- | --- |
| `2 cups flour in km` | "km" is not a recognized mass or volume unit | "km" is not a recognised mass or volume unit |
| `35 mpg foo in l/100km` | "mpg" is not a recognized mass or volume unit | "mpg" is not a recognised mass or volume unit |

The code, `COOKING_CONVERSION_UNSUPPORTED_UNIT`, is unchanged, so a host that reads the code rather than the text sees no difference.

`toBeWellFormed()` checks that every token type a package makes has a highlighting category, so an editor can colour it. It looked the type up with the deprecated `getTokenCategory`, which also reads the module-level table `registerTokenCategory` writes. No engine reads that table since categories became per engine (#710), so a package whose only category came from there passed the check and still showed uncoloured. The check now reads the package's own `tokenCategories` and the built-in table alone, which is what an engine reads.

| package | before | now |
| --- | --- | --- |
| a token with a category from `registerTokenCategory` only | passes | reported: its token has no `tokenCategories` entry |
| a token with a `tokenCategories` entry | passes | passes |

The boundary: the deprecated functions keep working as they did until 3.0 removes them; only the kit's verdict changes. A token named like an `Object.prototype` property (`constructor`) finds no category in the built-in table, as before.

## Verification

`Issue719_misconfiguration.spec.ts` gains two tests: a category registered only through `registerTokenCategory` is reported (and the test fails against the previous check), and prototype-named tokens are reported rather than read through the prototype. `Issue736_imperialMpg.spec.ts` asserts the reworded message. `Issue775_messageStyleLint.spec.ts` now tests the pending mechanism against a fixture list passed with the new `--pending=<file>` option, and adds adversarial cases: a pending list that is missing, not JSON, not an array, or holds a null, owner-less or non-text entry ends the run with one line and no stack, a blank part to match is refused because it would exempt the whole file, and a stale entry names the file it came from.
