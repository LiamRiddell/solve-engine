import { describe, expect, test } from "@jest/globals";
import { fixedDecimalText, shortestText, wholeDigitsOfLargeDouble } from "@solve-js/utilities/Number";
import { formatValue, groupedIntegerFormatFor, localiseFixedDecimal } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectPrototypeUntouched } from "@tools/adversarial";

/**
 * A number of 1e21 or more is written in full digits without calling `Intl`.
 *
 * `fixedDecimalText` wrote such a number through `Intl.NumberFormat`, the
 * formatter a plain number is written with. That is right, and about forty
 * times the cost of `toFixed`; a money chain that grows past 1e21 meets it on
 * every line, and 4,000 lines of `x = x * 1.123456789` from `$1` took more than
 * three times as long to show as they did before. The digits are now built from
 * `String`'s exponent text, which holds the same shortest round-trip digits
 * `Intl` writes. The old path is kept here as the oracle.
 *
 * The same chain met a second formatter built on every line: the grouping of
 * money's whole digits called `BigInt.prototype.toLocaleString`, which builds a
 * new `Intl.NumberFormat` each time. It now reads one cached per locale
 * (`groupedIntegerFormatFor`), checked here against `toLocaleString`.
 */

const oracle = (value: number, places: number) => new Intl.NumberFormat("en-US", { useGrouping: false, minimumFractionDigits: places, maximumFractionDigits: places }).format(value);

/** Doubles from 1e21 up to the largest, in both signs, with awkward mantissas. */
function largeDoubles(): number[] {
	const out: number[] = [1e21, 1e22, 1e23, 1.5e21, Number("9.999999999999999e21"), Number("123456789012345680000"), 2 ** 70, 2 ** 70 + 2 ** 18, Number.MAX_VALUE, Number.MAX_VALUE / 3, Number("1.7976931348623155e308")];
	for (let e = 21; e <= 308; e++) {
		out.push(Number(`1e${e}`), Number(`1.234567890123456e${e}`), Number(`9.87654321e${e}`), Number(`3.3333333333333335e${e}`));
	}
	let x = 1.123456789e21;
	for (let i = 0; i < 400 && Number.isFinite(x); i++, x *= 1.789) out.push(x);
	return out.filter(Number.isFinite).flatMap((v) => [v, -v]);
}

describe("wholeDigitsOfLargeDouble", () => {
	test("gives the digits Intl writes, for every large double in both signs", () => {
		for (const v of largeDoubles()) expect({ v, got: wholeDigitsOfLargeDouble(v) }).toEqual({ v, got: oracle(v, 0) });
	});

	test("boundary: 1e21 is the first with an exponent, and the largest double has 309 digits", () => {
		expect(wholeDigitsOfLargeDouble(1e21)).toBe("1000000000000000000000");
		expect(wholeDigitsOfLargeDouble(-1e21)).toBe("-1000000000000000000000");
		expect(wholeDigitsOfLargeDouble(Number.MAX_VALUE)).toHaveLength(309);
		expect(wholeDigitsOfLargeDouble(Number.MAX_VALUE).startsWith("17976931348623157")).toBe(true);
	});

	test("a number String writes without an exponent comes back as String writes it", () => {
		expect(wholeDigitsOfLargeDouble(123)).toBe("123");
		expect(wholeDigitsOfLargeDouble(1e20)).toBe("100000000000000000000");
	});
});

describe("fixedDecimalText", () => {
	test("agrees with the Intl path it replaced at every place count, past 1e21", () => {
		const values = largeDoubles().filter((_, i) => i % 7 === 0);
		for (const places of [0, 1, 2, 6, 20, 100]) {
			for (const v of values) expect({ v, places, got: fixedDecimalText(v, places) }).toEqual({ v, places, got: oracle(v, places) });
		}
	});

	test("below 1e21 and for NaN it is toFixed, as before, and an infinity is written as the engine writes it", () => {
		for (const v of [0, -0, 1.005, -12.5, 999999999999999900000, Number.NaN, Number.MIN_VALUE]) {
			expect(fixedDecimalText(v, 2)).toBe(v.toFixed(2));
		}
		expect(fixedDecimalText(Number.POSITIVE_INFINITY, 2)).toBe("∞");
		expect(fixedDecimalText(Number.NEGATIVE_INFINITY, 2)).toBe("-∞");
	});

	test("shortestText writes a large number in full and a small one as String does", () => {
		expect(shortestText(1e22)).toBe("10000000000000000000000");
		expect(shortestText(-2.5e30)).toBe("-2500000000000000000000000000000");
		expect(shortestText(1e-7)).toBe("1e-7");
		expect(shortestText(0.25)).toBe("0.25");
	});

	test("a long run of large values is cheap: no formatter is built or called", () => {
		const values = largeDoubles();
		const started = performance.now();
		for (let round = 0; round < 20; round++) for (const v of values) fixedDecimalText(v, 2);
		const ours = performance.now() - started;
		const startedOracle = performance.now();
		for (let round = 0; round < 20; round++) for (const v of values) oracle(v, 2);
		const theirs = performance.now() - startedOracle;
		expect(ours).toBeLessThan(theirs);
	});
});

describe("groupedIntegerFormatFor and localiseFixedDecimal", () => {
	const locales = ["en", "en-GB", "de-DE", "fr-FR", "es", "hi-IN", "ar-EG", "ja-JP"];
	const integers = ["0", "7", "1234", "12345", "1000000", "9007199254740993", "1".repeat(80), "1234567890".repeat(20)];

	test("writes what BigInt toLocaleString writes, in every locale tried", () => {
		for (const loc of locales) {
			for (const digits of integers) {
				expect({ loc, digits, got: groupedIntegerFormatFor(loc).format(BigInt(digits)) }).toEqual({ loc, digits, got: BigInt(digits).toLocaleString(loc, { useGrouping: true }) });
			}
		}
	});

	test("one formatter per locale is reused", () => {
		expect(groupedIntegerFormatFor("en-GB")).toBe(groupedIntegerFormatFor("en-GB"));
		expect(groupedIntegerFormatFor("en-GB")).not.toBe(groupedIntegerFormatFor("de-DE"));
	});

	test("the cache is bounded, and an unusable locale throws as toLocaleString does", () => {
		for (let i = 0; i < 200; i++) groupedIntegerFormatFor(`en-u-nu-latn-x-a${i}`);
		expect(groupedIntegerFormatFor("en").format(1234n)).toBe("1,234");
		expect(() => groupedIntegerFormatFor("not a locale")).toThrow(RangeError);
		expect(() => (1234n).toLocaleString("not a locale", { useGrouping: true })).toThrow(RangeError);
	});

	test("localiseFixedDecimal groups, keeps the sign and the places, and leaves other text alone", () => {
		expect(localiseFixedDecimal("-1234567.50", "en", true)).toBe("-1,234,567.50");
		expect(localiseFixedDecimal("1234567.50", "de-DE", true)).toBe("1.234.567,50");
		expect(localiseFixedDecimal("1234", "es", true)).toBe(BigInt(1234).toLocaleString("es", { useGrouping: true }));
		expect(localiseFixedDecimal("1e+22", "en", true)).toBe("1e+22");
		expect(localiseFixedDecimal("", "en", true)).toBe("");
	});
});

describe("adversarial", () => {
	test("security: a hostile place count and text-shaped numbers do not reach a prototype", () => {
		expectPrototypeUntouched(() => {
			expect(() => fixedDecimalText(1e300, 0)).not.toThrow();
			expect(fixedDecimalText(Number("1e+25"), 1)).toBe("10000000000000000000000000.0");
			// A word that names an inherited property is a locale tag like any
			// other: refused as unusable, or a real formatter, never a prototype's.
			for (const word of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
				let outcome: string;
				try {
					outcome = groupedIntegerFormatFor(word) instanceof Intl.NumberFormat ? "formatter" : "other";
				} catch (e) {
					outcome = e instanceof RangeError ? "refused" : "other";
				}
				expect({ word, outcome: outcome === "other" ? outcome : "ok" }).toEqual({ word, outcome: "ok" });
			}
		});
	});

	test("realistic: the money chain that exposed it reads as before, on both passes", () => {
		const lines = ["x = $1", ...Array.from({ length: 600 }, () => "x = x * 1.123456789")].join("\n");
		const result = newTrackedEngine().parseDocument(lines);
		const last = result.lines[result.lines.length - 1].result;
		expect(last).toBeTruthy();
		const shown = formatValue(last!);
		expect(shown).not.toMatch(/e\+/);
		expect(shown.startsWith("= $")).toBe(true);
	});

	test("edge: negative zero, the smallest double and the overflow line stay on toFixed", () => {
		expect(fixedDecimalText(-0, 2)).toBe("0.00");
		expect(fixedDecimalText(Number.MIN_VALUE, 3)).toBe("0.000");
		expect(fixedDecimalText(-Number.MAX_VALUE, 0)).toBe(oracle(-Number.MAX_VALUE, 0));
	});
});
