import { afterEach, describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS, type FormattingSettings } from "@solve-js/format/FormattingSettings";
import { currencyMinorUnits, isCryptoCurrency, moneyDisplayPlaces, trimFractionZeros } from "@solve-js/uom/CurrencyMinorUnits";
import { ISO_4217_CODES } from "@solve-js/uom/Iso4217";
import { CurrencyExchangeService, currencyExchangeService } from "@solve-js/uom/CurrencyExchange";
import { minorUnitsOfMoney, splitEachExact } from "@solve-js/vm/MoneyExact";
import { makeDecimal } from "@solve-js/decimal";
import { Value, ValueType, uomValue, uomValueExact } from "@solve-js/vm/Value";

/**
 * Issue #731: every currency was shown to two places, and a bill split into
 * hundredths, whatever the currency counts in. `¥1000 / 3` was `¥333.33`, a
 * hundredth of a yen nobody can pay; `100 KWD / 3` was `33.33 KWD`, a fils
 * short; and `0.00012345 BTC` was `0.00 BTC`. Each currency is now shown to its
 * ISO 4217 minor unit, a cryptocurrency to its own figure, and a split shares
 * out the currency's smallest unit.
 */

afterEach(() => {
	currencyExchangeService.clearRates();
});

function shown(line: string, settings?: FormattingSettings): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line), settings);
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const HOST_TWO_PLACES: FormattingSettings = {
	...DEFAULT_FORMATTING_SETTINGS,
	unitOfMeasurementResult: { decimalPlaces: 2, currencyPlaces: "setting" },
};

describe("each currency is shown to its own places", () => {
	test.each([
		["¥1000 / 3", "= ¥333"],
		["¥1", "= ¥1"],
		["100 KWD / 3", "= 33.333 KWD"],
		["1 KWD", "= 1.000 KWD"],
		["1.005 BHD", "= 1.005 BHD"],
		["1.0005 BHD", "= 1.001 BHD"],
		["₩50000 / 7", "= ₩7,143"],
		["12 VND", "= 12₫"],
		["0.00012345 BTC", "= 0.00012345 BTC"],
		["1 BTC / 3", "= 0.33333333 BTC"],
		["1 BTC", "= 1.00 BTC"],
		["1 XRP / 3", "= 0.333333 XRP"],
		["-¥1000 / 3", "= -¥333"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a two-place currency shows what it always showed", () => {
		for (const [line, expected] of [["$100 / 3", "= $33.33"], ["$1.005", "= $1.01"], ["£1234.5", "= £1,234.50"], ["$0.001", "= $0.00"], ["12 SEK", "= 12.00 kr"], ["€0.10 + €0.20", "= €0.30"]]) {
			expect(shown(line)).toBe(expected);
		}
	});

	test("`to N dp` still names the places", () => {
		expect(shown("¥1000 / 3 to 2 dp")).toBe("= ¥333.33");
		expect(shown("100 KWD / 3 to 2 dp")).toBe("= 33.33 KWD");
		expect(shown("0.00012345 BTC to 3 dp")).toBe("= 0.000 BTC");
		expect(shown("¥1000 / 3 to 0 dp")).toBe("= ¥333");
	});

	test("the answer reads back as the same amount", () => {
		for (const line of ["¥1000 / 3", "100 KWD / 3", "0.00012345 BTC", "₩50000 / 7", "12 VND"]) {
			const written = shown(line).replace(/^= /, "");
			expect({ line, back: shown(written) }).toEqual({ line, back: shown(line) });
		}
	});
});

describe("a split shares out the currency's smallest unit", () => {
	test.each([
		["¥100 split 3 ways", "= ¥33 each, with 1 share paying ¥34"],
		["split ¥1000 between 3", "= ¥333 each, with 1 share paying ¥334"],
		["split (10 KWD) between 3", "= 3.333 KWD each, with 1 share paying 3.334 KWD"],
		["split (1 BTC) between 3", "= 0.33333333 BTC each, with 1 share paying 0.33333334 BTC"],
		["$100 split 3 ways", "= $33.33 each, with 1 share paying $33.34"],
		["split (¥1) between 3", "= ¥0 each, with 1 share paying ¥1"],
		["split (-¥100) between 3", "= -¥33 each, with 1 share paying -¥34"],
		["split (¥0) between 3", "= ¥0 each"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the shares add back to the total exactly", () => {
		for (const [unit, total, places] of [["JPY", 100n, 0], ["KWD", 10000n, 3], ["BTC", 100000000n, 8], ["USD", 10000n, 2]] as const) {
			const amount = uomValueExact(Number(total) / 10 ** places, unit, makeDecimal(total, places));
			for (const n of [1, 3, 7, 11]) {
				const split = splitEachExact(amount, n);
				const sum = split.shares.reduce((acc, share) => acc + (share.exact?.coef ?? 0n) * BigInt(share.count), 0n);
				expect({ unit, n, sum }).toEqual({ unit, n, sum: total });
				for (const share of split.shares) expect(share.exact?.scale).toBe(places);
			}
		}
	});
});

describe("currencyMinorUnits", () => {
	test("ordinary: the ISO figures and the crypto figures", () => {
		expect(currencyMinorUnits("USD")).toBe(2);
		expect(currencyMinorUnits("JPY")).toBe(0);
		expect(currencyMinorUnits("KRW")).toBe(0);
		expect(currencyMinorUnits("KWD")).toBe(3);
		expect(currencyMinorUnits("BHD")).toBe(3);
		expect(currencyMinorUnits("CLF")).toBe(4);
		expect(currencyMinorUnits("BTC")).toBe(8);
		expect(currencyMinorUnits("XRP")).toBe(6);
	});

	test("boundary: any case, an unknown code, an empty code", () => {
		expect(currencyMinorUnits("jpy")).toBe(0);
		expect(currencyMinorUnits("btc")).toBe(8);
		expect(currencyMinorUnits("ZZZ")).toBe(2);
		expect(currencyMinorUnits("")).toBe(2);
	});

	test("hostile: inherited names are unknown codes", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(currencyMinorUnits(word)).toBe(2);
				expect(isCryptoCurrency(word)).toBe(false);
			}
		});
	});

	test("it agrees with Intl for the codes whose figure the Unicode data and ISO share", () => {
		// Intl reports the Unicode locale data's figures, which differ from ISO's
		// for a handful of codes (and between runtime versions), which is why the
		// table is held here. Every code where the two agree today must match.
		const mismatched: string[] = [];
		for (const code of ISO_4217_CODES) {
			let intl: number | undefined;
			try {
				intl = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits;
			} catch {
				continue;
			}
			if (intl !== currencyMinorUnits(code)) mismatched.push(`${code}: intl ${intl}, iso ${currencyMinorUnits(code)}`);
		}
		for (const code of ["USD", "EUR", "GBP", "JPY", "KWD", "BHD", "OMR", "JOD", "TND", "KRW", "VND", "CLP"]) {
			expect(mismatched.find((m) => m.startsWith(`${code}:`))).toBeUndefined();
		}
	});

	test("every cryptocurrency the exchange prices has a figure", () => {
		const ids = (CurrencyExchangeService as unknown as { CRYPTO_IDS: Record<string, string> }).CRYPTO_IDS;
		for (const code of Object.keys(ids)) expect({ code, crypto: isCryptoCurrency(code) }).toEqual({ code, crypto: true });
		for (const code of ["USD", "JPY", "XAU", "BTCX"]) expect(isCryptoCurrency(code)).toBe(false);
	});
});

describe("moneyDisplayPlaces", () => {
	test("an amount is its minor unit exactly", () => {
		expect(moneyDisplayPlaces("JPY", 2, false)).toEqual({ min: 0, max: 0 });
		expect(moneyDisplayPlaces("USD", 2, false)).toEqual({ min: 2, max: 2 });
		expect(moneyDisplayPlaces("KWD", 2, false)).toEqual({ min: 3, max: 3 });
		expect(moneyDisplayPlaces("USD", 6, false)).toEqual({ min: 2, max: 2 });
	});

	test("a price per unit keeps the minor unit and up to the setting", () => {
		expect(moneyDisplayPlaces("JPY", 2, true)).toEqual({ min: 0, max: 2 });
		expect(moneyDisplayPlaces("USD", 4, true)).toEqual({ min: 2, max: 4 });
		expect(moneyDisplayPlaces("KWD", 0, true)).toEqual({ min: 3, max: 3 });
	});

	test("a cryptocurrency ranges from two places to its own figure", () => {
		expect(moneyDisplayPlaces("BTC", 2, false)).toEqual({ min: 2, max: 8 });
		expect(moneyDisplayPlaces("XRP", 0, true)).toEqual({ min: 2, max: 6 });
	});
});

describe("trimFractionZeros", () => {
	test.each([
		["0.33333300", 2, "0.333333"],
		["1.00000000", 2, "1.00"],
		["3.00", 0, "3"],
		["-3.50", 0, "-3.5"],
		["12", 2, "12"],
		["0.10", 2, "0.10"],
		["1e-7", 2, "1e-7"],
		["Infinity", 2, "Infinity"],
		["", 2, ""],
		["1.", 0, "1."],
	])("%j keeping %i is %j", (fixed, min, expected) => {
		expect(trimFractionZeros(fixed, min)).toBe(expected);
	});

	test("a long fraction is trimmed in time", () => {
		const started = performance.now();
		expect(trimFractionZeros(`1.${"0".repeat(100_000)}`, 0)).toBe("1");
		expect(performance.now() - started).toBeLessThan(500);
	});
});

describe("minorUnitsOfMoney", () => {
	test("ordinary and boundary: the coefficient in the smallest unit, half away from zero", () => {
		expect(minorUnitsOfMoney(uomValueExact(1.25, "USD", makeDecimal(125n, 2)), "USD", 2)).toBe(125n);
		expect(minorUnitsOfMoney(uomValueExact(0.5, "JPY", makeDecimal(5n, 1)), "JPY", 0)).toBe(1n);
		expect(minorUnitsOfMoney(uomValueExact(-0.5, "JPY", makeDecimal(-5n, 1)), "JPY", 0)).toBe(-1n);
		expect(minorUnitsOfMoney(uomValueExact(1.0005, "KWD", makeDecimal(10005n, 4)), "KWD", 3)).toBe(1001n);
	});

	test("an amount with no exact decimal has none", () => {
		expect(minorUnitsOfMoney(uomValue(1 / 3, "JPY"), "JPY", 0)).toBeNull();
	});

	test("a unit that is not money is split evenly as a number", () => {
		const split = splitEachExact(uomValue(10, "km"), 3);
		expect(split.shares).toHaveLength(1);
		expect(split.shares[0].count).toBe(3);
	});
});

describe("a host chooses where money takes its places from", () => {
	test("'setting' shows every currency to the setting, as before", () => {
		expect(shown("¥1000 / 3", HOST_TWO_PLACES)).toBe("= ¥333.33");
		expect(shown("100 KWD / 3", HOST_TWO_PLACES)).toBe("= 33.33 KWD");
		expect(shown("0.00012345 BTC", HOST_TWO_PLACES)).toBe("= 0.00 BTC");
		expect(shown("$100 / 3", HOST_TWO_PLACES)).toBe("= $33.33");
	});

	test("'currency', and a missing field, read the minor unit", () => {
		const explicit = { ...DEFAULT_FORMATTING_SETTINGS, unitOfMeasurementResult: { decimalPlaces: 2, currencyPlaces: "currency" as const } };
		const missing = { ...DEFAULT_FORMATTING_SETTINGS, unitOfMeasurementResult: { decimalPlaces: 4 } };
		expect(shown("¥1000 / 3", explicit)).toBe("= ¥333");
		expect(shown("¥1000 / 3", missing)).toBe("= ¥333");
		expect(shown("$100 / 3", missing)).toBe("= $33.33");
		expect(shown("¥31.5/kWh", missing)).toBe("= ¥31.5/kWh");
	});

	test("a split under 'setting' still pays out whole yen, shown to the setting", () => {
		expect(shown("¥100 split 3 ways", HOST_TWO_PLACES)).toBe("= ¥33.00 each, with 1 share paying ¥34.00");
	});

	test("a failed check widens both sides past the minor unit, to tell them apart", () => {
		expect(shown("check ¥1000 / 3 == ¥333")).toContain("¥333.333");
	});
});

describe("adversarial", () => {
	test("security: inherited names as a currency, markup-shaped and look-alike text, long input", () => {
		expectPrototypeUntouched(() => {
			for (const line of [...fill("100 X / 3", PROTOTYPE_WORDS), ...fill("¥100 split 3 X", PROTOTYPE_WORDS)]) expectHonestLine(line);
			for (const word of PROTOTYPE_WORDS) expect(formatValue(new Value(ValueType.Uom, 1, word))).toBe(`= 1.00 ${word}`);
		});
		for (const line of fill("¥X / 3", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
		// Fullwidth digits after the yen are not an amount the engine reads as the ASCII one.
		expectHonestLine("¥１０００ / 3");
		expectHonestLine(`¥${RESOURCE_PROBES.longSum(2_000)}`, { budgetMs: 5_000 });
		expectHonestLine(`split ¥${"9".repeat(34)} between 7`, { budgetMs: 5_000 });
	});

	test("realistic: an amount from the line above, a conversion into yen, a price in yen", () => {
		const { batch, incremental } = expectHonestDocument("bill = ¥1000\nbill / 3\nsplit bill between 3\nprev");
		expect(batch.slice(0, 3)).toEqual(["= ¥1,000", "= ¥333", "= ¥333 each, with 1 share paying ¥334"]);
		expect(incremental).toEqual(batch);
		currencyExchangeService.primeRates("USD", { JPY: 150.37, KWD: 0.30712 }, { provider: "host" });
		expect(shown("$10 in JPY")).toBe("= ¥1,504");
		expect(shown("$10 in KWD")).toBe("= 3.071 KWD");
		expect(shown("¥3/kWh")).toBe("= ¥3/kWh");
		expect(shown("12 kWh * ¥31.5/kWh")).toBe("= ¥378");
		expectHonestLine("100 KWDD / 3");
	});

	test("edge: half a smallest unit, zero and negatives, the numeric edges", () => {
		expect(shown("¥0.5")).toBe("= ¥1");
		expect(shown("-¥0.5")).toBe("= -¥1");
		expect(shown("¥0.4")).toBe("= ¥0");
		expect(shown("0.0005 KWD")).toBe("= 0.001 KWD");
		expect(shown("0.000000005 BTC")).toBe("= 0.00000001 BTC");
		expect(shown("0.000000001 BTC")).toBe("= 0.00 BTC");
		expect(shown("¥0")).toBe("= ¥0");
		for (const line of [...fill("¥X", NUMERIC_EDGES), ...fill("X KWD", NUMERIC_EDGES), ...fill("X BTC", NUMERIC_EDGES), ...fill("¥X split 3 ways", NUMERIC_EDGES)]) {
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		}
	});
});
