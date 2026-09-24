import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #598: `JSON.stringify` of a result threw "Do not know how to serialize a
 * BigInt" whenever the value carried an exact sidecar, which a decimal literal
 * always did and, since exact decimals (#511) and exact large integers (#526),
 * most computed answers do. `Value.toJSON()` writes the fields a host reads
 * (`type`, `value`, `unit`), then each sidecar that is set, bigints as strings.
 */

const evaluate = (source: string) => newTrackedEngine().evaluateExpression(source);
const json = (source: string) => JSON.parse(JSON.stringify(evaluate(source)));

describe("a result serialises", () => {
	test.each([
		["0.1 + 0.2", { type: 0, value: 0.3, exact: "0.3" }],
		["1.5", { type: 0, value: 1.5, exact: "1.5" }],
		["$1.50", { type: 6, value: 1.5, unit: "USD", exact: "1.50" }],
		["3^40", { type: 0, value: 12157665459056929000, rational: "12157665459056928801/1" }],
		["1/3", { type: 0, value: 1 / 3, rational: "1/3" }],
		["2 + 3", { type: 0, value: 5 }],
		["1 +/- 0.1", { type: 0, value: 1, uncertainty: 0.1 }],
	])("%s", (source, expected) => {
		expect(json(source)).toEqual(expected);
	});

	test("an n whole number is written as its digits", () => {
		expect(json("12345678901234567891n")).toEqual({ type: 2, value: "12345678901234567891" });
	});

	test("the private cached number is left out", () => {
		const v = evaluate("2 + 3");
		v.toNumber();
		expect(Object.keys(json("2 + 3"))).not.toContain("_cachedNumber");
	});

	test("a whole document's result serialises too", () => {
		const doc = newTrackedEngine().parseDocument("a = 1.5\na * 2\n3^40");
		const round = JSON.parse(JSON.stringify(doc));
		expect(round.lines[1].result).toEqual({ type: 0, value: 3 });
		expect(round.lines[2].result.rational).toBe("12157665459056928801/1");
	});
});
