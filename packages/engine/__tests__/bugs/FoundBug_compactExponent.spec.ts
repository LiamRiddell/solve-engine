import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { compactParts, compactString } from "@solve-js/packages/converters/NumberNotation";

/**
 * Found bug: `$1e308/hour as compact` answered `$1e+296T/hour`. A figure
 * divided by a trillion can itself need an exponent, and the compact form then
 * wrote a scale twice in two notations. Past the largest suffix the figure is
 * now written in exponent form with no suffix, and a figure that rounds to a
 * thousand trillion (`999.95e12`, which was `1000T`) takes it too.
 */

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
}

describe("the lines that exposed it", () => {
	test.each([
		["$1e308/hour as compact", "$1e+308/hour"],
		["1e308 as compact", "1e+308"],
		["-1e308 as compact", "-1e+308"],
		["1e20 as compact", "1e+20"],
		["999.95e12 as compact", "1e+15"],
		["1.234e18 as compact", "1.23e+18"],
		["$2e15 as compact", "$2e+15"],
		["5e18 km as compact", "5e+18 km"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("the tiers below the limit are unchanged", () => {
		expect(shown("999e12 as compact")).toBe("999T");
		expect(shown("1e12 as compact")).toBe("1T");
		expect(shown("999999 as compact")).toBe("1M");
		expect(shown("1234567 as compact")).toBe("1.23M");
		expect(shown("$3,300,000 as compact")).toBe("$3.3M");
		expect(shown("999 as compact")).toBe("999");
	});

	test("no compact answer mixes an exponent with a suffix", () => {
		for (let exponent = 0; exponent <= 308; exponent += 1) {
			for (const mantissa of [1, 1.5, 9.9995]) {
				const text = compactString(mantissa * 10 ** exponent);
				expect({ exponent, mantissa, mixed: /e[+-]\d+[kMBT]$/.test(text) }).toEqual({ exponent, mantissa, mixed: false });
			}
		}
	});
});

describe("compactParts, the part that was wrong", () => {
	test("ordinary numbers", () => {
		expect(compactParts(1_500_000)).toEqual({ sign: "", figure: "1.5", suffix: "M" });
		expect(compactParts(-2300)).toEqual({ sign: "-", figure: "2.3", suffix: "k" });
		expect(compactParts(12)).toEqual({ sign: "", figure: "12", suffix: "" });
	});

	test("the boundaries of the tiers and of the limit", () => {
		expect(compactParts(999_950)).toEqual({ sign: "", figure: "1", suffix: "M" });
		expect(compactParts(1e15)).toEqual({ sign: "", figure: "1e+15", suffix: "" });
		expect(compactParts(9.99e14)).toEqual({ sign: "", figure: "999", suffix: "T" });
		expect(compactParts(9.9951e14)).toEqual({ sign: "", figure: "1e+15", suffix: "" });
		expect(compactParts(Number.MAX_VALUE)).toEqual({ sign: "", figure: "1.8e+308", suffix: "" });
		expect(compactParts(-Number.MAX_VALUE)).toEqual({ sign: "-", figure: "1.8e+308", suffix: "" });
	});

	test("zero, negative zero, the smallest double and the non-finite values", () => {
		expect(compactParts(0)).toEqual({ sign: "", figure: "0", suffix: "" });
		expect(compactParts(-0)).toEqual({ sign: "", figure: "0", suffix: "" });
		expect(compactParts(5e-324)?.suffix).toBe("");
		expect(compactParts(Infinity)).toBeUndefined();
		expect(compactParts(-Infinity)).toBeUndefined();
		expect(compactParts(NaN)).toBeUndefined();
		expect(compactString(Infinity)).toBe("Infinity");
	});
});

describe("adversarial", () => {
	test("security: prototype words, look-alike text and a long sum stay honest", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("X as compact", PROTOTYPE_WORDS)) expectHonestLine(line);
			for (const line of fill("X as compact", TEXT_EDGES)) expectHonestLine(line);
			expectHonestLine(`(${RESOURCE_PROBES.longSum(2_000)}) * 1e300 as compact`);
		});
	});

	test("realistic: a value from the line above, and a rate", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("big = 1e300");
		expect(formatValue(engine.evaluateExpression("big * $1000/hour as compact"))).toBe("= $1e+303/hour");
		expect(shown("1e308 kg as compact")).toBe("1e+308 kg");
	});

	test("edges: every numeric edge is answered honestly", () => {
		for (const line of fill("(X) as compact", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("1e-320 as compact")).toBe("1e-320");
		expect(shown("-0 as compact")).toBe("0");
	});
});
