/**
 * Calling a function without parentheses: `sqrt 16` as well as `sqrt(16)`.
 *
 * The form is free here because these names are already reserved `FUNC` tokens,
 * so there is no variable a bare `sqrt` could be confused with. What is not free
 * is where the argument stops, and that is what most of this file pins down.
 *
 * The awkward case is the second argument. `6 (3)` is 18 in this grammar, so a
 * parenthesised group after a value multiplies, and by the time a parselet runs
 * there is no `(` to look at: the implicit-multiplication rule has already
 * rewritten `2 (8)` into `2 * (8)`. `root 2 (8)` and `log 2 * (10)` therefore
 * arrive as the same shape and have to be told apart by position, which is why
 * both are asserted below rather than only the one that was being added.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/** Evaluates one line through a real engine and returns the formatted result. */
function evaluate(source: string): string {
	const engine = newTrackedEngine("en");
	try {
		return formatValue(engine.evaluateExpression(source)[0]).replace(/^=\s*/, "");
	} finally {
		engine.clear();
	}
}

describe("a function can be called without parentheses", () => {
	test("the one-argument functions", () => {
		expect(evaluate("sqrt 16")).toBe("4");
		expect(evaluate("cbrt 8")).toBe("2");
		expect(evaluate("fact 5")).toBe("120");
		expect(evaluate("round 3.45")).toBe("3");
		expect(evaluate("ceil 3.76")).toBe("4");
		expect(evaluate("floor 2.56")).toBe("2");
		expect(evaluate("abs -4")).toBe("4");
	});

	test("the trigonometric functions", () => {
		expect(evaluate("sin 0")).toBe("0");
		expect(evaluate("cos 0")).toBe("1");
		expect(evaluate("tan 0")).toBe("0");
		expect(evaluate("arcsin 0")).toBe("0");
		expect(evaluate("arccos 1")).toBe("0");
		expect(evaluate("arctan 0")).toBe("0");
		expect(evaluate("sinh 0")).toBe("0");
		expect(evaluate("cosh 0")).toBe("1");
		expect(evaluate("tanh 0")).toBe("0");
	});

	test("the parenthesised form still works, and agrees", () => {
		for (const [bare, parenthesised] of [
			["sqrt 16", "sqrt(16)"],
			["cbrt 8", "cbrt(8)"],
			["fact 5", "fact(5)"],
			["round 3.45", "round(3.45)"],
			["abs -4", "abs(-4)"],
		]) {
			expect(evaluate(bare)).toBe(evaluate(parenthesised));
		}
	});
});

describe("where the argument stops", () => {
	test("the call takes the value beside it and nothing further", () => {
		// The whole question of the bare form. If the argument were parsed at a
		// looser binding power this would be sqrt(25), which is five.
		expect(evaluate("sqrt 16 + 9")).toBe("13");
		expect(evaluate("2 + sqrt 16")).toBe("6");
		expect(evaluate("sqrt 16 * 2")).toBe("8");
	});

	test("a unit suffix binds tighter, so it stays part of the argument", () => {
		// `sin 45 deg` has to be the sine of forty-five degrees, not the sine of
		// forty-five radians given a unit afterwards.
		expect(evaluate("sin 45 deg")).toBe(evaluate("sin(45 deg)"));
	});

	test("an angle unit is honoured rather than dropped", () => {
		// This was a silent wrong answer before the bare form was added: the
		// builtins read their argument through toNumber(), which discards the
		// unit, so `sin(45 deg)` was the sine of forty-five radians.
		expect(evaluate("sin 45 deg")).toBe("0.71");
		expect(evaluate("cos 60 deg")).toBe("0.50");
		expect(evaluate("tan 45 deg")).toBe("1.00");
		expect(evaluate("sin 90 degrees")).toBe("1");
	});

	test("a plain number is still radians", () => {
		expect(evaluate("sin(Pi/2)")).toBe("1");
		expect(evaluate("sin 0")).toBe("0");
	});

	test("a unit that is not an angle is left alone", () => {
		// Not an invitation to guess. A nonsensical unit keeps the previous
		// behaviour of falling through to the plain number.
		expect(evaluate("sin(45 kg)")).toBe(evaluate("sin(45)"));
	});

	test("a following parenthesised group still multiplies for ordinary functions", () => {
		// Unchanged behaviour, and the reason the two-argument form below is
		// restricted by name rather than applied everywhere.
		expect(evaluate("sqrt 16 (3)")).toBe("12");
		expect(evaluate("6 (3)")).toBe("18");
	});
});

describe("the two-argument prefix form", () => {
	test("root takes the degree first", () => {
		expect(evaluate("root 2 (8)")).toBe(evaluate("root(2, 8)"));
		expect(evaluate("root 3 (27)")).toBe("3");
	});

	test("log takes the base first", () => {
		expect(evaluate("log 2 (10)")).toBe(evaluate("log(2, 10)"));
		expect(evaluate("log 2 (8)")).toBe("3");
		expect(evaluate("log 10 (1000)")).toBe("3");
	});

	test("an explicit multiplication is not read as a second argument", () => {
		// `2 (10)` and `2 * (10)` reach the parser as the same three tokens, so
		// this is the case that distinguishes them: a typed `*` occupies a column
		// of its own, the inserted one sits exactly where the `(` does.
		expect(evaluate("log 2 * (10)")).not.toBe(evaluate("log 2 (10)"));
		expect(evaluate("log 2 * (10)")).toBe(evaluate("log(2) * 10"));
	});
});

describe("ln", () => {
	test("is the natural logarithm, and the same function as log of one argument", () => {
		expect(evaluate("ln 3")).toBe(evaluate("log(3)"));
		expect(evaluate("ln(1)")).toBe("0");
	});

	test("log of one argument is unchanged by the base form being added", () => {
		// `log(x)` has meant the natural logarithm here for a long time. Adding
		// `log(base, x)` must not quietly redefine it.
		expect(evaluate("log(1)")).toBe("0");
		expect(evaluate("ln 1")).toBe("0");
	});
});
