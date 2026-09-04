---
"solve-engine": minor
---

Take-home pay: HMRC's bands take pounds, and everyone else states a rate.

The bands behind `after tax` are a fact about the United Kingdom. They were applied to whatever the line carried, and the answer printed in that currency, so a dollar salary got a confident figure about a country the bands say nothing about, and a bare number got Britain assumed in silence.

| before | now |
| --- | --- |
| `$50,000 after tax` was `$39,519.60` | `these are HMRC's bands, which say nothing about USD: state a rate instead, as in "50,000 after 20% tax"` |
| `50000 after tax` was `39,519.60` | `these are HMRC's bands, so this needs a pound salary: write "£50,000 after tax", or state a rate with "50,000 after 20% tax"` |
| `£50,000 after tax` was `£39,519.60` | `£39,519.60`, unchanged |

The refusal names a form that now exists, because the question behind those lines is a real one:

```
£50,000 after 20% tax    £40,000.00
$50,000 after 20% tax    $40,000.00
50000 after 20% tax      40,000
```

Nothing about a stated rate is national, so it takes any currency and a bare number, and it binds the way the banded form does: `50000 + 2000 after 20% tax` is `41,600`. A rate outside 0 to 100 is refused rather than applied. `vat` reads the same as `tax`.

Three boundaries worth stating. `hourly for` is **not** gated, because a salary over a working year is a division with no bands in it, so `hourly for $45,000` is `$23.44`. `after` on its own is untouched: the whole shape, closing word included, is required before the phrase is claimed. And Scotland is still not covered, which is now one case of a general rule rather than a lone footnote: a rate that is not shipped is not assumed.

This changes documented behaviour. `50000 after tax` was a proven example on the payroll page and is now written `£50,000 after tax`; the page says why, and shows the stated-rate form beside it.
