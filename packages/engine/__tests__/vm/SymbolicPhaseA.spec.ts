/**
 * The three silent wrong answers Phase A exists to fix, exercised end to end
 * through the real engine rather than against the simplifier directly.
 *
 * Each of these previously returned a confident, wrong, error-free result,
 * because `Value.toNumber()` reports `0` for a symbolic operand and the EXP,
 * NEG and CALL_BUILTIN opcodes all read it without checking.
 */
import { describe, expect, test } from "@jest/globals";
import { ValueType } from "@solve-js/vm/Value";
import { formatSymbolic, type SymbolicNode } from "@solve-js/symbolic";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluates one line and renders the result the way a user would see it. */
function evaluate(line: string): string {
	const engine = newTrackedEngine();
	try {
		const [value] = engine.evaluateLine(1, line);
		if (value.type === ValueType.Symbolic) return formatSymbolic(value.value as SymbolicNode);
		if (value.type === ValueType.Error) return String(value.value);
		return String(value.toNumber());
	} finally {
		engine.clear();
	}
}

describe("Phase A regressions: a symbolic operand no longer collapses to zero", () => {
	test("x^2 keeps its exponent instead of folding to 0 (returned 3x+2)", () => {
		expect(evaluate("x^2+3x+2 =>")).toBe("x^2+3x+2");
	});

	test("pow(x, 2) builds the same tree as x^2, so both render identically", () => {
		expect(evaluate("pow(x,2) =>")).toBe("x^2");
	});

	test("unary minus on a free variable stays symbolic (returned -0)", () => {
		expect(evaluate("-x =>")).toBe("-x");
	});

	test("a builtin carries through symbolically (returned 0)", () => {
		expect(evaluate("sqrt(x) =>")).toBe("sqrt(x)");
	});

	test("a builtin with an exact rational answer still folds", () => {
		expect(evaluate("sqrt(4)+x =>")).toBe("x+2");
	});

	test("a builtin with a concrete argument still evaluates numerically", () => {
		// Nothing symbolic reaches the call, so this is an ordinary numeric
		// builtin. What matters is that the irrational result renders as a
		// readable decimal rather than as its exact 17-digit fraction.
		expect(evaluate("sqrt(2)+x =>")).toBe("x+1.4142135624");
	});

	test("a builtin with no symbolic reading reports that, rather than computing against zero", () => {
		// `clz32` rather than `random`, which used to stand here: `random` takes
		// no arguments at all, so `random(x)` is now caught by the arity check
		// at the CALL_BUILTIN dispatch and never reaches the symbolic routing
		// this test is about. `clz32` takes one argument and has no symbolic
		// reading, which is the shape the test wants.
		expect(evaluate("clz32(x) =>")).toBe("SYMBOLIC_UNSUPPORTED_FUNCTION");
	});
});

describe("Phase A: every public entry point agrees", () => {
	// The `=>` grammar has form shipped correct on one path and dead on another
	// before (which is why PipelineConsistency.spec.ts exists), and the playground
	// reaches the engine through evaluateLineWithDebug rather than evaluateLine.
	// A fix that lands on only one of these is the exact failure mode to catch.
	const LINE = "x^2+7x+11 =>";
	const EXPECTED = "x^2+7x+11";

	/** Renders whatever a path produced, so the three are compared as the user would see them. */
	function render(value: { type: number; value: unknown }): string {
		return value.type === ValueType.Symbolic ? formatSymbolic(value.value as SymbolicNode) : String(value.value);
	}

	test("evaluateLine", () => {
		const engine = newTrackedEngine();
		try {
			expect(render(engine.evaluateLine(1, LINE)[0])).toBe(EXPECTED);
		} finally {
			engine.clear();
		}
	});

	test("evaluateLineWithDebug, the path the playground uses", () => {
		const engine = newTrackedEngine();
		try {
			expect(render(engine.evaluateLineWithDebug(1, LINE).value)).toBe(EXPECTED);
		} finally {
			engine.clear();
		}
	});

	test("evaluateLines, the lean pre-tokenized path", () => {
		const engine = newTrackedEngine();
		try {
			const parsed = engine.evaluateLines([LINE]);
			expect(render(parsed[0].result!)).toBe(EXPECTED);
		} finally {
			engine.clear();
		}
	});
});

describe("Phase A: exact rational coefficients", () => {
	test("exponent arithmetic on constants folds exactly", () => {
		expect(evaluate("2^10 + x =>")).toBe("x+1024");
	});

	test("a division written in symbolic space stays an exact quotient", () => {
		expect(evaluate("x/3 =>")).toBe("x/3");
	});

	test("a purely numeric subexpression is still computed numerically first", () => {
		// `(1/3)` has two number operands, so the VM's ordinary DIV runs and
		// produces a double before anything symbolic is involved. Exactness is a
		// property of the symbolic domain, not a retrofit onto arithmetic that
		// already happened. Worth pinning: it is the boundary that explains why
		// `x/3` and `x*(1/3)` do not render alike.
		expect(evaluate("x*(1/3) =>")).toBe("0.3333333333x");
	});

	test("a decimal coefficient converts by its written form, not its IEEE expansion", () => {
		// 0.1 as a double is 3602879701896397/36028797018963968. Reading it
		// through the decimal string instead gives the 1/10 the user wrote, so
		// the coefficient prints back as typed.
		expect(evaluate("x*0.1 =>")).toBe("0.1x");
	});

	test("collecting through a product combines exactly, with no floating-point drift", () => {
		// The headline case for exact coefficients. In doubles 0.1 + 0.2 is
		// 0.30000000000000004, so this is the assertion that would expose a
		// regression back to float arithmetic.
		expect(evaluate("0.1x + 0.2x =>")).toBe("0.3x");
	});
});
