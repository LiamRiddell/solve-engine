import { describe, expect, test } from "@jest/globals";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DECIMAL_DIGIT_CEILING, decimalFromLiteral, decimalWithinDigits, decimalToString, makeDecimal, type DecimalData } from "@solve-js/decimal";
import { EXACT_DECIMAL_DIGITS } from "@solve-js/vm/ExactDecimals";
import { uomValueExact, type Value } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";

/**
 * Issue #735: money keeps an exact decimal, and nothing bounded it across
 * lines. Each line is a new evaluation, so the per-evaluation allocation charge
 * never saw the whole chain, and `x = x * 1.123456789` added nine digits a
 * line: 4,000 lines from `$1` carried a 36,203-digit coefficient and took 4.4 s
 * on the issue's machine, where the same chain from `1` took 63 ms.
 *
 * An exact money amount is now held to the ceiling a plain decimal has, 34
 * significant digits and 34 places (`DECIMAL_DIGIT_CEILING`), by
 * `decimalWithinDigits` in `uomValueExact`, the one place a money Value is
 * given its decimal. Past it the amount is rounded to fit, half away from zero,
 * rather than dropped to the double, so a half cent of any amount a till could
 * hold still rounds the way the exact value does. A whole part longer than 34
 * digits keeps only the double.
 */

// ── Helpers ─────────────────────────────────────────────────────────────

function answers(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		return formatValue(line.result).replace(/^=\s*/, "");
	});
}
const batchResult = (lines: readonly string[]) => newTrackedEngine().parseDocument(lines.join("\n"));
const batch = (lines: readonly string[]) => answers(batchResult(lines));
const incremental = (lines: readonly string[]) => answers(evaluateDocument(newTrackedEngine(), lines.join("\n")));
function both(lines: readonly string[]): string[] {
	const out = batch(lines);
	expect(incremental(lines)).toEqual(out);
	return out;
}

/** How many digits a decimal's coefficient has. */
const digitsOf = (d: DecimalData) => (d.coef < 0n ? -d.coef : d.coef).toString().length;

/** `x = <start>` then `count` lines of `x = x * <factor>`. */
const chain = (start: string, factor: string, count: number) => [`x = ${start}`, ...Array.from({ length: count }, () => `x = x * ${factor}`)];

/** The exact decimal on each line's answer, or null. */
const exactsOf = (result: ParsingResult) => result.lines.map((line) => (line.result as Value | null)?.exact ?? null);

/** A median of three timings, in milliseconds. */
function timed(work: () => void): number {
	const runs: number[] = [];
	for (let i = 0; i < 3; i++) {
		const started = performance.now();
		work();
		runs.push(performance.now() - started);
	}
	return runs.sort((a, b) => a - b)[1];
}

// ── decimalWithinDigits ─────────────────────────────────────────────────

describe("decimalWithinDigits", () => {
	test("the ceiling is the plain decimals' ceiling", () => {
		expect(DECIMAL_DIGIT_CEILING).toBe(34);
		expect(EXACT_DECIMAL_DIGITS).toBe(DECIMAL_DIGIT_CEILING);
	});

	test("a decimal inside the ceiling comes back as the same object", () => {
		for (const text of ["0", "0.10", "-19.99", "1234567890123456789012345678901234", "0.1234567890123456789012345678901234"]) {
			const d = decimalFromLiteral(text);
			expect(decimalWithinDigits(d)).toBe(d);
		}
	});

	test("too many places is rounded to 34, half away from zero", () => {
		expect(decimalToString(decimalWithinDigits(decimalFromLiteral("0.00499999999999999999999999999999999"))!)).toBe("0.0050000000000000000000000000000000");
		expect(decimalToString(decimalWithinDigits(decimalFromLiteral("-0.00499999999999999999999999999999999"))!)).toBe("-0.0050000000000000000000000000000000");
		expect(decimalToString(decimalWithinDigits(decimalFromLiteral("0.00499999999999999999999999999999994"))!)).toBe("0.0049999999999999999999999999999999");
	});

	test("too many significant digits drops them from the fractional end", () => {
		const d = decimalWithinDigits(decimalFromLiteral("432.194237515066200915728819888647334147337824106216430664062500"))!;
		expect(digitsOf(d)).toBe(34);
		expect(decimalToString(d)).toBe("432.1942375150662009157288198886473");
	});

	test("a rounding that carries into a new digit gives the digit back", () => {
		const d = decimalWithinDigits(decimalFromLiteral("9.99999999999999999999999999999999999"))!;
		expect(decimalToString(d)).toBe("10.00000000000000000000000000000000");
		expect(digitsOf(d)).toBe(34);
	});

	test("a whole part longer than the ceiling cannot be held", () => {
		expect(decimalWithinDigits(decimalFromLiteral("12345678901234567890123456789012345"))).toBeNull();
		expect(decimalWithinDigits(decimalFromLiteral("12345678901234567890123456789012345.6"))).toBeNull();
		// Thirty-four nines and a half rounds up past the ceiling.
		expect(decimalWithinDigits(decimalFromLiteral("9999999999999999999999999999999999.5"))).toBeNull();
		expect(decimalWithinDigits(decimalFromLiteral("9999999999999999999999999999999999.4"))).toEqual(makeDecimal(9999999999999999999999999999999999n, 0));
	});

	test("zero at any scale, and a tiny amount, round to zero at 34 places", () => {
		expect(decimalWithinDigits(makeDecimal(0n, 90))).toEqual(makeDecimal(0n, 34));
		expect(decimalWithinDigits(makeDecimal(1n, 60))).toEqual(makeDecimal(0n, 34));
	});

	test("a smaller ceiling", () => {
		expect(decimalWithinDigits(decimalFromLiteral("1.25"), 2)).toEqual(makeDecimal(13n, 1));
		expect(decimalWithinDigits(decimalFromLiteral("1.2"), 2)).toEqual(decimalFromLiteral("1.2"));
		expect(decimalWithinDigits(decimalFromLiteral("100"), 2)).toBeNull();
		expect(decimalWithinDigits(decimalFromLiteral("99.5"), 2)).toBeNull();
	});
});

describe("uomValueExact", () => {
	test("holds the money it is given to the ceiling", () => {
		const long = decimalFromLiteral("432.194237515066200915728819888647334147337824106216430664062500");
		const v = uomValueExact(432.1942375150662, "USD", long);
		expect(digitsOf(v.exact!)).toBe(34);
		expect(v.value).toBe(432.1942375150662);
		expect(formatValue(v)).toBe("= $432.19");
	});

	test("keeps only the double for a whole part past the ceiling", () => {
		const v = uomValueExact(1e40, "USD", decimalFromLiteral("10000000000000000000000000000000000000001"));
		expect(v.exact).toBeUndefined();
		expect(v.value).toBe(1e40);
	});

	test("leaves an amount inside the ceiling untouched", () => {
		const d = decimalFromLiteral("19.99");
		expect(uomValueExact(19.99, "USD", d).exact).toBe(d);
	});
});

// ── Documents ───────────────────────────────────────────────────────────

describe("a chain of multiplications costs the same on every line", () => {
	test("the issue's chain: each line's decimal stays within 34 digits", () => {
		const result = batchResult(chain("$1", "1.123456789", 400));
		for (const exact of exactsOf(result)) {
			if (exact === null) continue;
			expect(digitsOf(exact)).toBeLessThanOrEqual(34);
			expect(exact.scale).toBeLessThanOrEqual(34);
		}
	});

	test("4,000 lines from $1 take a small multiple of the same chain from 1", () => {
		const money = timed(() => batch(chain("$1", "1.123456789", 4_000)));
		const plain = timed(() => batch(chain("1", "1.123456789", 4_000)));
		// It was about seventy times: 4,423 ms against 63 ms.
		expect(money / plain).toBeLessThan(5);
	});

	test("the amount past a decillion is held as a double, and read as one", () => {
		const out = both(chain("$1", "1.123456789", 4_000));
		// Its digits are the double's, written in full as a plain number's are
		// (FoundBug_exponentTextInAResult), not in JavaScript's exponent form.
		expect(out[out.length - 1]).toMatch(/^\$16,807,070,918,084,162(?:,000)+\.00$/);
	});

	test("thirty years of 5% growth still shows $432.19, as the one-line form does", () => {
		const result = batchResult(chain("$100", "1.05", 30));
		expect(answers(result)[30]).toBe("$432.19");
		expect(digitsOf(exactsOf(result)[30]!)).toBe(34);
		expect(both(["$100 * 1.05 ^ 30"])).toEqual(["$432.19"]);
		expect(both(chain("$100", "1.05", 30))[30]).toBe("$432.19");
	});

	test("a division chain", () => {
		const out = both(["x = $1000", ...Array.from({ length: 30 }, () => "x = x / 1.07")]);
		expect(out[30]).toBe("$131.37");
	});
});

// ── Adversarial ─────────────────────────────────────────────────────────

describe("adversarial: edge cases", () => {
	test("a chain that crosses the ceiling on a half cent rounds it up", () => {
		// $0.0025 doubled by a factor written to 33 places is exactly half a
		// cent, 37 places long; held to 34 places it is still exactly $0.005.
		expect(both(["x = $0.0025", "x = x * 2.000000000000000000000000000000000"])).toEqual(["$0.00", "$0.01"]);
	});

	test("an amount written past 34 places is rounded at the 34th, the boundary the page names", () => {
		expect(both(["$0.00499999999999999999999999999999999"])).toEqual(["$0.01"]);
		expect(both(["$0.0049999999999999999999999999999999"])).toEqual(["$0.00"]);
	});

	test("same-currency addition of two amounts just under the ceiling", () => {
		const lines = ["a = $0.1234567890123456789012345678901234", "b = $0.9876543210987654321098765432109876", "a + b", "a - b"];
		expect(both(lines)).toEqual(["$0.12", "$0.99", "$1.11", "-$0.86"]);
		const exact = exactsOf(batchResult(lines));
		expect(decimalToString(exact[2]!)).toBe("1.111111110111111111011111111101111");
		expect(decimalToString(exact[3]!)).toBe("-0.8641975320864197532086419753208642");
	});

	test("a whole part at and past 34 digits", () => {
		expect(both(["$123456789012345678901234567890123 * 10", "$1234567890123456789012345678901234 * 10", "$1e40 + $1"])).toEqual([
			// A whole-number literal past 2^53 keeps its digits
			// (FoundBug_wholeLiteralPastSafeRange), so a 33-digit amount times
			// ten is exact, where it once showed its double's invented digits,
			// and a 35-digit product is the nearest double to the true one,
			// written in full digits as a plain number's double is.
			"$1,234,567,890,123,456,789,012,345,678,901,230.00",
			"$12,345,678,901,234,570,000,000,000,000,000,000.00",
			"$10,000,000,000,000,000,000,000,000,000,000,000,000,000.00",
		]);
	});

	test("a chain shrinking by tenths comes to zero cents and stays there", () => {
		const out = both(chain("$1", "0.1", 60));
		expect(out[60]).toBe("$0.00");
		const last = exactsOf(batchResult(chain("$1", "0.1", 60)))[60]!;
		expect(last.scale).toBeLessThanOrEqual(34);
	});

	test("zero, negative zero and negative amounts through a chain", () => {
		expect(both(chain("$0", "1.123456789", 50))[50]).toBe("$0.00");
		expect(both(chain("-$0", "1.123456789", 5))[5]).toBe("$0.00");
		expect(both(chain("-$100", "1.05", 30))[30]).toBe("-$432.19");
	});

	test("the numeric edges as a factor", () => {
		for (const line of fill("$10.10 * X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});

describe("adversarial: realistic breakage", () => {
	test("a tax and a percentage through a long chain", () => {
		const lines = [...chain("$100", "1.123456789", 20), "x + 15%", "tax on x at 20%", "x - 15%"];
		const out = both(lines);
		expect(out.slice(-3)).toEqual(["$1,179.85", "$205.19", "$872.06"]);
	});

	test("a value from the line above rather than a literal, and a total over the chain", () => {
		const lines = ["$100", "prev * 1.123456789", "prev * 1.123456789", "prev * 1.123456789", "prev * 1.123456789", "total above"];
		// The total is of the exact amounts, not of the cents each line shows.
		expect(both(lines)).toEqual(["$100.00", "$112.35", "$126.22", "$141.80", "$159.30", "$639.66"]);
	});

	test("a unit that does not fit, in the middle of a chain", () => {
		expectHonestDocument([...chain("$100", "1.05", 10), "x + 3 kg", "x * 1.05"].join("\n"));
	});
});

describe("adversarial: security", () => {
	test("prototype words as the name the chain steps", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestDocument([`${word} = $1`, ...Array.from({ length: 50 }, () => `${word} = ${word} * 1.123456789`)].join("\n"));
			}
		});
	});

	test("look-alike and markup-shaped text between the steps", () => {
		for (const text of TEXT_EDGES) expectHonestDocument(["x = $1", text, "x = x * 1.123456789", text, "x = x * 1.123456789"].join("\n"));
	});

	test("a long chain through both passes stays within budget", () => {
		expectHonestDocument(chain("$1", "1.123456789", 4_000).join("\n"), { budgetMs: 10_000 });
	});
});
