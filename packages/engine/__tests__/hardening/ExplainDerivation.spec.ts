/**
 * A line reports an answer; `explainLine` reports how it got there.
 *
 * `20% off 80` answers 64, and `(20% off 80) + 20%` answers 76.80, but neither
 * says whether the discount landed on the right side of the sum. The derivation
 * does: it walks the operations in the order the engine evaluates them, shows
 * the value each one reaches, and carries that value down into the next line, so
 * a reader checks the engine's reading against their own without splitting the
 * expression across the document.
 *
 * This is a user-facing account, not the developer diagnostic pipeline: the
 * steps are arithmetic prose ("80 less 20%"), not stages, opcodes or timings.
 * Every value in a derivation is the engine's own answer for that piece of the
 * line, re-evaluated rather than re-derived, so the steps below are worked out
 * from the arithmetic and then checked against the engine, never read back off
 * it.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { EngineError } from "@solve-js/errors";
import { ValueType } from "@solve-js/vm/Value";

/** The (description, rounded number) pairs of a line's derivation. */
function steps(line: string): Array<[string, number]> {
	const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
	return engine.explainLine(line).steps.map((s) => [s.description, s.value.toNumber()]);
}

/** Just the step descriptions, for the cases where wording is the point. */
function descriptions(line: string): string[] {
	const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
	return engine.explainLine(line).steps.map((s) => s.description);
}

describe("the reported example", () => {
	// The issue writes `20% off 80 + VAT at 20%`, but `VAT at 20%` is not a
	// form this engine parses (the bare word makes it an "unexpected token"),
	// so the same shape is written with the sum made explicit. The derivation
	// is the one the issue asks for.
	test("a discount then a markup, each on its own line", () => {
		expect(steps("(20% off 80) + 20%")).toEqual([
			["80 less 20%", 64],
			["64 plus 20%", 76.8],
		]);
	});

	test("the discount alone", () => {
		expect(steps("20% off 80")).toEqual([["80 less 20%", 64]]);
	});
});

describe("arithmetic precedence is visible in the order of the steps", () => {
	test("multiplication is taken before the addition around it", () => {
		expect(steps("2 + 3 * 4")).toEqual([
			["3 times 4", 12],
			["2 plus 12", 14],
		]);
	});

	test("parentheses move the addition first", () => {
		expect(steps("(2 + 3) * 4")).toEqual([
			["2 plus 3", 5],
			["5 times 4", 20],
		]);
	});

	test("a longer chain, each running total carried down", () => {
		expect(steps("2 * 3 + 4 * 5")).toEqual([
			["2 times 3", 6],
			["4 times 5", 20],
			["6 plus 20", 26],
		]);
	});
});

describe("associativity", () => {
	test("subtraction groups to the left", () => {
		expect(steps("2 - 3 - 4")).toEqual([
			["2 minus 3", -1],
			["-1 minus 4", -5],
		]);
	});

	test("division groups to the left", () => {
		expect(steps("100 / 4 / 5")).toEqual([
			["100 divided by 4", 25],
			["25 divided by 5", 5],
		]);
	});

	test("exponent groups to the right, so the top of the tower is taken first", () => {
		expect(steps("2 ^ 3 ^ 2")).toEqual([
			["3 to the power of 2", 9],
			["2 to the power of 9", 512],
		]);
	});
});

describe("percentages", () => {
	test("plus a percentage is a markup of the quantity", () => {
		expect(steps("80 + 20%")).toEqual([["80 plus 20%", 96]]);
	});

	test("minus a percentage is a discount", () => {
		expect(steps("80 - 20%")).toEqual([["80 minus 20%", 64]]);
	});

	test("`off` reads base first even though the rate is written first", () => {
		expect(descriptions("20% off 80")).toEqual(["80 less 20%"]);
	});

	test("`on` is a markup, base first", () => {
		expect(descriptions("10% on 200")).toEqual(["200 plus 10%"]);
	});

	test("`of` takes a fraction of the quantity", () => {
		expect(steps("20% of 80")).toEqual([["20% of 80", 16]]);
	});

	test("`of` binds tighter than a following sum", () => {
		expect(steps("10 + 20% of 50")).toEqual([
			["20% of 50", 10],
			["10 plus 10", 20],
		]);
	});

	test("`off` takes the whole sum after it as its base", () => {
		// `20% off 80 + 20` is `20% off (80 + 20)`, the same grouping the
		// engine uses, so the sum is worked out before the discount applies.
		expect(steps("20% off 80 + 20")).toEqual([
			["80 plus 20", 100],
			["100 less 20%", 80],
		]);
	});

	test("a chain of discounts compounds, each on the running total", () => {
		expect(steps("100 - 10% - 5%")).toEqual([
			["100 minus 10%", 90],
			["90 minus 5%", 85.5],
		]);
	});
});

describe("money and units carry through the derivation", () => {
	test("a sum of money stays money, to the cent", () => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const explanation = engine.explainLine("$0.10 + $0.20");
		expect(explanation.steps.map((s) => s.description)).toEqual(["$0.10 plus $0.20"]);
		expect(explanation.result.type).toBe(ValueType.Uom);
		expect(explanation.result.unit).toBe("USD");
		expect(explanation.result.toNumber()).toBeCloseTo(0.3, 10);
	});

	test("a markup on money stays money", () => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const explanation = engine.explainLine("$80 + 20%");
		expect(explanation.steps.map((s) => s.description)).toEqual(["$80 plus 20%"]);
		expect(explanation.result.unit).toBe("USD");
		expect(explanation.result.toNumber()).toBeCloseTo(96, 10);
	});

	test("a sum of lengths is one step in the first unit", () => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const explanation = engine.explainLine("5 km + 300 m");
		expect(explanation.steps.map((s) => s.description)).toEqual(["5 km plus 300 m"]);
		expect(explanation.result.unit).toBe("km");
		expect(explanation.result.toNumber()).toBeCloseTo(5.3, 10);
	});
});

describe("signs belong to the operand they precede, not the derivation", () => {
	test("a leading minus is part of the literal", () => {
		expect(steps("-5 + 3")).toEqual([["-5 plus 3", -2]]);
	});

	test("a minus after an operator is a sign on the right operand", () => {
		expect(steps("2 * -3")).toEqual([["2 times -3", -6]]);
	});
});

describe("a line with nothing to break down returns the answer without steps", () => {
	test("a bare number has no derivation", () => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const explanation = engine.explainLine("42");
		expect(explanation.steps).toEqual([]);
		expect(explanation.result.toNumber()).toBe(42);
	});

	test("a bare quantity has no derivation", () => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const explanation = engine.explainLine("5 km");
		expect(explanation.steps).toEqual([]);
		expect(explanation.result.unit).toBe("km");
	});

	test("an unmodelled construct still reports its answer, without steps", () => {
		// Function calls are deferred: the derivation cannot break `sqrt(16)`
		// down, so it reports the answer alone rather than a partial account.
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const explanation = engine.explainLine("sqrt(16) + 2");
		expect(explanation.steps).toEqual([]);
		expect(explanation.result.toNumber()).toBe(6);
	});

	test("a conversion is deferred the same way", () => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const explanation = engine.explainLine("3 kg in g");
		expect(explanation.steps).toEqual([]);
		expect(explanation.result.toNumber()).toBeCloseTo(3000, 6);
	});
});

describe("the answer and the derivation never disagree", () => {
	test.each([
		"2 + 3 * 4",
		"(2 + 3) * 4",
		"100 - 10% - 5%",
		"(20% off 80) + 20%",
		"2 ^ 3 ^ 2",
		"$0.10 + $0.20",
		"5 km + 300 m",
		"sqrt(16) + 2",
	])("`%s`: result matches evaluateExpression, and equals the last step", (line) => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const explanation = engine.explainLine(line);
		const [direct] = engine.evaluateExpression(line);

		expect(explanation.result.toNumber()).toBeCloseTo(direct.toNumber(), 10);

		if (explanation.steps.length > 0) {
			const last = explanation.steps[explanation.steps.length - 1];
			expect(last.value.toNumber()).toBeCloseTo(direct.toNumber(), 10);
		}
	});
});

describe("a line that does not evaluate is a structured error", () => {
	test("explainLine throws an EngineError, not a bare one", () => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		expect(() => engine.explainLine("2 +")).toThrow(EngineError);
	});
});
