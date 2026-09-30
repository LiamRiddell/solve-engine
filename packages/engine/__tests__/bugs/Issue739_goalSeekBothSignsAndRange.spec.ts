import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { Value, ValueType, errorValue, numberValue, stringValue, uomValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import {
	goalSeekHandler,
	readGoalSeekRange,
	scanGrid,
	solveClosedForm,
	GOAL_SEEK_SEARCH_LIMIT,
	GOAL_SEEK_SCAN_SAMPLES,
} from "@solve-js/packages/goalseek/GoalSeekPluginFunctions";
import { varNode, constNode, rational, type SymbolicNode } from "@solve-js/symbolic";

/**
 * Issue #739: goal seek searched only positive inputs from 1e-9 to 1e9, so a
 * target only a negative input reaches had no solution, and a line that is not
 * finite at the top of that range (`2^x`) could not be driven to 4, because the
 * first non-finite sample was returned as the answer.
 *
 * It now searches both signs, treats a sample that fails or is not finite as a
 * gap, searches a symbolic reading the way `solve(...)` does, reports every
 * crossing rather than picking one, and takes a stated range:
 * `solve line 2 for x = 4 between 0 and 10`.
 *
 * Beside it, in the same area: `how much per month to reach $10,000 over 2
 * years` is read as `in 2 years` is.
 */

function incremental(lines: string[], config?: object): string[] {
	const engine = newTrackedEngine(config ? { config } : {});
	return evaluateDocument(engine, lines.join("\n"), { inputType: "markdown" }).lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
	});
}

function last(lines: string[], config?: object): string {
	return incremental(lines, config).slice(-1)[0]!;
}

/**
 * A context whose probe runs `f` on the bound value, as the engine's does on
 * the target line: a symbolic binding answers `symbolic` (an error by default,
 * which sends the search to the scan), a numeric one `f(x)`.
 */
function contextFor(f: (x: number) => Value, options: { symbolic?: Value; maxIterations?: number; unknown?: Value } = {}): LineExecutionContext & { probes: number[] } {
	const probes: number[] = [];
	return {
		lineIndex: 3,
		probes,
		getLineReads: () => ["x"],
		getLineResult: () => numberValue(0),
		getVariable: () => options.unknown ?? numberValue(1),
		goalSeekMaxIterations: options.maxIterations ?? 100,
		evaluateLineWithBinding: (_line: number, _variable: string, bound: Value, symbolicTolerant: boolean) => {
			if (symbolicTolerant) return options.symbolic ?? errorValue("SYMBOLIC_UNSUPPORTED_FUNCTION", "no symbolic reading");
			const x = bound.toNumber();
			probes.push(x);
			return f(x);
		},
	} as unknown as LineExecutionContext & { probes: number[] };
}

function seek(target: number, context: LineExecutionContext, range?: [Value, Value]): Value {
	const args = [numberValue(2), stringValue("x"), numberValue(target)];
	if (range) args.push(range[0], range[1]);
	return goalSeekHandler(args, context);
}

describe("the issue's documents", () => {
	test("a target only a negative input reaches", () => {
		expect(incremental(["x = 1", "x + sin(x)", "solve line 2 for x = -2", "solve line 2 for x = 3"])).toEqual(["1", "1.84", "-1.11", "2.18"]);
	});

	test("2^x reaches 0.25 and 4", () => {
		expect(incremental(["x = 1", "2^x", "solve line 2 for x = 0.25", "solve line 2 for x = 4"])).toEqual(["1", "2", "-2", "2"]);
	});

	test("the answers agree with solve(...)", () => {
		const engine = newTrackedEngine();
		expect(formatValue(engine.evaluateExpression("solve(x + sin(x) = -2, x)"))).toBe("= -1.11");
		expect(formatValue(engine.evaluateExpression("solve(2^x = 0.25, x)"))).toBe("= -2");
	});
});

describe("several crossings are reported, as solve(...) reports them", () => {
	test("two and three roots", () => {
		expect(last(["x = 1", "x^2", "solve line 2 for x = 4"])).toBe("[-2, 2]");
		expect(last(["x = 1", "x^3 - x", "solve line 2 for x = 0"])).toBe("[-1, 0, 1]");
	});

	test("a stated range chooses among them", () => {
		expect(last(["x = 1", "x^2", "solve line 2 for x = 4 between 0 and 10"])).toBe("2");
		expect(last(["x = 1", "x^2", "solve line 2 for x = 4 between -10 and 0"])).toBe("-2");
		expect(last(["x = 1", "x^2", "solve line 2 for x = 4 between 10 and 0"])).toBe("2");
	});

	test("a line that repeats is declined rather than listed, and a range narrows it", () => {
		expect(last(["x = 1", "sin(x)", "solve line 2 for x = 0.5"])).toMatch(/^ERROR More than 10 values of x between -1000000 and 1000000 make line 2 equal 0.5/);
		expect(last(["x = 1", "sin(x)", "solve line 2 for x = 0.5 between 0 and 3"])).toBe("[0.52, 2.62]");
	});

	test("an unknown in a unit with several answers names each one", () => {
		// A list does not carry a unit, so the values are named instead.
		expect(last([":p = 5 km", "p * p / 1 km", "solve line 2 for p = 4 km"])).toBe('ERROR 2 values of p make line 2 equal 4: -2.00 km, 2.00 km. Name a range after the target to choose one, as in "solve line 2 for p = 4 between 0 and 4".');
		expect(last([":p = 5 km", "p * p / 1 km", "solve line 2 for p = 4 km between 0 and 4"])).toBe("2.00 km");
	});
});

describe("a stated range", () => {
	test("that excludes the root is no solution in that range", () => {
		expect(last(["x = 1", "x^2", "solve line 2 for x = 4 between 5 and 10"])).toBe("ERROR No value of x between 5 and 10 was found that makes line 2 equal 4: none of the values that make it so lies in that range.");
		expect(last(["x = 1", "x + sin(x)", "solve line 2 for x = -2 between 0 and 10"])).toMatch(/^ERROR No value of x between 0 and 10 was found/);
	});

	test("reaches past the default", () => {
		expect(last(["x = 1", "x * 2", "solve line 2 for x = 6e9 between 0 and 1e10"])).toBe("3,000,000,000");
	});

	test("in the unknown's unit, or another unit of its measure", () => {
		expect(last([":d = 5 km", "d * 2", "solve line 2 for d = 3000 m between 0 km and 10 km"])).toBe("1.50 km");
		expect(last([":d = 5 km", "d * 2", "solve line 2 for d = 3000 m between 0 m and 10000 m"])).toBe("1.50 km");
		expect(last([":d = 5 km", "d * 2", "solve line 2 for d = 3000 m between 0 kg and 1 kg"])).toBe("ERROR The unknown is in km and the range is in kg, so the range cannot be read. Write the range in km.");
	});

	test("that is not two different finite numbers is refused by name", () => {
		expect(last(["x = 1", "x * 3", "solve line 2 for x = 6 between 5 and 5"])).toBe("ERROR Goal seek's range must have two different ends.");
		expect(last(["x = 1", "x * 3", 'solve line 2 for x = 6 between "a" and 5'])).toBe('ERROR Goal seek\'s range needs two numbers, as in "between 0 and 100".');
		expect(last(["x = 1", "x * 3", "solve line 2 for x = 6 between 0 and 1/0"])).toBe("ERROR Goal seek's range must have two finite ends.");
	});

	test("with only one end is a parse error that shows the form", () => {
		expect(last(["x = 1", "x * 3", "solve line 2 for x = 6 between 1"])).toBe('ERROR Goal seek\'s range reads "between <low> and <high>", for example "solve line 4 for rate = 900 between 0 and 1".');
	});
});

describe("the issue's adversarial shapes", () => {
	test("a pole, 1/x, is no root at zero", () => {
		expect(last(["x = 1", "1/x", "solve line 2 for x = 0"])).toMatch(/^ERROR No value of x between -1000000000 and 1000000000 was found that makes line 2 equal 0/);
		expect(last(["x = 1", "1/x", "solve line 2 for x = 2"])).toBe("0.50");
		expect(last(["x = 1", "1/x", "solve line 2 for x = -4"])).toBe("-0.25");
	});

	test("a repayment on a negative deposit is a gap, and the positive answer is found", () => {
		expect(incremental([":deposit = 100000", ":rate = 4%", "monthly repayment on deposit over 25 years at rate", "solve line 3 for deposit = 900"]).slice(-1)[0]).toBe("170,507.23");
		// A rate held as a percentage is solved as one (it was the bare 0.05); see FoundBug_goalSeekLoanRefusals.
		expect(incremental([":deposit = 100000", ":rate = 4%", "monthly repayment on deposit over 25 years at rate", "solve line 3 for rate = 600"]).slice(-1)[0]).toBe("5.26%");
	});

	test("a target reached at zero", () => {
		expect(last(["x = 1", "x * 3", "solve line 2 for x = 0"])).toBe("0");
		expect(last(["x = 1", "abs(x) * 0 + x", "solve line 2 for x = 0"])).toBe("0");
	});

	test("a jump across the target is named as one", () => {
		expect(last([":x = 0", "floor(x)", "solve line 2 for x = 2.5"])).toBe("ERROR Goal seek narrowed x to a single point near 3 without line 2 reaching 2.5: the relationship jumps across the target rather than passing through it.");
	});

	test("a line that is non-finite across the whole range", () => {
		const context = contextFor(() => numberValue(Infinity));
		const out = seek(1, context);
		expect(out.errorCode).toBe("GOAL_SEEK_NON_FINITE");
		expect(out.errorMessage).toBe("Line 2's result is not finite for any value of x goal seek tried between -1000000000 and 1000000000.");
	});

	test("a line that fails for every input answers with its own failure", () => {
		const out = seek(1, contextFor(() => errorValue("INVALID_RATE", "loanRepayment: principal must be positive")));
		expect(out.errorMessage).toBe("loanRepayment: principal must be positive");
	});

	test("a target no input reaches is no solution, with a hint to name a range", () => {
		expect(last([":rate = 5%", "monthly repayment on 200000 over 25 years at rate", "solve line 2 for rate = 500"])).toMatch(/^ERROR No value of rate between -1000000000 and 1000000000 was found .* name a range after the target/);
	});
});

describe("across the entry points", () => {
	test("the batch pass and the single line still refuse", () => {
		const engine = newTrackedEngine();
		const batch = engine.parseDocument("x = 1\n2^x\nsolve line 2 for x = 4 between 0 and 10", { inputType: "markdown" });
		expect(batch.lines[2].result?.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
		const single = newTrackedEngine().evaluateLine(1, "solve line 2 for x = 4 between 0 and 10");
		expect(single.type).toBe(ValueType.Error);
		expect(single.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
	});
});

describe("goalSeekHandler over a scan of the line", () => {
	test("both signs are searched, and the probes stay inside the cap", () => {
		const context = contextFor((x) => numberValue(x * x * x));
		const out = seek(-8, context);
		expect(out.toNumber()).toBeCloseTo(-2, 6);
		expect(context.probes.length).toBeLessThanOrEqual(100);
		expect(context.probes.some((x) => x < 0)).toBe(true);
	});

	test("two crossings are both reported", () => {
		const out = seek(0, contextFor((x) => numberValue((x - 3) * (x + 5))));
		expect(out.type).toBe(ValueType.Matrix);
		// Found by narrowing, so to within the tolerance rather than exactly.
		expect(formatValue(out)).toBe("= [-5.00, 3.00]");
	});

	test("a gap next to the root is passed over, not answered", () => {
		// Refused below zero, a crossing at 4 above it.
		const out = seek(2, contextFor((x) => (x < 0 ? errorValue("INVALID_RATE", "negative") : numberValue(Math.sqrt(x)))));
		expect(out.toNumber()).toBeCloseTo(4, 6);
	});

	test("a cap too low to finish ends in a named refusal, never a guess", () => {
		const context = contextFor((x) => numberValue(Math.exp(x / 1e8) * 3 - 7.25), { maxIterations: 4 });
		const out = seek(0, context);
		expect(out.errorCode).toBe("GOAL_SEEK_DID_NOT_CONVERGE");
		expect(context.probes.length).toBeLessThanOrEqual(4);
	});

	test("a cap of one, zero or a negative number still probes and stops", () => {
		for (const cap of [1, 0, -5, Number.NaN]) {
			const context = contextFor((x) => numberValue(x), { maxIterations: cap });
			const out = seek(0.3, context);
			expect(out.type).toBe(ValueType.Error);
			expect(context.probes.length).toBeLessThanOrEqual(3);
		}
	});

	test("a refusal about the pass ends the search at once", () => {
		const context = contextFor(() => errorValue("PASS_WORK_BUDGET_EXCEEDED", "budget"));
		const out = seek(1, context);
		expect(out.errorCode).toBe("PASS_WORK_BUDGET_EXCEEDED");
		expect(context.probes.length).toBe(1);
	});

	test("a pending answer ends the search by name", () => {
		const context = contextFor(() => new Value(ValueType.Pending, "q"));
		expect(seek(1, context).errorCode).toBe("GOAL_SEEK_ASYNC_UNSUPPORTED");
	});

	test("a line that answers text is a gap, named if it is the only answer", () => {
		expect(seek(1, contextFor(() => stringValue("hello"))).errorCode).toBe("GOAL_SEEK_TARGET_NOT_NUMERIC");
	});

	test("an unknown in money with several answers names each in its currency", () => {
		const context = contextFor((x) => numberValue(x * x), { unknown: uomValue(5, "GBP") });
		const out = seek(400, context);
		expect(out.errorCode).toBe("GOAL_SEEK_SEVERAL_SOLUTIONS");
		expect(out.errorMessage).toContain("-£20.00, £20.00");
	});

	test("the ends of the default range do not count as reaching a target they only approach", () => {
		const out = seek(0, contextFor((x) => numberValue(x === 0 ? Infinity : 1 / x)));
		expect(out.errorCode).toBe("GOAL_SEEK_NO_SOLUTION");
	});

	test("the largest and smallest doubles as a target", () => {
		expect(seek(Number.MAX_VALUE, contextFor((x) => numberValue(x))).type).toBe(ValueType.Error);
		const tiny = seek(Number.MIN_VALUE, contextFor((x) => numberValue(x)));
		expect(tiny.type === ValueType.Error || Math.abs(tiny.toNumber()) < 1e-8).toBe(true);
	});

	test("a closed form is checked against the line, and the scan decides when the line disagrees", () => {
		// The reading says x^2, but the line refuses to run: its own refusal is the answer.
		const x: SymbolicNode = varNode("x");
		const squared = new Value(ValueType.Symbolic, { kind: "pow", base: x, exponent: constNode(rational(2n)) } as SymbolicNode);
		const out = seek(4, contextFor(() => errorValue("UNIT_POWER", "cannot square money"), { symbolic: squared }));
		expect(out.errorMessage).toBe("cannot square money");
	});
});

describe("readGoalSeekRange", () => {
	test("two plain numbers, in either order", () => {
		expect(readGoalSeekRange(numberValue(0), numberValue(10), undefined)).toEqual({ lower: 0, upper: 10 });
		expect(readGoalSeekRange(numberValue(10), numberValue(-10), undefined)).toEqual({ lower: -10, upper: 10 });
		expect(readGoalSeekRange(numberValue(-0), numberValue(1), undefined)).toEqual({ lower: -0, upper: 1 });
	});

	test("a quantity is read in the unknown's unit", () => {
		expect(readGoalSeekRange(uomValue(0, "m"), uomValue(2000, "m"), "km")).toEqual({ lower: 0, upper: 2 });
		expect(readGoalSeekRange(uomValue(1, "GBP"), uomValue(2, "GBP"), "GBP")).toEqual({ lower: 1, upper: 2 });
	});

	test("another measure or another currency is refused", () => {
		expect((readGoalSeekRange(uomValue(0, "kg"), uomValue(1, "kg"), "km") as Value).errorCode).toBe("GOAL_SEEK_RANGE_INVALID");
		expect((readGoalSeekRange(uomValue(0, "USD"), uomValue(1, "USD"), "GBP") as Value).errorCode).toBe("GOAL_SEEK_RANGE_INVALID");
	});

	test("equal, infinite, NaN and non-numeric ends are refused", () => {
		for (const [a, b] of [[numberValue(1), numberValue(1)], [numberValue(0), numberValue(Infinity)], [numberValue(Number.NaN), numberValue(1)], [stringValue("a"), numberValue(1)]]) {
			expect((readGoalSeekRange(a, b, undefined) as Value).errorCode).toBe("GOAL_SEEK_RANGE_INVALID");
		}
	});

	test("a failed end passes its own error on", () => {
		const failed = errorValue("SOME_CODE", "failed");
		expect(readGoalSeekRange(failed, numberValue(1), undefined)).toBe(failed);
	});

	test("the largest doubles are finite ends", () => {
		expect(readGoalSeekRange(numberValue(-Number.MAX_VALUE), numberValue(Number.MAX_VALUE), undefined)).toEqual({ lower: -Number.MAX_VALUE, upper: Number.MAX_VALUE });
	});
});

describe("scanGrid", () => {
	test("the default range is both signs, with zero and both ends exact", () => {
		const xs = scanGrid({ lower: -GOAL_SEEK_SEARCH_LIMIT, upper: GOAL_SEEK_SEARCH_LIMIT }, false, GOAL_SEEK_SCAN_SAMPLES);
		expect(xs.length).toBe(GOAL_SEEK_SCAN_SAMPLES);
		expect(xs[0]).toBe(-GOAL_SEEK_SEARCH_LIMIT);
		expect(xs.slice(-1)[0]).toBe(GOAL_SEEK_SEARCH_LIMIT);
		expect(xs).toContain(0);
		for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
		// Dense near zero: several samples inside plus or minus ten.
		expect(xs.filter((x) => Math.abs(x) < 10).length).toBeGreaterThan(4);
	});

	test("a stated range is even, ends exact", () => {
		expect(scanGrid({ lower: 0, upper: 10 }, true, 11)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	test("at least three samples, whatever is asked", () => {
		expect(scanGrid({ lower: 0, upper: 1 }, true, 0).length).toBe(3);
		expect(scanGrid({ lower: 0, upper: 1 }, true, Number.NaN).length).toBe(3);
		expect(scanGrid({ lower: 0, upper: 1 }, true, -4).length).toBe(3);
	});

	test("a range on one side of zero does not gain a zero", () => {
		expect(scanGrid({ lower: 1, upper: 100 }, false, 10)).not.toContain(0);
	});
});

describe("solveClosedForm", () => {
	const x: SymbolicNode = varNode("x");

	test("a linear line has one root, a quadratic both", () => {
		expect(solveClosedForm({ kind: "mul", left: constNode(rational(2n)), right: x }, 6, "x")).toEqual([3]);
		expect(solveClosedForm({ kind: "pow", base: x, exponent: constNode(rational(2n)) }, 9, "x")?.sort((a, b) => a - b)).toEqual([-3, 3]);
	});

	test("no real root, or no closed form, is null", () => {
		expect(solveClosedForm({ kind: "pow", base: x, exponent: constNode(rational(2n)) }, -1, "x")).toBeNull();
		expect(solveClosedForm({ kind: "call", name: "sin", args: [x] }, 0.5, "x")).toBeNull();
	});

	test("a prototype-named unknown is only a name", () => {
		expect(solveClosedForm({ kind: "mul", left: constNode(rational(2n)), right: varNode("__proto__") }, 6, "__proto__")).toEqual([3]);
	});
});

describe("a unit straight after a number is that quantity's, before between", () => {
	// `3000 m between 0 and 10` used to fuse `m between` into "minutes
	// between", the date-difference form, so a range after a target in metres
	// failed to parse.
	test("the date-difference form still reads at the start of an expression", () => {
		const engine = newTrackedEngine();
		expect(formatValue(engine.evaluateExpression("days between 2026-01-01 and 2026-01-11"))).toBe(formatValue(engine.evaluateExpression("how many days between 2026-01-01 and 2026-01-11")));
		expect(formatValue(engine.evaluateExpression("days between 2026-01-01 and 2026-01-11"))).toMatch(/^= 10/);
	});

	test("a target in metres or in days takes a range", () => {
		expect(last([":d = 5 km", "d * 2", "solve line 2 for d = 3000 m between 0 and 10"])).toBe("1.50 km");
		expect(last([":t = 1 day", "t * 2", "solve line 2 for t = 6 days between 0 and 10"])).toMatch(/^3(\.00)? days$/);
	});
});

describe("the savings goal reads over as it reads in", () => {
	test.each([
		["how much per month to reach $10,000 over 2 years", "$416.67"],
		["how much per month to reach $10,000 in 2 years", "$416.67"],
		["how much per month to reach $10,000 over 2 years at 5%", "$397.05"],
		["how much per month to save $10,000 over 24 months", "$416.67"],
	])("%s", (line, answer) => {
		expect(formatValue(newTrackedEngine().evaluateExpression(line))).toBe(`= ${answer}`);
	});

	test("another word, or none, is refused with the form", () => {
		for (const line of ["how much per month to reach $10,000 for 2 years", "how much per month to reach $10,000"]) {
			expect(() => newTrackedEngine().evaluateExpression(line)).toThrow(/^Expected "in" or "over" and a duration after the target/);
		}
	});

	test("both document passes agree", () => {
		expectHonestDocument("how much per month to reach $10,000 over 2 years\nprev * 24");
	});
});

describe("adversarial", () => {
	test("prototype words as the unknown and in the range", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestDocument(`${word} = 1\n${word} * 2\nsolve line 2 for ${word} = 6 between -10 and 10`, { agree: false });
				expectHonestDocument(`x = 1\nx * 2\nsolve line 2 for x = 6 between ${word} and 10`, { agree: false });
			}
		});
	});

	test("a huge range and a huge target stay within the cap", () => {
		const started = performance.now();
		expect(last(["x = 1", "x * 2", "solve line 2 for x = 1e300 between -1e308 and 1e308"])).toMatch(/^[\d,.e+]+$|^ERROR/);
		expect(last(["x = 1", "exp(x)", "solve line 2 for x = 1e300"])).toMatch(/^690\.78$|^ERROR/);
		expect(performance.now() - started).toBeLessThan(5_000);
	});

	test("a goal seek meeting a what-if, a check and a tag", () => {
		expectHonestDocument(":x = 1\n2^x\nsolve line 2 for x = 4 between 0 and 10\ncheck prev > 1", { agree: false });
		expectHonestDocument(":x = 1\n2^x #growth\nsolve line 2 for x = 4", { agree: false });
	});

	test("an edited range through the live path is re-read", () => {
		const first = last(["x = 1", "x^2", "solve line 2 for x = 4 between 0 and 10"]);
		const second = last(["x = 1", "x^2", "solve line 2 for x = 4 between -10 and 0"]);
		expect([first, second]).toEqual(["2", "-2"]);
	});

	test("the edge numbers as the target", () => {
		for (const target of ["0", "-0", "-1", "0.5", "1/3", "2^53", "1e308", "-1e308", "1e-320"]) {
			expectHonestDocument(`x = 1\nx * 3\nsolve line 2 for x = ${target}`, { agree: false });
		}
		expect(last(["x = 1", "x * 3", "solve line 2 for x = 1/0"])).toBe("ERROR Goal seek's target is not a finite number.");
	});
});
