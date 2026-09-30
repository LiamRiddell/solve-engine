---
"solve-engine": minor
---

Each currency is shown to its own places, and a bill is split in its smallest unit: `¥1000 / 3` is `¥333`, `100 KWD / 3` is `33.333 KWD`, `0.00012345 BTC` keeps its digits

Every amount of money was shown to the one place count set for quantities, two by default, and a split was shared out in hundredths, whatever the currency is counted in (#731). So `¥1000 / 3` was `¥333.33`, a hundredth of a yen nobody can pay, `100 KWD / 3` lost a fils, and `0.00012345 BTC` showed `0.00 BTC`. A currency's smallest payable amount is its minor unit, which ISO 4217 records for each code: none for the yen and the won, three for the Kuwaiti and Bahraini dinars, two for most. Each amount is now shown to that figure, and a split allocates that unit. A cryptocurrency, which ISO does not cover, has its own figure (eight places for bitcoin, the satoshi, and for ether, solana, dogecoin and polkadot; six for XRP and cardano) and is shown to between two places and that figure, so `1 BTC` still reads `1.00 BTC`.

| line | before | now |
| --- | --- | --- |
| `¥1000 / 3` | ¥333.33 | ¥333 |
| `¥1` | ¥1.00 | ¥1 |
| `100 KWD / 3` | 33.33 KWD | 33.333 KWD |
| `1.005 BHD` | 1.01 BHD | 1.005 BHD |
| `0.00012345 BTC` | 0.00 BTC | 0.00012345 BTC |
| `1 BTC / 3` | 0.33 BTC | 0.33333333 BTC |
| `¥100 split 3 ways` | ¥33.33 each, with 1 share paying ¥33.34 | ¥33 each, with 1 share paying ¥34 |
| `$100 split 3 ways` | $33.33 each, with 1 share paying $33.34 | $33.33 each, with 1 share paying $33.34 |

A two-place currency shows what it always showed, and every result the docs proved for one is unchanged. The figures are held in the engine (`uom/CurrencyMinorUnits.ts`) rather than read from `Intl.NumberFormat`, whose figures come from the runtime's copy of the Unicode locale data, differ from ISO's for a few codes and change between releases; an answer must not depend on the host's Node or browser version.

The boundary, and how it meets the host's setting: a line that names its places (`¥1000 / 3 to 2 dp`) is shown to them, as before. The minor unit applies whatever `unitOfMeasurementResult.decimalPlaces` holds, since two was the default long before currencies had figures of their own. A host that wants one place count for every currency sets the new `unitOfMeasurementResult.currencyPlaces` to `"setting"`; `"currency"` is the default and what a missing field reads as. A price per unit is not a payable amount, so it keeps at least the minor unit and up to `decimalPlaces` (`¥31.5/kWh`). A failed `check` still widens both sides to show where they differ. A shared symbol reads as its default, so `12 CNY`, written `¥12.00`, reads back as twelve yen and is shown `¥12`. An amount written with its code after it is still not read by `split` without brackets (`split 10 KWD between 3`), a separate gap; `split (10 KWD) between 3` works. The money-precision page explains minor units before it shows them, the splitting-a-bill page shows a yen and a dinar split, and the formatting guide documents the host setting.

## Verification

`Issue731_currencyMinorUnits.spec.ts` holds 54 tests: each zero-, three- and eight-place currency and the two-place ones unchanged; `to N dp` overriding; the answer read back in; splits in yen, dinars, bitcoin and dollars, including a remainder, a refund and a zero, with every share summing back to the exact total; the helpers `currencyMinorUnits`, `isCryptoCurrency`, `moneyDisplayPlaces`, `trimFractionZeros` and `minorUnitsOfMoney` with ordinary, boundary and hostile arguments; the table checked against `Intl` for the codes the two agree on, and against every cryptocurrency the exchange prices; both values of the host setting and a missing one; and the adversarial cases (prototype words as a currency, markup-shaped and fullwidth text, a long sum and a 34-digit split, half a smallest unit, negatives and the numeric edges, a conversion into yen and dinars at a primed rate, a price per unit in yen, an amount from the line above through both document passes). Two existing specs that pinned two places for the dong and the yen were updated, and `AdversarialFeatureSweep.spec.ts` gains the currency templates.

The fast suite (`npm run test:ci`) passed, 15,959 of 15,963 tests in 617 suites with 4 skipped, including the proven docs examples, and `npm run lint`, `lint:comments`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, with the engine and its specs type-checked by `tsc --noEmit`.
