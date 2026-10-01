import { afterEach, describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { rateTargetNormalizerRule, rateTargetNumerator } from "@solve-js/packages/uom/normalizer/RateTargetNormalizerRule";
import { convertRate } from "@solve-js/uom/UomConverter";
import { currencyExchangeService } from "@solve-js/uom/CurrencyExchange";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";

/**
 * Issue #738: the source side of a conversion read a rate written with `per` or
 * with a currency symbol, but the target side did not, so `60 km/h in miles per
 * hour` was refused as "not a length" and `$20/hour in $/day` as "not money":
 * the target was cut at its first unit.
 *
 * A target written `<unit> per <unit>`, `<unit> / <unit>`, `<symbol>/<unit>` or
 * `/<unit>` straight after `in` or `to` is now read as one unit
 * (`uom/normalizer/RateTargetNormalizerRule.ts`). A bare `/<unit>` keeps what a
 * rate counts and changes what it is per, a price per unit converts into
 * another currency through the exchange rate, and until a rate is known that is
 * said as the missing rate it is.
 */

afterEach(() => {
	currencyExchangeService.clearRates();
});

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

/** A token as the lexer writes one. */
function token(type: string, value: string): Token {
	return new LexerToken(type, tokenTypeId(type), value, value, 0, 0, 1, 1);
}

/** The tokens a line normalises to, as `TYPE(value)`. */
function tokens(line: string): string[] {
	return newTrackedEngine().tokenizeForClassification(line).map((t) => `${t.type}(${t.value})`);
}

describe("a rate target reads as the source does", () => {
	test.each([
		["60 km/h in miles per hour", "= 37.28 miles/hour"],
		["60 km/h to miles per hour", "= 37.28 miles/hour"],
		["60 km/h in miles/hour", "= 37.28 miles/hour"],
		["$20/hour in $/day", "= $480.00/day"],
		["$20/hour in $ / day", "= $480.00/day"],
		["$20/hour in dollars per day", "= $480.00/day"],
		["$20 per hour in USD per day", "= $480.00/day"],
		["$20/hour in USD/day", "= $480.00/day"],
		["£12/hour in £/week", "= £2,016.00/week"],
		["100 Mbps in MB per s", "= 12.50 MB/s"],
		["100 Mbps in Mb per min", "= 6,000.00 Mb/min"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the per and slash spellings give the same answer", () => {
		expect(shown("60 km/h in miles per hour")).toBe(shown("60 km/h in miles/hour"));
		expect(shown("$20/hour in $/day")).toBe(shown("$20/hour in USD/day"));
	});

	test("a bare slash keeps what the rate counts and changes what it is per", () => {
		expect(shown("$50/week in /month")).toBe(shown("$50/week in $/month"));
		expect(shown("60 mph in /min")).toBe("= 1.00 mi/min");
		expect(shown("10 Hz in /s")).toBe("= 10.00 /s");
	});

	test("a target naming another currency converts at the rate", () => {
		currencyExchangeService.primeRates("USD", { EUR: 0.9 }, { provider: "test" });
		expect(shown("$20/hour in €/day")).toBe("= €432.00/day");
		expect(shown("$20/hour in EUR per day")).toBe("= €432.00/day");
	});

	test("and says the rate is missing until one is known", () => {
		const reason = newTrackedEngine().evaluateExpression("$20/hour in €/day");
		expect(["CURRENCY_RATE_UNAVAILABLE", "NETWORK_DISABLED"]).toContain(reason.errorCode);
		expect(reason.errorMessage).toContain("USD to EUR");
	});
});

describe("what stays as it was", () => {
	test("in $ on its own is a currency conversion", () => {
		expect(shown("$20 in $")).toBe("= $20.00");
		expect(shown("20 USD in USD")).toBe("= $20.00");
	});

	test("a, each and every after a conversion stay prose", () => {
		expect(shown("100 km in miles a day")).toBe("= 62.14 miles/day");
		expect(shown("10 kg in lb each week")).toBe("= 22.05 lb/week");
	});

	test("the inch before a slash is still the inch", () => {
		expect(shown("5 in/s")).toBe("= 5.00 in/s");
		expect(shown("5 in / s")).toBe("= 5.00 in/s");
	});

	test("a distance into a speed is refused, not made a rate", () => {
		expect(code("5 km in miles per hour")).toBe("INCOMPATIBLE_UNITS");
		expect(code("$100/hour in kg/day")).toBe("INCOMPATIBLE_UNITS");
	});

	test("per in prose that names no unit is left for the parser", () => {
		expect(shown("60 km/h in mph")).toBe("= 37.28 mph");
		// Not a unit after `per`, so nothing is joined and the parser says what it
		// found, as it did before.
		expect(shown("60 km/h in miles per the map")).toBe('THROWS Expected an operator or the end of the line, but found "per"');
	});
});

describe("rateTargetNumerator", () => {
	test("a unit as written, a currency word or symbol as its code", () => {
		expect(rateTargetNumerator(token("UNIT", "miles"))).toBe("miles");
		expect(rateTargetNumerator(token("UNIT", "dollars"))).toBe("USD");
		expect(rateTargetNumerator(token("DOLLAR", "$"))).toBe("USD");
		expect(rateTargetNumerator(token("POUND", "£"))).toBe("GBP");
		expect(rateTargetNumerator(token("EURO", "€"))).toBe("EUR");
	});

	test("anything else is not a numerator", () => {
		expect(rateTargetNumerator(undefined)).toBeUndefined();
		expect(rateTargetNumerator(token("IDENT", "per"))).toBeUndefined();
		expect(rateTargetNumerator(token("NUMBER", "5"))).toBeUndefined();
		expect(rateTargetNumerator(token("UNIT", ""))).toBeUndefined();
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(rateTargetNumerator(token("IDENT", word))).toBeUndefined();
		});
	});
});

describe("rateTargetNormalizerRule", () => {
	const rule = rateTargetNormalizerRule();
	const run = (list: Token[], pos = 0) => rule.match(list, pos);

	test("fuses a unit per a unit, a symbol over a unit, and a bare slash", () => {
		expect(run([token("IN", "in"), token("UNIT", "miles"), token("IDENT", "per"), token("UNIT", "hour")])?.replacement.map((t) => t.value)).toEqual(["in", "miles/hour"]);
		expect(run([token("TO", "to"), token("DOLLAR", "$"), token("SLASH", "/"), token("UNIT", "day")])?.replacement.map((t) => t.value)).toEqual(["to", "USD/day"]);
		expect(run([token("IN", "in"), token("SLASH", "/"), token("UNIT", "min")])?.replacement.map((t) => t.value)).toEqual(["in", "/min"]);
	});

	test("declines every other shape", () => {
		expect(run([token("IN", "in"), token("UNIT", "miles")])).toBeNull();
		expect(run([token("IN", "in"), token("DOLLAR", "$")])).toBeNull();
		expect(run([token("IN", "in"), token("UNIT", "miles"), token("IDENT", "a"), token("UNIT", "day")])).toBeNull();
		expect(run([token("IN", "in"), token("UNIT", "miles"), token("IDENT", "per"), token("IDENT", "constructor")])).toBeNull();
		expect(run([token("NUMBER", "5"), token("IN", "in"), token("SLASH", "/"), token("UNIT", "s")], 1)).toBeNull();
		expect(run([token("UNIT", "km"), token("SLASH", "/"), token("UNIT", "h")])).toBeNull();
		expect(run([])).toBeNull();
	});

	test("the whole pipeline reads one target token", () => {
		expect(tokens("60 km/h in miles per hour")).toEqual(["NUMBER(60)", "UNIT(km/h)", "IN(in)", "UNIT(miles/hour)"]);
		expect(tokens("$20/hour in $/day").slice(-2)).toEqual(["IN(in)", "UNIT(USD/day)"]);
	});
});

describe("convertRate across currencies", () => {
	test("through the cached rate, and null without one", () => {
		expect(convertRate(20, "USD/hour", "EUR/hour")).toBeNull();
		currencyExchangeService.primeRates("USD", { EUR: 0.9 }, { provider: "test" });
		expect(convertRate(20, "USD/hour", "EUR/day")).toBeCloseTo(432, 9);
		expect(convertRate(20, "USD/hour", "kg/hour")).toBeNull();
	});
});

describe("adversarial: security", () => {
	test.each([
		...fill("60 km/h in miles per X", PROTOTYPE_WORDS),
		...fill("$20/hour in $/X", PROTOTYPE_WORDS),
		...fill("$20/hour in X per day", PROTOTYPE_WORDS),
		...fill("10 Hz in /X", PROTOTYPE_WORDS),
	])("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a long chain of targets stays within its budget", () => {
		const chain = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? "in miles per hour" : "in km per hour")).join(" ");
		expectHonestLine(`60 km/h ${chain}`, { budgetMs: 2_000 });
	});

	test("look-alike and markup-shaped text is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`60 km/h in miles per hour ${edge}`);
		expectHonestLine("60 km/h in miles per <b>hour</b>");
		expectHonestLine("60 km/h in miles pe​r hour");
		expectHonestLine("$20/hour in $‮/day");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a value from the line above, a check over it, and both document passes", () => {
		const { batch } = expectHonestDocument("pay = $20/hour\npay in $/day\ncheck pay in $/day == $480/day\nspeed = 60 km/h\nspeed in miles per hour");
		expect(batch).toEqual(["= $20.00/hour", "= $480.00/day", "= ✓", "= 60.00 km/h", "= 37.28 miles/hour"]);
	});

	test("a unit that does not fit, and a typo", () => {
		expect(code("60 km/h in miles per kg")).toBe("INCOMPATIBLE_UNITS");
		expect(shown("60 km/h in mies per hour")).toBe('"mies" is not a unit. Did you mean miles or mins?');
	});
});

describe("adversarial: edge cases", () => {
	test.each([...fill("X km/h in miles per hour", NUMERIC_EDGES), ...fill("$X/hour in $/day", NUMERIC_EDGES)])("%s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("zero and a negative", () => {
		expect(shown("0 km/h in miles per hour")).toBe("= 0.00 miles/hour");
		expect(shown("-$20/hour in $/day")).toBe("= -$480.00/day");
	});
});
