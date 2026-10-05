import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatMsDuration, formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { fixedDecimalText, nonFiniteText, numberText, shortestText } from "@solve-js/utilities/Number";
import { formatRational, rational, rationalToNumber } from "@solve-js/symbolic";
import { compactString, engineeringString } from "@solve-js/packages/converters/NumberNotation";
import { timecodeText } from "@solve-js/packages/time/timecode/TimecodeMath";
import { toTimespanString } from "@solve-js/packages/time/TimespanConverters";
import { uomValue } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `∞ km` answered `Infinity km`, JavaScript's own word for an
 * infinity, which a note cannot read back (the engine reads `∞`). A plain
 * infinity has always been written `∞`, because `Intl` writes it that way, but
 * a quantity and an amount of money are written through `fixedDecimalText`,
 * which is `toFixed`, and `toFixed` writes `Infinity`. So `1e308 * 10 km`,
 * `-∞ m`, `∞ km in m`, `5 km / 0` and `$1e308 * 10` all showed the word. It
 * reached messages too, by way of `${value}`: `sin(Infinity) has no real
 * value`, `Infinity mod 3`, `Year Infinity is outside the bundled UK price
 * index's range`, and the converters `as sci`, `as fraction`, `as compact`,
 * `as engineering`, `as multiplier`, `as timespan` and a timecode's frame count.
 *
 * An infinity is now written `∞` everywhere a reader sees it (`nonFiniteText`,
 * `numberText`). `200 + 1e308%` answering `∞` is not part of the bug: adding a
 * percentage multiplies, and a product past about 1.8e308 is held as an
 * infinity, as `2^1024` is; that is the engine's deliberate answer, written
 * its own way.
 *
 * While there: a solved formula whose exact value has a numerator past the
 * largest double was converted as `Infinity` over its denominator, so
 * `x*π = 1e308`, `x =>` answered an infinity for 3.18e307 (`rationalToNumber`).
 */

/** A line's answer, or `THROWS <message>`. */
function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** A document line's answer, or `THREW: <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "THREW: no line";
	if (line.error) return `THREW: ${line.error}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

/** Each line of a document, through both passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

describe("the lines that exposed it", () => {
	test.each([
		["∞ km", "∞ km"],
		["-∞ m", "-∞ m"],
		["∞ km in m", "∞ m"],
		["1e308 * 10 km", "∞ km"],
		["1e308 km * 10", "∞ km"],
		["1e308 km + 1e308 km", "∞ km"],
		["-(1e308 km) * 10", "-∞ km"],
		["5 km / 0", "∞ km"],
		["-5 km / 0", "-∞ km"],
		["2^1024 km", "∞ km"],
		["1e308 km * 1e308 km", "∞ km²"],
		["∞ days", "∞ days"],
		["∞ hours + 1 day", "∞ hours"],
		["∞ kg to 2 dp", "∞ kg"],
		["[∞ km]", "[∞ km]"],
		["$1e308 * 10", "$∞"],
		["∞ USD", "$∞"],
		["-$∞", "-$∞"],
		["∞ EUR", "€∞"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("an overflow by a percentage is the infinity 2^1024 is, written the engine's way", () => {
		expect(shown("200 + 1e308%")).toBe("∞");
		expect(shown("200 + 1e308%")).toBe(shown("2^1024"));
		expect(shown("1e308 + 1e308")).toBe("∞");
	});

	test.each([
		["1 / 0 as sci", "∞"],
		["-1 / 0 as sci", "-∞"],
		["∞ as fraction", "∞"],
		["(1/0) as compact", "∞"],
		["(-1/0) as engineering", "-∞"],
		["$(1/0)/hour as compact", "$∞/hour"],
		["1e308 as multiplier", "1e+308x"],
		["(1/0) seconds as timespan", "∞ seconds"],
		["(01:02:03:04 at 30 fps) / 0", "∞ frames at 30 fps"],
		["(9:30 - 8:30) + (1/0) minutes", "∞"],
	])("the converter %s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test.each([
		["sin(1/0)", "sin(∞) has no real value: sin is only defined for finite angles."],
		["(1/0) mod 3", "∞ mod 3 has no value: an infinite number has no remainder."],
		["(1/0) choose 2", "combination counts whole things: ∞ is not a whole number."],
		["fact(1/0)", "A factorial is only defined for a whole number of zero or more, and ∞ is not one."],
		["sum((1/0):3)", "A range's bounds must be whole numbers, got \"∞:3\"."],
		["∞ as words", "∞ cannot be written as words"],
		["binompdf(10, 0.5, 1/0)", "binompdf: the number of successes must be a whole number, but was ∞"],
		["fuel for 300 miles at (1/0) UK mpg", "∞ UK mpg is not an economy a trip can be worked out from"],
	])("the message for %s names ∞", (line, message) => {
		expect(shown(line)).toBe(message);
	});

	test("an inflation year that is no finite number is refused as a year, in plain words", () => {
		// The year is read as a plain whole number before any index is consulted
		// (FoundBug_inflationYear.spec.ts), so the refusal says what the year is.
		expect(shown("inflationAdjust(£100, 1/0, 2020)")).toBe("the year of an inflation question is a plain whole number, such as 1990, and this one is not a finite number");
	});

	test("a column total, a total above and a solved formula that overflow, through both passes", () => {
		const big = `1${"0".repeat(308)}`;
		expect(both(["| cost |", "| --- |", `| ${big} |`, `| ${big} |`, "", "sum of column \"cost\""])[5]).toBe("∞");
		expect(both(["1e308 km", "1e308 km", "total above"])[2]).toBe("∞ km");
		expect(both(["salary = 1e-320", "net = 1000", "(salary / 12) * rate / 100 = net", "rate =>"])[3]).toBe("∞");
	});

	test("a solved formula whose value is past a double's numerator is its finite value", () => {
		const [, x] = both(["x*π = 1e308", "x =>"]);
		expect(x.startsWith("31,830,988,618,379,07")).toBe(true);
	});

	test("on its own, through the single-line entry point", () => {
		expect(formatValue(newTrackedEngine().evaluateLine(1, "∞ km in m"))).toBe("= ∞ m");
	});
});

describe("the parts: nonFiniteText and numberText", () => {
	test("ordinary: the two infinities and NaN", () => {
		expect(nonFiniteText(Number.POSITIVE_INFINITY)).toBe("∞");
		expect(nonFiniteText(Number.NEGATIVE_INFINITY)).toBe("-∞");
		expect(nonFiniteText(Number.NaN)).toBe("NaN");
		expect(numberText(Number.POSITIVE_INFINITY)).toBe("∞");
		expect(numberText(Number.NEGATIVE_INFINITY)).toBe("-∞");
	});

	test("boundary: a finite number is not theirs to write, at every edge", () => {
		for (const n of [0, -0, 1, -1, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 2 ** 53, 1e21, 0.1 + 0.2]) {
			expect(nonFiniteText(n)).toBeUndefined();
			expect(numberText(n)).toBe(String(n));
		}
	});

	test("hostile: a value that is not a number type is never written as Infinity", () => {
		// What a message builds from `Number(...)` of unexpected input.
		expect(numberText(Number("Infinity"))).toBe("∞");
		expect(numberText(Number("nonsense"))).toBe("NaN");
		expect(numberText(Number.MAX_VALUE * 2)).toBe("∞");
	});
});

describe("the parts: fixedDecimalText and shortestText", () => {
	test("ordinary: an infinity is the engine's glyph", () => {
		expect(fixedDecimalText(Number.POSITIVE_INFINITY, 2)).toBe("∞");
		expect(fixedDecimalText(Number.NEGATIVE_INFINITY, 0)).toBe("-∞");
		expect(shortestText(Number.NEGATIVE_INFINITY)).toBe("-∞");
	});

	test("boundary: the largest double is written in full, not as an infinity", () => {
		expect(fixedDecimalText(Number.MAX_VALUE, 0)).toMatch(/^17976931348623157\d+$/);
		expect(shortestText(Number.MAX_VALUE)).not.toContain("∞");
		expect(fixedDecimalText(-0, 2)).toBe("0.00");
	});

	test("hostile: NaN and a hundred places of an infinity", () => {
		expect(fixedDecimalText(Number.NaN, 2)).toBe("NaN");
		expect(fixedDecimalText(Number.POSITIVE_INFINITY, 100)).toBe("∞");
	});
});

describe("the parts: formatMsDuration, timecodeText, toTimespanString", () => {
	test("ordinary: a finite span reads as a clock", () => {
		expect(formatMsDuration(3_600_000)).toBe("1:00");
		expect(timecodeText(30, 30)).toBe("00:00:01:00 at 30 fps");
		expect(formatValue(toTimespanString(uomValue(90, "s")))).toBe("= 1 minute 30 seconds");
	});

	test("boundary: an infinite span is the glyph, signed", () => {
		expect(formatMsDuration(Number.POSITIVE_INFINITY)).toBe("∞");
		expect(formatMsDuration(Number.NEGATIVE_INFINITY)).toBe("-∞");
		expect(timecodeText(Number.NEGATIVE_INFINITY, 25)).toBe("-∞ frames at 25 fps");
		expect(formatValue(toTimespanString(uomValue(Number.NEGATIVE_INFINITY, "s")))).toBe("= -∞ seconds");
	});

	test("hostile: NaN reads as NaN, never as a clock of NaNs", () => {
		expect(formatMsDuration(Number.NaN)).toBe("NaN");
		expect(timecodeText(Number.NaN, 30)).toBe("NaN frames at 30 fps");
	});
});

describe("the parts: engineeringString and compactString", () => {
	test("ordinary and boundary", () => {
		expect(engineeringString(12_345)).toBe("12.345e+3");
		expect(compactString(3_300_000)).toBe("3.3M");
		expect(engineeringString(Number.MAX_VALUE)).not.toContain("Infinity");
	});

	test("hostile: the infinities", () => {
		expect(engineeringString(Number.POSITIVE_INFINITY)).toBe("∞");
		expect(compactString(Number.NEGATIVE_INFINITY)).toBe("-∞");
	});
});

/** Ten to the power `n`, as a bigint (the spec's compile target has no bigint `**`). */
const tenTo = (n: number): bigint => BigInt(`1${"0".repeat(n)}`);

describe("the parts: rationalToNumber and formatRational", () => {
	const big = tenTo(400);

	test("ordinary: an ordinary fraction is its quotient", () => {
		expect(rationalToNumber(rational(1n, 3n))).toBe(1 / 3);
		expect(rationalToNumber(rational(-7n, 2n))).toBe(-3.5);
	});

	test("boundary: a numerator or a denominator past a double, the ratio inside one", () => {
		// 10^323 / 3141592653589793, about 3.18e307.
		const pi = rational(tenTo(323), 3141592653589793n);
		expect(rationalToNumber(pi) / (1e308 / 3.141592653589793)).toBeCloseTo(1, 12);
		expect(Number.isFinite(rationalToNumber(pi))).toBe(true);
		expect(rationalToNumber(rational(3n, big))).toBe(0);
		expect(rationalToNumber(rational(big + 1n, big))).toBe(1);
		expect(rationalToNumber(rational(-(big * 3n), big * 2n + 1n))).toBeCloseTo(-1.5, 12);
		expect(rationalToNumber(rational(big, 7n))).toBe(Number.POSITIVE_INFINITY);
		expect(rationalToNumber(rational(-big, 7n))).toBe(Number.NEGATIVE_INFINITY);
	});

	test("hostile: a thousand digits each way, near the exact-fraction ceiling, are converted in time", () => {
		const huge = tenTo(1_000);
		const started = performance.now();
		expect(rationalToNumber(rational(huge * 5n + 1n, huge * 2n))).toBeCloseTo(2.5, 12);
		expect(performance.now() - started).toBeLessThan(2_000);
	});

	test("formatRational writes a fraction past a double as ∞ and one near the edge without overflowing", () => {
		expect(formatRational(rational(big, 7n))).toBe("∞");
		expect(formatRational(rational(-big, 7n))).toBe("-∞");
		const nearEdge = formatRational(rational(tenTo(300) + 1n, 3n));
		expect(nearEdge).not.toMatch(/Infinity|∞/);
		expect(Number(nearEdge)).toBeCloseTo(1e300 / 3, -290);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`∞ ${word}`, `1e308 * 10 ${word}`, `∞ km in ${word}`, `${word} * ∞`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a look-alike of the glyph is not an infinity", () => {
		// The infinity emoji, and the glyph in full-width brackets.
		expectHonestLine("♾ km");
		expect(shown("♾ km")).not.toBe("∞ km");
	});

	test("a long sum of infinities and a long chain of overflows are answered in time", () => {
		expectHonestLine(Array.from({ length: 500 }, () => "∞ km").join(" + "), { budgetMs: 5_000 });
		expectHonestLine(`1e308 km${" * 10".repeat(500)}`, { budgetMs: 5_000 });
	});

	test.each(fill("∞ km X", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after an infinite quantity: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text around an infinite quantity is read as text", () => {
		expectHonestLine("<b>∞ km</b>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("an infinite quantity from the line above, converted, checked and summed", () => {
		expect(both(["d = 5 km / 0", "d in m", "d + 1 km"])).toEqual(["∞ km", "∞ m", "∞ km"]);
		// ∞ times zero is NaN, the floating-point standard's answer, documented on the operators page.
		expectHonestDocument("d = 5 km / 0\ncheck d > 1 km\nd * 0", { allowNaN: true });
	});

	test("a unit that does not fit an infinity is refused as it is for a number", () => {
		expect(shown("∞ km in kg")).toBe(shown("5 km in kg"));
		expect(shown("∞ km in kg")).not.toMatch(/Infinity/);
	});

	test("a what-if that makes a quantity overflow", () => {
		const { batch } = expectHonestDocument("a = 1\nb = a * 1e308 * 10 km\nline 2 with a = 2");
		expect(batch.join(" ")).not.toContain("Infinity");
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("(X) * 1e308 * 10 km", NUMERIC_EDGES))("a numeric edge pushed past the largest double, with a unit: %s", (line) => {
		expectHonestLine(line, { allowNaN: true });
	});

	test.each(fill("$(X) * 1e308 * 10", NUMERIC_EDGES))("a numeric edge pushed past the largest double, as money: %s", (line) => {
		expectHonestLine(line, { allowNaN: true });
	});

	test("the largest double with a unit is written in full, and one step past it is ∞", () => {
		expect(shown(`${Number.MAX_VALUE} km`)).toMatch(/^179,769,313,486,231,57\d/);
		expect(shown(`${Number.MAX_VALUE} km * 2`)).toBe("∞ km");
	});

	test("zero, negative zero and the smallest double over zero", () => {
		expect(shown("0 km / 0")).toMatch(/0 divided by 0 has no single answer/);
		expect(shown("-0 km * ∞")).not.toMatch(/Infinity/);
		expect(shown(`${Number.MIN_VALUE} km / 0`)).toBe("∞ km");
	});
});
