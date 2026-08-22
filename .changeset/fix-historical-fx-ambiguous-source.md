---
"solve-engine": patch
---

A dated currency conversion never fetches a rate the amount does not resolve to.

When the source was a subexpression in which a foreign amount cancels out — `(100 USD * (5 JPY / 5 JPY)) in GBP on <date>` — the pre-fetch guessed the source from the nearest currency literal (the cancelled JPY) and fetched JPY→GBP, a wasted call that, against a real provider lacking that pair, fails. The converted value was already correct (the runtime read the true USD source), but the phantom fetch was not.

The rate is now fetched ahead of evaluation only when the amount's operand strings name exactly one currency (an unambiguous source, as a plain `100 USD in GBP on <date>` does). A mixed-currency subexpression is left to the runtime, which reads the source off the computed amount, so a single correct fetch happens and no invented pair is ever requested.
