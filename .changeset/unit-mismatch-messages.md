---
"solve-engine": patch
---

Unit mismatches now read as sentences instead of a bare code.

`5 kg + 3 m` and `1 hour in metres` both surfaced the raw **INCOMPATIBLE_UNITS**, which told a reader nothing and was the same string whether they had added mass to length, their mistake, or asked for a conversion the engine cannot do, a different situation. Now that dimensions are tracked there is something specific to name, and the two causes read differently:

```
5 kg + 3 m           was INCOMPATIBLE_UNITS,  now "mass and length cannot be added"
5 kg - 3 m           was INCOMPATIBLE_UNITS,  now "mass and length cannot be subtracted"
1 hour in metres     was INCOMPATIBLE_UNITS,  now "a duration cannot be converted to a length"
5 kg in m            was INCOMPATIBLE_UNITS,  now "a mass cannot be converted to a length"
$100 in kg           was INCOMPATIBLE_UNITS,  now "money cannot be converted to a mass"
5 kg < 3 m           was INCOMPATIBLE_UNITS,  now "mass and length cannot be compared"
```

The dimension is named from the same measure table the converter already uses, so a quantity of time reads as a "duration" and a currency as "money". Combining, converting, comparing, and `min`/`max` across dimensions all read this way.

The error **code is unchanged**: it is still `INCOMPATIBLE_UNITS`, so anything matching on the code keeps working. Only the human-readable message changed, and no expression that used to evaluate changed its result.

A pair with no single dimension to name keeps the older message that names the units instead, so the sentence never trails off into "undefined". That covers a compound rate such as `km/h`, a currency code the exchange does not recognise, and two different currencies with no cached rate (both are money, a missing-rate case rather than a dimension mismatch), which still reports "Cannot combine incompatible units: BTC and ETH".
