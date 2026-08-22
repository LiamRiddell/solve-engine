---
"solve-engine": minor
---

Interest and repayment read the term and the rate in either order.

The interest and mortgage-repayment forms accepted only the term before the rate, so `interest on 1000 over 3 years at 5%` worked but the equally natural reverse threw a parse error:

```
interest on 1000 at 5% over 3 years              was a parse error, now 157.63
monthly repayment on 200000 at 4% over 25 years  was a parse error, now 1,055.67
```

The two clauses are independent — `over` names the term, `at` names the rate — so a person has no way to know which order the grammar wants. Both orders now parse to the same result, for `interest on`, `compound interest on`, and every `daily`/`monthly`/`annual`/`total` repayment and loan-interest form, and a trailing `compounding monthly` still reads after either arrangement.
