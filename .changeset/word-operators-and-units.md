---
"solve-engine": minor
---

More word operators, a third conversion keyword, and the length and mass units the tables were missing.

`with` adds and `without` subtracts, `mul` and `multiplied by` join `times` and `multiply by`, and `into` converts alongside `to` and `in`.

Eighteen units are new: the surveying chain of lengths (mil, hand, rod, chain, furlong, cable, league) and two metric masses (carat, centner), each with its plural.

Those needed an architectural change rather than a table entry, because the unit table is generated from an upstream package and cannot be hand-edited. Extended units could previously only define measures the base table had never heard of, and a mixed pair was refused outright as "disjoint by construction". They are not disjoint once an extended unit names a measure the base table also has: a furlong is a length, and both tables state their ratios against the same metre. Extended units now bridge into a shared measure, so `1 mile in furlongs` and `1 m in mil` work in both directions. A measure the base table genuinely has no concept of, such as pace, still cannot cross.

The unit reference page also lists the extended units now. It was generated from the base table alone and so was short by about thirty spellings, on a page whose first line claims to list every one the engine accepts.
