/**
 * A unit mismatch is a sentence a person can act on, not a bare code.
 *
 * `5 kg + 3 m` and `1 hour in metres` both used to surface the raw
 * `INCOMPATIBLE_UNITS`, which told a reader nothing and was the same string
 * whether they had added mass to length (their mistake) or asked for a
 * conversion the engine cannot do (a different situation). The two are now
 * distinguishable and named:
 *
 *   5 kg + 3 m         mass and length cannot be added
 *   1 hour in metres   a duration cannot be converted to a length
 *
 * The error CODE stays `INCOMPATIBLE_UNITS`, so anything matching on it keeps
 * working; only the human-readable message changed. The dimension is named from
 * the same measure table the converter already uses (`getMeasure`), so a
 * quantity of time reads as a "duration" and a currency as "money".
 *
 * A pair with no single dimension to name (a compound rate such as `km/h`, or a
 * currency code the exchange does not know) keeps the older message that names
 * the units instead, so the sentence never trails off into "undefined". Two
 * currencies with no cached rate are the same measure (money), a missing-rate
 * case rather than a dimension mismatch, and keep their unit-naming message too
 * (see Issue_CryptoCurrencyArithmeticSilentlyWrong.spec.ts).
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type Value } from "@solve-js/vm/Value";

/** One line through a real engine. */
function evaluate(source: string): Value {
	const engine = newTrackedEngine();
	try {
		return engine.evaluateExpression(source);
	} finally {
		engine.clear();
	}
}

/** The message a host renders for the result (the error text for an Error). */
function message(source: string): string {
	return formatValue(evaluate(source));
}

/** The structured error code carried by the result. */
function code(source: string): unknown {
	return evaluate(source).value;
}

describe("combining two dimensions names both, and the operation", () => {
	test.each([
		["5 kg + 3 m", "mass and length cannot be added"],
		["3 m + 5 kg", "length and mass cannot be added"],
		["5 kg - 3 m", "mass and length cannot be subtracted"],
		["5 kg * 3 m", "mass and length cannot be multiplied"],
		["1 hour + 2 kg", "duration and mass cannot be added"],
		["10 m2 + 3 m3", "area and volume cannot be added"],
	])("%j reads as %j", (source, expected) => {
		expect(message(source)).toBe(expected);
	});

	test("money against a physical unit is named as money", () => {
		expect(message("$5 + 3 m")).toBe("money and length cannot be added");
		expect(message("5 kg + $3")).toBe("mass and money cannot be added");
	});
});

describe("a conversion the engine cannot make names the two dimensions", () => {
	test.each([
		["1 hour in metres", "a duration cannot be converted to a length"],
		["5 kg in m", "a mass cannot be converted to a length"],
		["100 m in seconds", "a length cannot be converted to a duration"],
		["1 m3 in m2", "a volume cannot be converted to an area"],
		["10 m2 in m3", "an area cannot be converted to a volume"],
	])("%j reads as %j", (source, expected) => {
		expect(message(source)).toBe(expected);
	});

	test("the uncountable dimensions read without an article", () => {
		// "money" and "data" would read wrong as "a money"; they are used bare.
		expect(message("$100 in kg")).toBe("money cannot be converted to a mass");
		expect(message("5 kg in USD")).toBe("a mass cannot be converted to money");
	});

	test("both spellings of the conversion word take the same message", () => {
		// `to`, `in` and `into` all reach the same refusal.
		expect(message("1 hour to metres")).toBe("a duration cannot be converted to a length");
		expect(message("1 hour into metres")).toBe("a duration cannot be converted to a length");
	});
});

describe("ordering and min/max name the dimensions too", () => {
	test.each([
		["5 kg < 3 m", "mass and length cannot be compared"],
		["5 kg > 3 m", "mass and length cannot be compared"],
		["5 kg <= 3 m", "mass and length cannot be compared"],
		["5 kg >= 3 m", "mass and length cannot be compared"],
	])("%j reads as %j", (source, expected) => {
		expect(message(source)).toBe(expected);
	});

	test("max and min across dimensions read the same way", () => {
		expect(message("max(1 km, 5 kg)")).toBe("length and mass cannot be compared");
		expect(message("min(1 km, 5 kg)")).toBe("length and mass cannot be compared");
	});
});

describe("the error code is unchanged, so matchers keep working", () => {
	test.each([
		"5 kg + 3 m",
		"1 hour in metres",
		"5 kg < 3 m",
		"max(1 km, 5 kg)",
		"$100 in kg",
	])("%j still carries INCOMPATIBLE_UNITS", (source) => {
		expect(evaluate(source).type).toBe(ValueType.Error);
		expect(code(source)).toBe("INCOMPATIBLE_UNITS");
	});
});

describe("what must keep working", () => {
	test("a valid conversion still succeeds", () => {
		expect(evaluate("90 minutes in hours").type).not.toBe(ValueType.Error);
		expect(evaluate("90 minutes in hours").toNumber()).toBeCloseTo(1.5, 6);
		expect(evaluate("5 km to miles").type).not.toBe(ValueType.Error);
	});

	test("same-dimension arithmetic is untouched", () => {
		expect(formatValue(evaluate("1 km + 500 m"))).toBe("= 1.50 km");
		expect(formatValue(evaluate("100cm + 2m"))).toBe("= 300.00 cm");
	});

	test("equality across dimensions stays a boolean, not an error", () => {
		// A kilogram genuinely is not a metre, so `==` can say false and mean it,
		// which is why only the ordering operators refuse (see incomparableUnitsError).
		expect(evaluate("5 kg == 3 m").type).toBe(ValueType.Boolean);
		expect(evaluate("5 kg == 3 m").value).toBe(false);
		expect(evaluate("5 kg != 3 m").value).toBe(true);
	});

	test("min/max within one dimension still returns the winner, with its unit", () => {
		expect(formatValue(evaluate("max(1 km, 500 m)"))).toBe("= 1.00 km");
		expect(formatValue(evaluate("min(1 km, 500 m)"))).toBe("= 500.00 m");
	});
});
