/**
 * Goal seek, `solve line N for <var> = <target>` (GitHub issue #98).
 *
 * The engine computes forwards, so every "what input gives me this answer" used
 * to mean editing a number and re-reading the result by hand. Goal seek inverts
 * a line against a target instead, by one of two mechanisms the issue itself
 * names: a closed-form inversion when the line is closed form in the variable,
 * and a bounded numeric search otherwise.
 *
 * Every real-document test goes through the actual ExpressionEngine +
 * DocumentModel + ThreeTierEvaluator trio, the same harness the line-reference
 * tests use, since goal seek is fundamentally about re-running one line while
 * varying a variable another line reads, which the isolated parselet harness
 * cannot represent.
 *
 * The two properties that matter most here are correctness (the answer, plugged
 * back in, actually reaches the target) and bounded execution (no input can
 * make the search spin: a target it cannot reach, a discontinuous relationship,
 * or the iteration cap all end in a structured error rather than a hang).
 */
import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { Value, ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluate a whole document and return it, so a test can read any line's result. */
function solveDoc(lines: string[], config?: ConstructorParameters<typeof ExpressionEngine>[2]): DocumentModel {
	const engine = newTrackedEngine({ config });
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, engine);
	evaluator.evaluate({ startLine: 1, endLine: lines.length });
	return doc;
}

/** The result Value of line `n` (1-based) after a document evaluation. */
function lineResult(doc: DocumentModel, n: number): Value {
	return doc.getLineAt(n)!.result!;
}

/** The monthly repayment the forward formula gives for a rate, used to check goal seek's answer round-trips. */
function repaymentAt(rate: number): number {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(`monthly repayment on 200000 over 25 years at ${rate}`);
	return value.toNumber();
}

describe("closed-form goal seek", () => {
	test("inverts a linear relationship exactly", () => {
		// 2x + 10 = 30 has the exact solution x = 10, found by the algebra solver
		// with no search at all.
		const doc = solveDoc([":x = 0", "x * 2 + 10", "solve line 2 for x = 30"]);
		expect(lineResult(doc, 3).toNumber()).toBe(10);
	});

	test("inverts a relationship with a negative coefficient", () => {
		// 100 - 4x = 20 solves to x = 20; the solver handles the sign, no
		// monotonic-search assumption needed.
		const doc = solveDoc([":x = 0", "100 - x * 4", "solve line 2 for x = 20"]);
		expect(lineResult(doc, 3).toNumber()).toBe(20);
	});

	test("reads the target as an expression, not just a literal", () => {
		// 2x + 10 = 15 + 15 solves to x = 10, so the "= <target>" side is a real
		// expression the parselet evaluates.
		const doc = solveDoc([":x = 0", "x * 2 + 10", "solve line 2 for x = 15 + 15"]);
		expect(lineResult(doc, 3).toNumber()).toBe(10);
	});
});

describe("numeric goal seek over a formula with no closed form", () => {
	test("finds the interest rate that reaches a target repayment", () => {
		// The amortization builtin has no symbolic reading, so this must go
		// through the bounded numeric search. The answer, plugged back into the
		// forward formula, must reproduce the target.
		const doc = solveDoc([
			":rate = 5%",
			"monthly repayment on 200000 over 25 years at rate",
			"solve line 2 for rate = 1200",
		]);
		const solved = lineResult(doc, 3);
		expect(solved.type).toBe(ValueType.Number);
		const rate = solved.toNumber();
		expect(rate).toBeGreaterThan(0);
		expect(repaymentAt(rate)).toBeCloseTo(1200, 3);
	});

	test("finds the deposit that reaches a target repayment", () => {
		// The classic "what deposit makes the repayment 900?" from the issue,
		// solving for the principal rather than the rate. Round-trips the same way.
		const doc = solveDoc([
			":deposit = 100000",
			"monthly repayment on deposit over 25 years at 4%",
			"solve line 2 for deposit = 900",
		]);
		const solved = lineResult(doc, 3);
		expect(solved.type).toBe(ValueType.Number);
		const deposit = solved.toNumber();
		expect(deposit).toBeGreaterThan(0);

		const engine = newTrackedEngine();
		const check = engine.evaluateExpression(`monthly repayment on ${deposit} over 25 years at 4%`);
		expect(check.toNumber()).toBeCloseTo(900, 3);
	});
});

describe("bounded execution — a search can never spin", () => {
	test("a target below what any input can reach is reported, not searched forever", () => {
		// The 0% repayment is principal / months = 666.67, so no rate produces a
		// repayment of 500. There is no crossing to find, and goal seek says so.
		const doc = solveDoc([
			":rate = 5%",
			"monthly repayment on 200000 over 25 years at rate",
			"solve line 2 for rate = 500",
		]);
		const solved = lineResult(doc, 3);
		expect(solved.type).toBe(ValueType.Error);
		expect(solved.value).toBe("GOAL_SEEK_NO_SOLUTION");
	});

	test("a discontinuous relationship gives up rather than halving a point forever", () => {
		// floor(x) never equals 2.5: it jumps from 2 to 3 across x = 3. Bisection
		// brackets the jump but can never land on the value, so it stops when the
		// interval collapses instead of looping.
		const doc = solveDoc([":x = 0", "floor(x)", "solve line 2 for x = 2.5"]);
		const solved = lineResult(doc, 3);
		expect(solved.type).toBe(ValueType.Error);
		expect(solved.value).toBe("GOAL_SEEK_DID_NOT_CONVERGE");
	});

	test("the hard iteration cap is enforced, so a low cap errors rather than looping", () => {
		// Two bisection steps cannot resolve a rate to the target's tolerance, so
		// a search capped at two steps must end in a structured error. This also
		// proves the cap is read from config.vm.maxGoalSeekIterations.
		const doc = solveDoc(
			[
				":rate = 5%",
				"monthly repayment on 200000 over 25 years at rate",
				"solve line 2 for rate = 1200",
			],
			{ vm: { maxGoalSeekIterations: 2 } },
		);
		const solved = lineResult(doc, 3);
		expect(solved.type).toBe(ValueType.Error);
		expect(solved.value).toBe("GOAL_SEEK_DID_NOT_CONVERGE");
	});
});

describe("guards", () => {
	test("goal seek outside a document errors cleanly rather than crashing", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("solve line 2 for x = 30");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("GOAL_SEEK_NO_DOCUMENT");
	});

	test("targeting a line that does not use the variable is refused up front", () => {
		// Line 2 does not read x, so changing x could never move its result. Said
		// plainly rather than searched into a confusing "no solution".
		const doc = solveDoc([":x = 0", "5 + 3", "solve line 2 for x = 10"]);
		const solved = lineResult(doc, 3);
		expect(solved.type).toBe(ValueType.Error);
		expect(solved.value).toBe("GOAL_SEEK_VARIABLE_NOT_USED");
	});

	test("a forward reference to a not-yet-evaluated line is refused", () => {
		// Lines evaluate in ascending order, so when line 1 runs, line 3 has no
		// result yet. Goal seek reports that rather than solving against nothing.
		const doc = solveDoc(["solve line 3 for x = 10", ":x = 0", "x * 2"]);
		const solved = lineResult(doc, 1);
		expect(solved.type).toBe(ValueType.Error);
		expect(solved.value).toBe("GOAL_SEEK_LINE_NOT_READY");
	});

	test("a variable-definition target line is refused, since re-running it would overwrite the variable", () => {
		const doc = solveDoc([":x = 0", ":y = x * 2 + 10", "solve line 2 for x = 30"]);
		const solved = lineResult(doc, 3);
		expect(solved.type).toBe(ValueType.Error);
		expect(solved.value).toBe("GOAL_SEEK_TARGET_IS_DEFINITION");
	});
});

describe("what must keep working", () => {
	test("the existing solve(...) algebra verb still inverts a closed-form equation", () => {
		// `solve` before a `(` is still the symbolic solver, untouched by the
		// goal-seek rule, which only fires on `solve` before a line reference.
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("solve(2x+6=0, x)").toNumber()).toBe(-3);
	});

	test("solve(...) returning several roots is unaffected", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("solve(x^2-4=0, x)");
		expect(value.type).not.toBe(ValueType.Error);
	});

	test("line references still resolve with goal seek registered", () => {
		const doc = solveDoc(["42", "line1 + 8"]);
		expect(lineResult(doc, 2).toNumber()).toBe(50);
	});

	test("solve stays usable as an ordinary variable name", () => {
		// `:solve = 7` then `solve + 3`: the word is not before a line reference,
		// so it stays a variable and the goal-seek rule never touches it.
		const doc = solveDoc([":solve = 7", "solve + 3"]);
		expect(lineResult(doc, 2).toNumber()).toBe(10);
	});
});
