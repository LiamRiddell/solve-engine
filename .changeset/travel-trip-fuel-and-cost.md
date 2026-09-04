---
"solve-engine": minor
---

What a journey burns, and what that costs.

Fuel economy conversion and drive time already shipped. What was missing is the pair of sums that join a distance, a car's economy and the price at the pump, neither of which a unit conversion can express, because each needs two quantities of different kinds.

| expression | result |
| --- | --- |
| `fuel for 500 km at 7 l/100km` | `35.00 litre` |
| `fuel for 300 miles at 35 mpg` | `32.45 litre` |
| `cost to drive 500 km at 7 l/100km at £1.50/litre` | `£52.50` |
| `cost to drive 300 miles at 35 mpg at £1.50/litre` | `£48.67` |
| `cost to drive 300 miles at 35 mpg at $4.20/gallon` | `$36.00` |

Either way of writing economy works with either kind of distance, and `fuel to drive` and `per` read the same as `fuel for` and the slash. The price carries its own volume, so a pump quoting gallons works with a trip measured in kilometres, which is the ordinary state of affairs in a hire car: the litres are converted into what the pump quoted before multiplying.

Each part must be the kind of thing it claims to be, and a line that is not says which part was wrong rather than answering with a number.

```
fuel for 500 km at 35 kg      "kg" is not a fuel economy: write it as mpg or l/100km
fuel for 50 kg at 7 l/100km   a trip starts with a distance, as in "fuel for 500 km at 7 l/100km"
```

The boundary: no live fuel prices. A pump price is local and changes daily, so the price is stated on the line and nothing here reaches the network.

The reciprocal is the thing this had to get right. Miles per gallon is distance over volume and litres per hundred kilometres is volume over distance, so the two are filed as different measures, and `canConvert` between them is false. Asked to convert anyway, `convertUnit` does not refuse: it answers 1,488 for 35 mpg, a number with no meaning, which is what a first version of this arithmetic built a seven-thousand-litre trip on. The economy now goes through `convertRate`, the path the engine's own `40 mpg in l/100km` takes, which answers null rather than a wrong number, and a spec pins both directions against hand-computed figures.
