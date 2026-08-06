---
"solve-engine": minor
---

Percentages are relative, and the investments syntax works.

**`200 + 10%` is 220.** It used to be 200.10, because `%` compiled to a literal divide-by-100 and the result was an ordinary number. A percentage is a proportion *of* something, so which reading applies now depends on what it sits next to: `$300 + 15%` is `$345.00` and keeps its currency, `10% + 20%` is `30%`, and `100% + 2` is `300%` rather than `3`. Multiplication is untouched, because there the percentage is already the factor it is: `50% × 30` is still 15, and a bare `15%` is still 0.15.

This changes answers previously pinned by issues #79 and #81. Those regression tests are updated rather than removed, and both issues' actual complaints still hold.

**Soulver's documented investment expressions parse.** Previously every one of them threw; only the mortgage grammar worked. Now:

```
$1,000 after 3 years at 7%                                    $1,225.04
$1,000 for 3 years at 7% compounding monthly                  $1,232.93
$1,000 for 3 years at 7% compounding quarterly                $1,231.44
interest on $1,000 after 3 years @ 7%                         $225.04
present value of $1,000 after 20 years at 10%                 $148.64
$500 invested $1,500 returned                                 2
annual return on $1,000 invested $2,500 returned after 7 years   13.99%
```

`compounding` accepts daily, weekly, fortnightly, monthly, quarterly, semi-annually and annually, and names the whole set when given something else. Return on investment is the gain against the cost, so tripling your money is a 2x return; the money multiple is `$1,500 / $500`. The annualised return is the compound rate that actually reproduces the figure, returned as a percentage.

The older `compound interest on X over Y years at Z%` spelling still parses, and `after`, `for`, `over`, `at` and `@` are now interchangeable where they read naturally.
