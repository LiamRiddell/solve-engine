/**
 * A percentage reads no global on its ordinary path.
 *
 * The benchmark gate measured the vm suite's `percentage` case (`50%` times
 * 200, TO_PERCENTAGE then MUL) at 2.1 times its merge base. Bisecting the merged
 * batches put the whole step at found-bugs batch H, which taught `toPercentage`
 * to keep a number's exact decimal past 2^53 through `percentageExact`. That
 * helper read `Number.isFinite`, `Math.abs` and `Number.EPSILON` and raised ten
 * to a power on every percentage, though only a fraction from about 2.25e7 up
 * can need the sidecar. Inside a `vm` context, the harness the benchmarks run
 * in, each global read costs hundreds of nanoseconds.
 *
 * `percentageExact` now turns away a fraction below 2e7 with two comparisons
 * before any of that, and `toPercentage` tests the hundredfold for finiteness
 * by subtracting it from itself rather than through `Number.isFinite`. Both are
 * behaviour-neutral, and each is proven here against the implementation it
 * replaced, kept below as an oracle.
 */

import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { Value, ValueType, bigIntValue, boolValue, numberValue, numberValueExact, numberValueRational, percentageValue, stringValue, uomValue } from "@solve-js/vm/Value";
import { rational } from "@solve-js/symbolic";
import type { DecimalData } from "@solve-js/decimal";
import { hasFiniteExactReading, percentageExact, percentageNotFinite, percentageTooLarge, toPercentage } from "@solve-js/vm/VMConversion";

const SRC = path.resolve(__dirname, "../../src");

/** The body of the function whose signature matches, up to its closing brace at the margin. */
function bodyOf(file: string, signature: RegExp): string {
	const source = fs.readFileSync(path.join(SRC, file), "utf8");
	const start = source.search(signature);
	expect(start).toBeGreaterThanOrEqual(0);
	return source.slice(start, source.indexOf("\n}", start));
}

// ── The implementations replaced, kept as oracles ────────────────────────────

/** `percentageExact` as it was: the full magnitude test on every call. */
function oldPercentageExact(value: Value): DecimalData | undefined {
	if (value.type !== ValueType.Number) return undefined;
	const fraction = value.value as number;
	if (!Number.isFinite(fraction) || Math.abs(fraction * 100) * Number.EPSILON < 0.5 * 10 ** -6) return undefined;
	if (value.exact !== undefined) return value.exact;
	const r = value.rational;
	return r !== undefined && r.d === 1n ? { coef: r.n, scale: 0 } : undefined;
}

/** `toPercentage` as it was, for every value that is not a quantity (the quantity branch is unchanged). */
function oldToPercentage(value: Value): Value {
	const fraction = value.toNumber();
	if (!Number.isFinite(fraction * 100)) return Number.isNaN(fraction) || (!Number.isFinite(fraction) && !hasFiniteExactReading(value)) ? percentageNotFinite() : percentageTooLarge();
	const percentage = percentageValue(fraction);
	const exact = oldPercentageExact(value);
	if (exact !== undefined) percentage.exact = exact;
	return percentage;
}

/** What a caller can observe of a result: its type, its double (negative zero kept), its sidecar and its code. */
function observed(v: Value): unknown {
	return {
		type: v.type,
		value: typeof v.value === "number" ? (Object.is(v.value, -0) ? "-0" : String(v.value)) : v.type === ValueType.Error ? null : String(v.value),
		exact: v.exact === undefined ? undefined : `${v.exact.coef}e-${v.exact.scale}`,
		code: v.errorCode,
	};
}

// ── The corpus ───────────────────────────────────────────────────────────────

/** Doubles at every edge the two tests meet: the floor, the real threshold near 2.25e7, 2^53, the overflow line and beyond. */
const DOUBLES: readonly number[] = (() => {
	const out = [
		0, -0, 1, -1, 0.5, -0.5, 0.25, 50, -50, 1 / 3, 0.1 + 0.2,
		2e7, -2e7, 2e7 - 1, -(2e7 - 1), 19999999.999999996, -19999999.999999996, 20000000.000000004,
		22517998, 22517998.1, 22517998.2, 22517999, -22517999, 2.3e7, 1e8, 1e15,
		2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 1.2345678901234568e33, 1e300,
		1.7976931348623156e306, 1.8e306, 1e306, 1e307, -1e307,
		Number.MAX_VALUE / 100, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, Number.EPSILON,
		Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
	];
	// The real threshold, swept in steps finer than its distance from the floor.
	for (let x = 22517990; x <= 22518010; x += 0.25) out.push(x, -x);
	// A logarithmic sweep from the smallest double to the largest.
	for (let e = -320; e <= 308; e += 7) out.push(10 ** e, -(10 ** e), 3.7 * 10 ** e);
	return out;
})();

/** The same doubles as the values the engine carries: plain, with an exact decimal, with a whole or a fractional rational. */
function valuesOf(x: number): Value[] {
	const out = [numberValue(x)];
	out.push(numberValueExact(x, { coef: 12345678901234567890123456789012345n, scale: 1 }));
	out.push(numberValueExact(x, { coef: 90071992547409935n, scale: 1 }));
	out.push(numberValueRational(x, rational(9007199254740993n)));
	out.push(numberValueRational(x, rational(1n, 3n)));
	return out;
}

const HOSTILE: readonly Value[] = [
	bigIntValue(0n), bigIntValue(-1n), bigIntValue(9007199254740993n), bigIntValue(1n << 2000n), bigIntValue(-(1n << 2000n)),
	stringValue("50"), stringValue("constructor"), stringValue(""), boolValue(true), boolValue(false),
	percentageValue(0.5), percentageValue(3e7),
];

// ── percentageExact ──────────────────────────────────────────────────────────

describe("percentageExact", () => {
	test("ordinary: a fraction below the floor carries no sidecar, whatever the value holds", () => {
		for (const v of [...valuesOf(0.5), ...valuesOf(50), ...valuesOf(-1)]) expect(percentageExact(v)).toBeUndefined();
	});

	test("boundary: past the threshold the exact decimal, or the exact whole number, is kept", () => {
		const exact = { coef: 90071992547409935n, scale: 1 };
		expect(percentageExact(numberValueExact(9007199254740994, exact))).toBe(exact);
		expect(percentageExact(numberValueRational(2 ** 53, rational(9007199254740993n)))).toEqual({ coef: 9007199254740993n, scale: 0 });
		expect(percentageExact(numberValueRational(2 ** 53, rational(1n, 3n)))).toBeUndefined();
		expect(percentageExact(numberValue(2 ** 53))).toBeUndefined();
	});

	test("the floor is below the real threshold: the full test turns away every magnitude under 2e7", () => {
		const belowSixthPlace = (x: number): boolean => Math.abs(x * 100) * Number.EPSILON < 0.5 * 10 ** -6;
		for (const x of [2e7, -2e7, 19999999.999999996, 0, -0, Number.MIN_VALUE]) expect(belowSixthPlace(x)).toBe(true);
		expect(belowSixthPlace(2.3e7)).toBe(false);
		expect(belowSixthPlace(-2.3e7)).toBe(false);
	});

	test("agrees with the implementation it replaced over every edge double, in every shape a number takes", () => {
		let compared = 0;
		for (const x of DOUBLES) {
			for (const v of valuesOf(x)) {
				expect({ x, got: percentageExact(v) }).toEqual({ x, got: oldPercentageExact(v) });
				compared++;
			}
		}
		expect(compared).toBeGreaterThan(1000);
	});

	test("hostile: a whole number written with n, text, a boolean and a percentage carry no sidecar, as before", () => {
		for (const v of HOSTILE) expect(percentageExact(v)).toEqual(oldPercentageExact(v));
		for (const v of HOSTILE) expect(percentageExact(v)).toBeUndefined();
	});

	test("source: the floor is tested before any read of Math or Number", () => {
		const body = bodyOf("vm/VMConversion.ts", /export function percentageExact\(/);
		const floor = body.indexOf("PERCENTAGE_EXACT_FLOOR");
		expect(floor).toBeGreaterThan(0);
		expect(body.indexOf("Math.")).toBeGreaterThan(floor);
		expect(body.indexOf("Number.")).toBeGreaterThan(floor);
	});
});

// ── toPercentage ─────────────────────────────────────────────────────────────

describe("toPercentage", () => {
	test("ordinary: a fraction is its percentage, with no sidecar", () => {
		const half = toPercentage(numberValue(0.5));
		expect(half.type).toBe(ValueType.Percentage);
		expect(half.value).toBe(0.5);
		expect(half.exact).toBeUndefined();
		expect(toPercentage(uomValue(100, "ppm")).value).toBeCloseTo(0.0001, 12);
	});

	test("boundary: zero keeps its sign, the overflow line refuses by name, and the non-finite say so", () => {
		expect(Object.is(toPercentage(numberValue(-0)).value, -0)).toBe(true);
		expect(toPercentage(numberValue(Number.MAX_VALUE / 100)).type).toBe(ValueType.Percentage);
		expect(toPercentage(numberValue(1e307)).errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(toPercentage(numberValue(Number.NaN)).errorCode).toBe("PERCENTAGE_NOT_FINITE");
		expect(toPercentage(numberValue(Number.NEGATIVE_INFINITY)).errorCode).toBe("PERCENTAGE_NOT_FINITE");
		expect(toPercentage(bigIntValue(1n << 2000n)).errorCode).toBe("PERCENTAGE_OVERFLOW");
	});

	test("agrees with the implementation it replaced over every edge double, in every shape a number takes", () => {
		for (const x of DOUBLES) {
			for (const v of valuesOf(x)) expect({ x, got: observed(toPercentage(v)) }).toEqual({ x, got: observed(oldToPercentage(v)) });
		}
	});

	test("hostile: a whole number written with n, text, a boolean and a percentage answer as before", () => {
		for (const v of HOSTILE) expect(observed(toPercentage(v))).toEqual(observed(oldToPercentage(v)));
	});

	test("source: the ordinary path tests finiteness without the global Number", () => {
		const body = bodyOf("vm/VMConversion.ts", /export function toPercentage\(/);
		// From the number's double to the finiteness test: the refusal after it
		// reads Number, but only for a fraction that is not finite.
		const ordinary = body.slice(body.indexOf("value.toNumber()"), body.indexOf(") return Number.isNaN"));
		expect(ordinary).toContain("hundredfold - hundredfold !== 0");
		expect(ordinary.replace(/\/\/.*$/gm, "")).not.toContain("Number.");
	});
});

// ── What a reader sees ───────────────────────────────────────────────────────

/** Each line of a document as the reader sees it. */
function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text).lines.map((l) =>
		l.result == null ? `ERROR ${l.error}` : l.result.isError() ? `ERROR ${l.result.errorCode}` : formatValue(l.result));
}

describe("the lines a reader writes answer what they answered before", () => {
	test("ordinary percentages, the floor, the threshold, past 2^53 and the overflow line", () => {
		const lines: Array<[string, string]> = [
			["50% of 200", "= 100"],
			["50 as %", "= 5,000.00%"],
			["0.25 as %", "= 25.00%"],
			["-0 as %", "= 0.00%"],
			["19999999 as %", "= 1,999,999,900.00%"],
			["20000000 as %", "= 2,000,000,000.00%"],
			["22517999 as %", "= 2,251,799,900.00%"],
			["-22517999 as %", "= -2,251,799,900.00%"],
			["9007199254740993 as percent", "= 900,719,925,474,099,300.00%"],
			["9007199254740993.5 as percent", "= 900,719,925,474,099,350.00%"],
			["12345678901234567890123456789012345 as %", "= 1,234,567,890,123,456,789,012,345,678,901,234,500.00%"],
			["0.1234567890123456789012345678901234567 as %", "= 12.35%"],
			["1e307 as %", "ERROR PERCENTAGE_OVERFLOW"],
			["1/0 as %", "ERROR PERCENTAGE_NOT_FINITE"],
			["100 ppm as %", "= 0.01%"],
			["2n^2000 as %", "ERROR PERCENTAGE_OVERFLOW"],
		];
		expect(doc(lines.map(([line]) => line).join("\n"))).toEqual(lines.map(([, shown]) => shown));
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words, a long sum, deep brackets, a huge power, look-alike digits and markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word} as %`);
				expectHonestDocument(`${word} = 3e7\n${word} as %\n${word} in percent`);
			}
		});
		expectHonestLine(`(${RESOURCE_PROBES.longSum(300)}) as %`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.deepParens(200)} * 2e7 as %`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.hugePower()} as %`, { budgetMs: 5_000 });
		for (const line of fill("X as %", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("２e7 as %");
		expectHonestLine("2e7 as ​%");
		expectHonestLine("<b>2e7</b> as %");
	});

	test("realistic: a value from the line above, a what-if and arithmetic on the percentage, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("n = 22517999\nn as %\n(n as %) * 2\nline 2 with n = 0.25\n50%\n2e7 as % of 3");
		expect(incremental).toEqual(batch);
		expect(batch[1]).toBe("= 2,251,799,900.00%");
	});

	test("edge: every numeric edge as a percentage, and either side of the floor, is a percentage or a refusal", () => {
		for (const line of [...fill("X as %", NUMERIC_EDGES), ...fill("-(X) as percent", NUMERIC_EDGES), "2e7 as %", "-2e7 as %", "20000001 as %", "2.3e7 as %"]) {
			const result = expectHonestLine(line);
			if (result.kind === "value") expect({ line, text: result.text }).not.toEqual({ line, text: expect.stringMatching(/Infinity|NaN/) });
		}
	});
});
