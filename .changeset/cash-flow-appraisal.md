---
"solve-engine": minor
---

Cash-flow appraisal: `npv of`, `irr of` and `payback of` judge a series of cash flows

The finance package worked on one sum at a time (`present value of`, `roi`, the annual return), so the question asked of an investment, an outlay followed by a return each period, had no form: `npv of -1000, 300, 400, 500 at 10%` failed at the first comma and `npv(...)` was an undefined function. Three forms now answer it: the net present value at a discount rate, the internal rate of return (the rate at which that value is zero), and the payback period (how long the running total takes to climb back to zero).

| expression | before | now |
| --- | --- | --- |
| `npv of -1000, 300, 400, 500 at 10%` | error: unexpected token `,` | -21.04 |
| `npv of -$1,000, $300, $400, $500 at 10%` | error: unexpected token `,` | $-21.04 |
| `npv of -100, 110 at 10%` | error: unexpected token `,` | 0 |
| `irr of -1000, 300, 400, 500` | error: unexpected token `,` | 8.90% |
| `irr of -100, 230, -132` | error: unexpected token `,` | error: 2 internal rates of return, 10.00% and 20.00% |
| `payback of -1000, 300, 400, 500` | error: unexpected token `,` | 2.60 |
| `payback of -1000, 300, 400` | error: unexpected token `,` | error: still 300 short after the last one |

The convention, stated on the new page: the first flow is today and is not discounted, and each later flow is one period further away, the reading a finance textbook uses. A spreadsheet's `NPV()` discounts the first value as well and answers -19.12 for the first row (-21.04 divided by 1.1); its usual idiom, the outlay added outside the function, is exactly the figure here. For that reason there is deliberately no `npv(...)` call spelling, since a call written like the spreadsheet's that answered differently would be a trap. `net present value of` and `payback period of` are the long spellings; the flows can also be one bracketed list or a variable holding one.

Money keeps its currency, and the discounting runs in exact decimals, so a series that breaks even exactly answers 0 rather than a floating-point remainder. The IRR does not guess: a series whose sign changes more than once can have several rates, and a spreadsheet's `IRR()` returns whichever its starting guess reaches. Here the rates are isolated exactly on the flows' own coefficients (Descartes' rule of signs, halving until each rate stands alone), so a single rate is answered only when there is exactly one, and otherwise every rate is named, or the series is refused as having none. The payback is fractional, taking the flow in the crossing period to arrive evenly through it, and a later outlay that pulls the total below zero again pays back the last time it recovers.

The boundary: flows are evenly spaced, one per period, so a dated series (a spreadsheet's `XNPV` and `XIRR`) is not a form, since it needs a day-count convention of its own. A series in two currencies is refused rather than converted, because a future flow at today's exchange rate would be a guess presented as a figure. There is no discounted payback and no modified IRR. The rate must be above -100%, and a bare-number rate is a proportion, as in the other finance forms. The triggers are the fused phrases, so `npv`, `irr` and `payback` alone stay ordinary names, and `IRR` stays the Iranian rial's currency code. Every refusal (a flow that is not an amount, fewer than two flows, a list mixed with loose flows, a rate at or below -100%, several rates or none, never paying back) is a structured error naming the problem, never a thrown exception or a wrong number; an `npv of` with no `at` clause is a parse error that names the missing rate, as the other finance phrases treat a missing clause. The forms are plugin functions on the finance package; no builtin index is added.

## Verification

A new spec, `__tests__/packages/finance/CashFlow.spec.ts`, pins every form against references computed outside the engine: exact rational arithmetic in Python for the NPV and payback figures, sympy's exact real-root isolation for every IRR, and Microsoft's own worked NPV and IRR examples (1,922.06, -3,749.47, 8.66%, -2.12%, -44.35%), with each refusal and its code. The new NPV, IRR & payback page carries proven `solve` and `solve-doc` examples, and the cheatsheet gains two lines. npm run verify:ci passes: TESTS tests across SUITES suites.
