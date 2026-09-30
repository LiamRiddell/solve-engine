import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue, moneyUnitOf, timeWordForCount } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { Value, ValueType } from "@solve-js/vm/Value";

/**
 * Issue #753: a time word ignored its count, so `3600 seconds in hours` showed
 * `= 1 hours` and `2 hour` showed `= 2 hour`; and a money rate showed its
 * currency code, so `$15 per hour` showed `= 15.00 USD/hour` where `$15`
 * shows `= $15.00`.
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function quantity(value: number, unit: string): Value {
	return new Value(ValueType.Uom, value, unit);
}

describe("a time word agrees with its count", () => {
	test.each([
		["3600 seconds in hours", "= 1 hour"],
		["60 seconds in minutes", "= 1 minute"],
		["2 hour", "= 2 hours"],
		["1 day", "= 1 day"],
		["1 hours", "= 1 hour"],
		["7 days in weeks", "= 1 week"],
		["-1 hours", "= -1 hour"],
		["0 hours", "= 0 hours"],
		["0 hour", "= 0 hours"],
		["1.5 hours", "= 1.50 hours"],
		["0.5 day", "= 0.50 days"],
		["1.0000001 hours", "= 1.00 hours"],
		["1 hour to minutes", "= 60 minutes"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a symbol never takes a plural", () => {
		expect(shown("2 h")).toBe("= 2.00 h");
		expect(shown("1 min")).toBe("= 1.00 min");
		expect(shown("3 km")).toBe("= 3.00 km");
	});

	test("the answer reads back as the same amount", () => {
		for (const line of ["3600 seconds in hours", "2 hour", "0 hour", "-1 hours"]) {
			const written = shown(line).replace(/^= /, "");
			expect(shown(written)).toBe(shown(line));
		}
	});

	test("a word other than a time word keeps its spelling", () => {
		expect(shown("1609.344 m in miles")).toBe("= 1.00 miles");
		expect(shown("1 workday")).toBe(formatValue(quantity(1, "workday")));
	});
});

describe("timeWordForCount", () => {
	test("ordinary: each pair both ways", () => {
		for (const [one, many] of [["second", "seconds"], ["minute", "minutes"], ["hour", "hours"], ["day", "days"], ["week", "weeks"], ["month", "months"], ["year", "years"]]) {
			expect(timeWordForCount(one, 1)).toBe(one);
			expect(timeWordForCount(many, 1)).toBe(one);
			expect(timeWordForCount(one, 2)).toBe(many);
			expect(timeWordForCount(many, 2)).toBe(many);
		}
	});

	test("boundary: minus one, zero, negative zero, a fraction and the edges of a double", () => {
		expect(timeWordForCount("hours", -1)).toBe("hour");
		expect(timeWordForCount("hour", 0)).toBe("hours");
		expect(timeWordForCount("hour", -0)).toBe("hours");
		expect(timeWordForCount("hour", 1 + Number.EPSILON)).toBe("hours");
		expect(timeWordForCount("hour", Number.MAX_VALUE)).toBe("hours");
		expect(timeWordForCount("hour", Number.MIN_VALUE)).toBe("hours");
		expect(timeWordForCount("hour", Infinity)).toBe("hours");
		expect(timeWordForCount("hour", NaN)).toBe("hours");
	});

	test("hostile: a word that is not a time word, an inherited name, an empty word", () => {
		expectPrototypeUntouched(() => {
			for (const word of [...PROTOTYPE_WORDS, "", "h", "Hours", "hourss", "km"]) {
				expect(timeWordForCount(word, 1)).toBe(word);
				expect(timeWordForCount(word, 2)).toBe(word);
			}
		});
	});
});

describe("a money rate reads as money", () => {
	test.each([
		["$15 per hour", "= $15.00/hour"],
		["£12 per hour", "= £12.00/hour"],
		["€20 per day", "= €20.00/day"],
		["$0.30/kWh", "= $0.30/kWh"],
		["-$15 per hour", "= -$15.00/hour"],
		["5 SEK per hour", "= 5.00 kr/hour"],
		["12 RUB per day", "= 12.00 ₽/day"],
		["5 UYU per hour", "= 5.00 UYU/hour"],
		["$1.005/kg", "= $1.01/kg"],
		["$0.001/kWh", "= $0.001/kWh"],
		["0.001 USD/kWh", "= $0.001/kWh"],
		["$15/hour * 8 hours", "= $120.00"],
		["$30/hour * 8 hours/day", "= $240.00/day"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the answer reads back as the same rate", () => {
		for (const line of ["$15 per hour", "£12 per hour", "€20 per day", "$0.30/kWh", "-$15 per hour", "5 SEK per hour", "5 UYU per hour", "$0.001/kWh"]) {
			const written = shown(line).replace(/^= /, "");
			expect({ line, back: shown(written) }).toEqual({ line, back: shown(line) });
		}
	});

	test("a rate that is not money is unchanged", () => {
		expect(shown("60 km / 2 h")).toBe("= 30.00 km/h");
		expect(shown("3 hours / day")).toBe("= 3.00 hours/day");
	});
});

describe("moneyUnitOf", () => {
	test("ordinary: a code, a crypto code and a rate", () => {
		expect(moneyUnitOf("USD")).toEqual({ code: "USD" });
		expect(moneyUnitOf("BTC")).toEqual({ code: "BTC" });
		expect(moneyUnitOf("DOGE")).toEqual({ code: "DOGE" });
		expect(moneyUnitOf("USD/hour")).toEqual({ code: "USD", per: "hour" });
		expect(moneyUnitOf("JPY/kWh")).toEqual({ code: "JPY", per: "kWh" });
	});

	test("boundary: a lower-case spelling, a unit, an empty rate", () => {
		// `cup` is the cooking unit, although `CUP` is the Cuban peso.
		expect(moneyUnitOf("cup")).toBeUndefined();
		// A code with a symbol is matched in any case, as the display lookup always was.
		expect(moneyUnitOf("usd")).toEqual({ code: "USD" });
		expect(moneyUnitOf("km/h")).toBeUndefined();
		expect(moneyUnitOf("USD/")).toBeUndefined();
		expect(moneyUnitOf("/USD")).toBeUndefined();
		expect(moneyUnitOf("")).toBeUndefined();
		expect(moneyUnitOf("XXX")).toBeUndefined();
		expect(moneyUnitOf("hours/USD")).toBeUndefined();
	});

	test("hostile: inherited names and long text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(moneyUnitOf(word)).toBeUndefined();
				expect(moneyUnitOf(`${word}/hour`)).toBeUndefined();
				expect(moneyUnitOf(`USD/${word}`)).toEqual({ code: "USD", per: word });
			}
			expect(moneyUnitOf("U".repeat(100_000))).toBeUndefined();
		});
	});

	test("a rate over an inherited name formats as text", () => {
		expectPrototypeUntouched(() => {
			expect(formatValue(quantity(15, "USD/constructor"))).toBe("= $15.00/constructor");
			expect(formatValue(quantity(15, "__proto__/hour"))).toBe("= 15.00 __proto__/hour");
		});
	});
});

describe("adversarial", () => {
	test("security: prototype words as the rate's unit, markup-shaped and look-alike text", () => {
		expectPrototypeUntouched(() => {
			for (const line of [...fill("$15 per X", PROTOTYPE_WORDS), ...fill("1 X", PROTOTYPE_WORDS)]) expectHonestLine(line);
		});
		for (const line of fill("$15 per X", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
		expectHonestLine(`$${RESOURCE_PROBES.longSum(2_000)} per hour`, { budgetMs: 5_000 });
	});

	test("realistic: a rate from the line above, a typo, a rate meeting a check", () => {
		const { batch, incremental } = expectHonestDocument("rate = $15 per hour\nrate * 8 hours\n3600 seconds in hours\nprev * 2");
		expect(batch).toEqual(["= $15.00/hour", "= $120.00", "= 1 hour", "= 2 hours"]);
		expect(incremental).toEqual(batch);
		expectHonestLine("$15 per hourz");
		expect(shown("check $15 per hour * 8 hours == $120")).not.toMatch(/fail/i);
	});

	test("realistic: a host that asked for other places, and another locale", () => {
		const settings = { ...DEFAULT_FORMATTING_SETTINGS, unitOfMeasurementResult: { decimalPlaces: 4 } };
		const engine = newTrackedEngine();
		expect(formatValue(engine.evaluateExpression("$15 per hour"), settings)).toBe("= $15.00/hour");
		expect(formatValue(engine.evaluateExpression("$0.30/kWh"), settings)).toBe("= $0.30/kWh");
		expect(formatValue(engine.evaluateExpression("$0.305/kWh"), settings)).toBe("= $0.305/kWh");
		const de = { ...DEFAULT_FORMATTING_SETTINGS, numberResult: { decimalSeparatorLocale: "de-DE" } };
		expect(formatValue(engine.evaluateExpression("$1234.5 per hour"), de)).toBe("= 1.234,50 $/hour");
		expect(formatValue(engine.evaluateExpression("3600 seconds in hours"), de)).toBe("= 1 Stunde");
	});

	test("edge: the numeric edges as a rate and as a count of hours", () => {
		for (const line of [...fill("$X per hour", NUMERIC_EDGES), ...fill("X hours", NUMERIC_EDGES), ...fill("X hour", NUMERIC_EDGES)]) {
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		}
		expect(shown("$0 per hour")).toBe("= $0.00/hour");
		expect(shown("-0 hour")).toBe("= 0 hours");
	});
});
