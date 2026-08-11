/**
 * What the unit system does when it cannot do what was asked.
 *
 * The project's stated position is that a wrong answer is worse than a missing
 * feature, and the currency table's own history is the reference case: `$100 in
 * UAH` returned an unconverted hundred dollars, which reads as a successful
 * conversion at a rate of one. Widening the currency table removed the common
 * case but not the failure mode, and the failure mode is not confined to
 * currency: it is the last `else` of `UOM_CONVERT_TO` and `UOM_CONVERT_IN` in
 * `vm/VM.ts`, which pushes the input back when the two units share no measure.
 *
 * This file walks that failure mode across the whole unit system, and then
 * three other places where the answer comes back plausible and wrong: negative
 * temperatures, ordered comparison, and multiplying two quantities together.
 *
 * Where behaviour is wrong, the correct expectation is written as
 * `test.failing` rather than the current value being pinned. Deleting the
 * `.failing` is what a fix looks like.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import type { Value } from "@solve-js/vm/Value";

/** One line through a real engine. */
function evaluate(source: string): Value {
	const engine = newTrackedEngine("en");
	try {
		return engine.evaluateExpression(source)[0];
	} finally {
		engine.clear();
	}
}

/** The formatted result, with the leading "= " stripped, as a reader would see it. */
function display(source: string): string {
	return formatValue(evaluate(source)).replace(/^=\s*/, "");
}

describe("a conversion between different measures", () => {
	/**
	 * Pairs that share no measure, one per crossing worth naming. Every one of
	 * these is a question with no answer, so every one of them has to say so.
	 */
	const IMPOSSIBLE = [
		["5 kg", "m"],
		["5 kg", "seconds"],
		["1 hour", "kg"],
		["1 GB", "m"],
		["1 Hz", "s"],
		["1 rad", "m"],
		["1 cd", "lux"],
		["1 l", "kg"],
		["1 m2", "m"],
		["1 m3", "m2"],
		["1 W", "kWh"],
	] as const;

	test("says so rather than handing back the input", () => {
		// Was a bug: every one of these returned the left operand unchanged,
		// under its original unit, which is indistinguishable from a conversion
		// that succeeded at a rate of one. `1 m3 in m2` reporting "1.00 m3" was
		// the same failure that made `$100 in UAH` report "$100.00".
		for (const [quantity, target] of IMPOSSIBLE) {
			const value = evaluate(`${quantity} in ${target}`);
			expect(value.type).toBe(ValueType.Error);
		}
	});

	test("through `to` and through `convert` as well", () => {
		// The three spellings of a conversion all reach the same two opcodes, so
		// all three used to return the input and all three refuse now.
		expect(evaluate("5 kg to m").type).toBe(ValueType.Error);
		expect(evaluate("convert 5 kg to m").type).toBe(ValueType.Error);
		expect(evaluate("5 kg in m").type).toBe(ValueType.Error);
	});

	test("the arithmetic layer, by contrast, already refuses", () => {
		// The same crossing under `+` or `*` produces an Error, which is what
		// makes the conversion path's silence a bug rather than a house style.
		// `binaryOp` in vm/VMConversion.ts states the reasoning: silently
		// combining raw magnitudes produced "a confidently-wrong, unitless
		// number".
		expect(evaluate("10 m + 5 kg").type).toBe(ValueType.Error);
		expect(evaluate("10 m * 5 kg").type).toBe(ValueType.Error);
		expect(evaluate("$100 + 5 kg").type).toBe(ValueType.Error);
	});

	test("a conversion that is possible still works, so this is not a blanket refusal", () => {
		expect(display("5 kg in lbs")).toBe("11.02 lbs");
		expect(display("1 m3 in l")).toBe("1000.00 l");
		expect(display("1 hour in min")).toBe("60.00 min");
	});
});

describe("a negative quantity on an offset scale", () => {
	test("the conversion arithmetic itself is right", () => {
		// Establishes that the defect below is not in the tables. Minus forty is
		// the crossing point of the two scales, and minus 273.15 celsius is
		// absolute zero, so both of these are exact by definition.
		expect(convertUnit(-40, "C", "F")).toBeCloseTo(-40, 9);
		expect(convertUnit(-10, "C", "F")).toBeCloseTo(14, 9);
		expect(convertUnit(-273.15, "C", "K")).toBeCloseTo(0, 9);
		expect(convertUnit(-40, "K", "C")).toBeCloseTo(-313.15, 9);
	});

	// BUG. The unary minus binds looser than the conversion, so the engine
	// evaluates -(40 C in F) and reports minus a hundred and four. The sign is
	// applied to the converted number instead of to the input.
	//
	// Invisible on every ratio-only measure, because negating before or after
	// a multiplication is the same thing. Only the offset scales expose it,
	// and on those it is not a rounding difference: `-40 K in C` comes back
	// positive.
	//
	// One assertion per case, because a `test.failing` stops at its first
	// failing assertion and the ones after it never run: any of these four
	// starting to answer differently, right or wrong, would otherwise be
	// invisible. `UnitsCurrencyAndRates.spec.ts`'s header has the full account
	// of the regression that shape hid.
	for (const [source, expected] of [
		["-40 C in F", -40],
		["-10 C in F", 14],
		["-273.15 C in K", 0],
		["-40 K in C", -313.15],
	] as const) {
		test.failing(`survives being written with a minus sign in front of it: ${source}`, () => {
			expect(evaluate(source).toNumber()).toBeCloseTo(expected, 6);
		});
	}

	test.failing("and written with the words rather than the symbols", () => {
		// BUG, same cause. Worth its own case because the word forms take a
		// different route through the parser.
		expect(evaluate("-40 celsius in fahrenheit").toNumber()).toBeCloseTo(-40, 6);
	});

	test("parenthesising gives the right answer, which locates the fault exactly", () => {
		// The quantity itself is built correctly: `-40 C` is minus forty celsius.
		// Parenthesising either the number or the whole quantity converts it
		// correctly too. Only the unparenthesised form is wrong, so the fault is
		// that the unary minus binds looser than the conversion and is applied to
		// the RESULT: `-40 C in F` evaluates `-(40 C in F)`.
		expect(display("-40 C")).toBe("-40.00 C");
		expect(evaluate("(-40 C) in F").toNumber()).toBeCloseTo(-40, 6);
		expect(evaluate("(-40) C in F").toNumber()).toBeCloseTo(-40, 6);
		expect(evaluate("(0 - 40) C in F").toNumber()).toBeCloseTo(-40, 6);
	});

	test("a ratio-only measure is unaffected either way", () => {
		expect(evaluate("-5 km in m").toNumber()).toBeCloseTo(-5000, 9);
		expect(evaluate("-5 kg in g").toNumber()).toBeCloseTo(-5000, 9);
	});

	test("positive temperatures convert correctly", () => {
		// The fixed points of the two scales, so these are exact.
		expect(evaluate("0 C in F").toNumber()).toBeCloseTo(32, 6);
		expect(evaluate("100 C in F").toNumber()).toBeCloseTo(212, 6);
		expect(evaluate("20 C in F").toNumber()).toBeCloseTo(68, 6);
		expect(evaluate("0 C in K").toNumber()).toBeCloseTo(273.15, 6);
		expect(evaluate("1 rankine in K").toNumber()).toBeCloseTo(5 / 9, 9);
	});
});

describe("comparing two quantities", () => {
	test("takes the units into account", () => {
		// Was a bug: `LT`, `LTE`, `GT` and `GTE` in vm/VM.ts had no Uom branch and
		// fell through to `l.toNumber() OP r.toNumber()`, so they compared the bare
		// magnitudes and ignored the units entirely, while `EQ` and `NEQ`
		// immediately above them called `unifyUom`. All six unify now.
		//
		// A kilometre is not shorter than five hundred metres, half an hour is
		// not longer than an hour, and a kilogram is heavier than a pound.
		expect(evaluate("1 km > 500 m").value).toBe(true);
		expect(evaluate("500 m > 1 km").value).toBe(false);
		expect(evaluate("1 km < 500 m").value).toBe(false);
		expect(evaluate("30 min < 1 hour").value).toBe(true);
		expect(evaluate("1 kg > 1 lb").value).toBe(true);
		expect(evaluate("1 GB > 900 MB").value).toBe(true);
		expect(evaluate("1 kg >= 1000 g").value).toBe(true);
	});

	test("including across temperature scales", () => {
		// Same fix. Twenty celsius is sixty-eight fahrenheit, so it is the
		// warmer of the two.
		expect(evaluate("20 C > 50 F").value).toBe(true);
		expect(evaluate("50 F > 20 C").value).toBe(false);
		expect(evaluate("100 C > 212 F").value).toBe(false);
	});

	test("equality does convert, which is what the others should be doing", () => {
		expect(evaluate("1 km == 1000 m").value).toBe(true);
		expect(evaluate("1 kg == 1000 g").value).toBe(true);
	});

	test("and equality holds at the fixed points of the temperature scales", () => {
		// Was a bug with a different cause from the one above. `unifyUom` converts
		// and `EQ` used to compare the result with `===`. Converting 32 fahrenheit
		// to celsius yields 5.68e-14 rather than zero, because the offset
		// arithmetic is deliberately bit-compatible with the ported original, so
		// no temperature equality could be relied on. `compareUom` in
		// vm/VMConversion.ts now allows a relative tolerance for the rounding a
		// conversion introduces.
		expect(evaluate("0 C == 32 F").value).toBe(true);
		expect(evaluate("100 C == 212 F").value).toBe(true);
	});

	test("max and min pick the larger quantity and keep its unit", () => {
		// Was a bug: both compared raw magnitudes like the ordered operators, and
		// both returned a bare Number, so the unit was lost as well as the answer.
		const longest = evaluate("max(1 km, 500 m)");
		expect(longest.type).toBe(ValueType.Uom);
		expect(convertUnit(longest.toNumber(), longest.unit!, "m")).toBeCloseTo(1000, 9);

		const shortest = evaluate("min(30 min, 1 hour)");
		expect(shortest.type).toBe(ValueType.Uom);
		expect(convertUnit(shortest.toNumber(), shortest.unit!, "min")).toBeCloseTo(30, 9);
	});

	test("comparing two quantities in the same unit is fine", () => {
		// So the damage is confined to pairs that need a conversion.
		expect(evaluate("2 kg > 1 kg").value).toBe(true);
		expect(evaluate("$5 > $3").value).toBe(true);
		expect(evaluate("1000 g > 999 g").value).toBe(true);
	});
});

describe("multiplying two quantities together", () => {
	/*
	 * BUG, one cause, five cases. `binaryOp` unifies the two operands into a
	 * common unit and applies the operator to the magnitudes, so the unit comes
	 * out unchanged: ten metres by ten metres is reported as a hundred metres,
	 * and two by three by four metres as twenty-four metres. An area is not a
	 * length.
	 *
	 * The counterpart division is right, which is the reason to expect better
	 * here: `10 m / 5 m` correctly returns a bare 2.
	 *
	 * One assertion each, for the reason given in `UnitsCurrencyAndRates.spec.ts`'s
	 * header: the measure and the magnitude are two separate claims, and a
	 * `test.failing` that asserts both reports only whichever fails first.
	 *
	 * Splitting them showed that immediately. The type assertion below was the
	 * first line of the `test.failing` this block used to be, and it PASSES: the
	 * product is a quantity, it is just the wrong quantity. So it was never
	 * describing the bug at all, and its only effect inside that test was to
	 * mask the two assertions after it if either of those ever changed.
	 */

	test("of the same measure does produce a quantity, whatever it says it is", () => {
		// The premise of the two cases below rather than a claim about the bug,
		// and it holds both today and after a fix.
		expect(evaluate("10 m * 10 m").type).toBe(ValueType.Uom);
	});

	test.failing("of the same measure raises the dimension", () => {
		const area = evaluate("10 m * 10 m");
		expect(getMeasure(area.unit!)).toBe("area");
	});

	test.failing("and the area it names is the right one", () => {
		const area = evaluate("10 m * 10 m");
		expect(convertUnit(area.toNumber(), area.unit!, "m2")).toBeCloseTo(100, 9);
	});

	test.failing("even when the two are written in different prefixes", () => {
		// The more alarming shape: the answer is not merely mislabelled, it is
		// the product of a metre count and a centimetre count with one of them
		// silently rescaled.
		const area = evaluate("10 m * 3 cm");
		expect(getMeasure(area.unit!)).toBe("area");
	});

	test.failing("and that one names the right area too", () => {
		const area = evaluate("10 m * 3 cm");
		expect(convertUnit(area.toNumber(), area.unit!, "m2")).toBeCloseTo(0.3, 9);
	});

	test.failing("and an explicit target unit is honoured rather than dropped", () => {
		// BUG. `5 m * 4 m in m2` reports "20.00 m". The conversion is not refused,
		// it is discarded, because by the time `in m2` runs the left operand is
		// already a length and the cross-measure branch hands the input back.
		expect(display("5 m * 4 m in m2")).toBe("20.00 m2");
	});

	test("dividing does produce the right kind of answer", () => {
		// Two lengths divide to a bare ratio, and a length over a time makes a
		// rate. Both are the behaviour multiplication is missing.
		expect(evaluate("10 m / 5 m").type).toBe(ValueType.Number);
		expect(evaluate("10 m / 5 m").toNumber()).toBe(2);
		expect(display("10 m / 2 s")).toBe("5.00 m/s");
		expect(display("100 km / 2 h")).toBe("50.00 km/h");
	});

	test("mixing measures under multiplication is already refused", () => {
		// So the engine declines the case it could not compute and accepts the one
		// it computes wrongly.
		expect(evaluate("10 m2 * 2 m").type).toBe(ValueType.Error);
		expect(evaluate("10 m * 5 kg").type).toBe(ValueType.Error);
	});
});

describe("the fluid ounce", () => {
	test("is a volume", () => {
		// Was a bug: `fl` is a lexable spelling of the femtolitre, so "1 fl oz"
		// lexed as one femtolitre followed by `oz` and the pair collapsed to one
		// MASS ounce, turning a recipe's sixteen fluid ounces into sixteen ounces
		// of weight. `uom:multi-word-unit` fuses the pair into the table's own
		// "fl oz" spelling before anything reads `fl` on its own.
		//
		// One US fluid ounce is 29.5735295625 mL by definition.
		const value = evaluate("1 fl oz");
		expect(getMeasure(value.unit!)).toBe("volume");
		expect(convertUnit(value.toNumber(), value.unit!, "ml")).toBeCloseTo(29.5735295625, 9);
	});

	test("and a cup is eight of them", () => {
		// The same cause with the arithmetic made visible: the conversion ran
		// against the femtolitre and the result was then relabelled, so this
		// used to report 236,588,236,500,000 oz.
		expect(evaluate("1 cup in fl oz").toNumber()).toBeCloseTo(8, 6);
	});

	test("the unabbreviated spellings are unaffected", () => {
		// The table's own multi-word entry is correct, so this is a lexing
		// collision rather than a wrong ratio.
		expect(convertUnit(1, "fl oz", "ml")).toBeCloseTo(29.5735295625, 9);
		expect(convertUnit(1, "cup", "fl oz")).toBeCloseTo(8, 9);
		expect(display("1 cup in ml")).toBe("236.59 ml");
	});
});

describe("what the conversion system gets right", () => {
	test("the defining relationships of the imperial and US units", () => {
		// Checked against the definitions rather than against a decimal someone
		// typed, so a transcription slip cannot satisfy them.
		expect(convertUnit(1, "acre", "ft2")).toBeCloseTo(43_560, 6);
		expect(convertUnit(1, "lb", "oz")).toBeCloseTo(16, 9);
		expect(convertUnit(1, "st", "lb")).toBeCloseTo(14, 9);
		expect(convertUnit(1, "gal", "l")).toBeCloseTo(3.785411784, 9);
		expect(convertUnit(1, "tbsp", "tsp")).toBeCloseTo(3, 9);
		expect(convertUnit(1, "mi", "km")).toBeCloseTo(1.609344, 9);
		expect(convertUnit(1, "nmi", "m")).toBe(1852);
		expect(convertUnit(1, "ft", "in")).toBeCloseTo(12, 9);
	});

	test("the binary and decimal data prefixes stay apart", () => {
		expect(convertUnit(1, "GiB", "B")).toBe(1_073_741_824);
		expect(convertUnit(1, "GB", "B")).toBe(1_000_000_000);
		expect(convertUnit(1, "KiB", "B")).toBe(1024);
		expect(convertUnit(1, "kB", "B")).toBe(1000);
	});

	test("the physical constants the pressure and power tables encode", () => {
		expect(convertUnit(1, "atm", "Pa")).toBeCloseTo(101_325, 3);
		expect(convertUnit(1, "bar", "Pa")).toBe(100_000);
		expect(convertUnit(1, "atm", "psi")).toBeCloseTo(14.6959, 4);
		expect(convertUnit(1, "hp", "W")).toBeCloseTo(745.6998, 3);
		expect(convertUnit(1, "kWh", "Wh")).toBeCloseTo(1000, 9);
	});

	test("adding two quantities of the same measure converts before adding", () => {
		expect(display("10 m + 5 cm")).toBe("10.05 m");
		expect(display("1 km + 500 m")).toBe("1.50 km");
		expect(display("1 hour 30 min")).toBe("90.00 min");
		expect(display("3 lb 4 oz")).toBe("52.00 oz");
	});

	test("a percentage scales a quantity and keeps its unit", () => {
		expect(display("10 kg + 10%")).toBe("11.00 kg");
		expect(display("50% of 10 kg")).toBe("5.00 kg");
	});
});
