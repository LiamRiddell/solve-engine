/**
 * Successive percentage changes compound, and the phrasing makes that visible.
 *
 * `120 up 10% then down 10%` is 118.80, not 120. The intuitive answer is the
 * wrong one: the 10% down comes off the larger 132, not the original 120. That
 * is the whole reason the phrasing earns a place in a calculator that reads
 * like a sentence, because the person writing it out by hand is exactly the
 * person who reaches for 120.
 *
 * Each `up N%` / `down N%` is `value * (1 ± N%)`, the same arithmetic as
 * `increase value by N%`, so a chain is that step applied to the running total
 * again and again. `then` between steps is optional connective, and `N times`
 * repeats a step.
 *
 * `up` and `down` are ordinary words, so they become operators only directly
 * before a percentage. The "what must keep working" block guards that: prose
 * that merely mentions them, and variables named after them, are left alone.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

/** The first line's result through the markdown document path. */
function evaluateMarkdown(line: string): unknown {
	const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
	const [parsed] = engine.parseDocument(line, { inputType: "markdown" }).lines;
	return parsed.result?.value ?? parsed.error;
}

describe("a single step goes up or down by a percentage", () => {
	test.each([
		["50 up 20%", 60],
		["80 down 15%", 68],
		["120 up 10%", 132],
		["120 down 10%", 108],
		["200 up 5%", 210],
		["1000 down 1%", 990],
	])("%s is %d", (source, expected) => {
		expect(num(source)).toBeCloseTo(expected, 10);
	});

	test("up by a percentage is the same as increasing by it", () => {
		expect(num("120 up 10%")).toBeCloseTo(num("increase 120 by 10%"), 10);
	});

	test("down by a percentage is the same as decreasing by it", () => {
		expect(num("120 down 10%")).toBeCloseTo(num("decrease 120 by 10%"), 10);
	});
});

describe("changes chain, each applying to the running total", () => {
	test("the reported case, which reads like it should be 120", () => {
		// The 10% down is taken off 132, not off 120, so it does not cancel.
		expect(num("120 up 10% then down 10%")).toBeCloseTo(118.8, 10);
	});

	test("and it is emphatically not the intuitive 120", () => {
		expect(num("120 up 10% then down 10%")).not.toBe(120);
	});

	test.each([
		["100 up 10% then down 20%", 88],
		["200 down 25% then up 25%", 187.5],
		["50 up 20% then up 20%", 72],
		["120 up 10% then down 10% then up 5%", 124.74],
	])("%s is %d", (source, expected) => {
		expect(num(source)).toBeCloseTo(expected, 10);
	});

	test("`then` is optional: the steps chain without it", () => {
		expect(num("120 up 10% down 10%")).toBeCloseTo(num("120 up 10% then down 10%"), 10);
	});

	test("a chain is the running total handed from step to step", () => {
		// (((120 up 10%) down 10%) up 5%), computed the long way round.
		const byHand = 120 * 1.1 * 0.9 * 1.05;
		expect(num("120 up 10% then down 10% then up 5%")).toBeCloseTo(byHand, 10);
	});
});

describe("a step repeats with `N times`", () => {
	test("the reported repeat case", () => {
		expect(num("100 up 10% three times")).toBeCloseTo(133.1, 10);
	});

	test.each([
		["100 up 10% two times", 121],
		["100 up 10% three times", 133.1],
		["100 up 10% ten times", 259.374246],
		["1000 down 10% two times", 810],
	])("%s is about %d", (source, expected) => {
		expect(num(source)).toBeCloseTo(expected, 4);
	});

	test("a number word and a digit mean the same count", () => {
		expect(num("100 up 10% 3 times")).toBeCloseTo(num("100 up 10% three times"), 10);
	});

	test("`N times` is the step written out N times with `then`", () => {
		expect(num("100 up 10% three times")).toBeCloseTo(
			num("100 up 10% then up 10% then up 10%"),
			10,
		);
	});

	test("a repeated step still chains onward with `then`", () => {
		// 100 up 10% twice, then down 50%: 121 * 0.5.
		expect(num("100 up 10% two times then down 50%")).toBeCloseTo(60.5, 10);
	});
});

describe("the unit rides along", () => {
	test("money stays money through a step", () => {
		const value = evaluate("$300 up 10%");
		expect(value.type).toBe(ValueType.Uom);
		expect(value.toNumber()).toBeCloseTo(330, 10);
	});

	test("and through a chain", () => {
		const value = evaluate("$300 up 10% then down 10%");
		expect(value.type).toBe(ValueType.Uom);
		expect(value.toNumber()).toBeCloseTo(297, 10);
	});
});

describe("what must keep working", () => {
	test("a variable can still be named `up`", () => {
		const engine = newTrackedEngine("en");
		engine.evaluateExpression(":up = 5");
		const [value] = engine.evaluateExpression("up + 2");
		expect(value.toNumber()).toBe(7);
	});

	test("a variable can still be named `down`", () => {
		const engine = newTrackedEngine("en");
		engine.evaluateExpression(":down = 10");
		const [value] = engine.evaluateExpression("down * 3");
		expect(value.toNumber()).toBe(30);
	});

	test("prose that mentions `up` with no percentage is left alone", () => {
		// No `%`, so nothing is retyped; the line is not arithmetic and is not
		// answered with a confident number.
		const result = evaluateMarkdown("sales are up 10 points this year");
		expect(typeof result === "number").toBe(false);
	});

	test("prose is not turned into a bogus number even with a percentage in it", () => {
		// "up 10%" appears, but the surrounding words mean the line is not a
		// single expression, so it errors rather than inventing an answer.
		const result = evaluateMarkdown("we were up 10% overall last quarter");
		expect(typeof result === "number").toBe(false);
	});

	test("`if ... then ... else` keeps its own `then`", () => {
		expect(num("if 5 > 3 then 10 else 20")).toBe(10);
	});

	test("a percentage step inside a conditional branch still works", () => {
		expect(num("if 1 > 0 then 100 up 10% else 50")).toBeCloseTo(110, 10);
	});

	test("`increase`/`decrease` are unchanged", () => {
		expect(num("increase 100 by 10%")).toBeCloseTo(110, 10);
		expect(num("decrease 100 by 10%")).toBeCloseTo(90, 10);
	});

	test("the single-step percentage forms are unchanged", () => {
		expect(num("10% of 200")).toBeCloseTo(20, 10);
		expect(num("200 + 10%")).toBeCloseTo(220, 10);
		expect(num("10% on 200")).toBeCloseTo(220, 10);
	});

	test("bare `up`/`down` with no left operand is an error, not a number", () => {
		const result = evaluateMarkdown("up 10%");
		expect(typeof result === "number").toBe(false);
	});
});
