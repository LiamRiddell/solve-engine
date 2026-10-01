import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, RESOURCE_PROBES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { Value, ValueType, numberValue, stringValue, symbolicValue, uomValue, errorValue, datetimeValue, percentageValue } from "@solve-js/vm/Value";
import { resolveStoredFormula, resolveStoredFormulaIn, formulaCannotTake, STORED_FORMULA_MAX_DEPTH } from "@solve-js/vm/StoredFormula";
import { type SymbolicNode, constNode, varNode, rational, substituteAll, freeVariables, nodeCount } from "@solve-js/symbolic";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Issue #732: a name assigned a formula before its unknown had a value
 * (`y = x + 1` above `x = 5`) was read unchanged below the definition of `x`,
 * so `y + x` held `x` as 5 in one term and as an unknown in the other and gave
 * `x+6`. A stored formula is now read with the values its unknowns hold at the
 * reading line, so the document answers 11, as it does with the lines in the
 * other order.
 */

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
	});
}

function batch(lines: string[]): string[] {
	return read(newTrackedEngine().parseDocument(lines.join("\n"), { inputType: "markdown" }));
}

function incremental(lines: string[]): string[] {
	return read(evaluateDocument(newTrackedEngine(), lines.join("\n"), { inputType: "markdown" }));
}

/** Both document passes, asserted to agree, as one answer list. */
function both(lines: string[]): string[] {
	const answer = batch(lines);
	expect(incremental(lines)).toEqual(answer);
	return answer;
}

/** A live evaluator's answers after editing one line, the way an editor does on a keystroke. */
function afterEdit(lines: string[], lineNumber: number, text: string): string[] {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	try {
		evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		doc.editLine(lineNumber, text);
		const pass = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		return pass.lines.map((line) => {
			if (line.error) return `ERROR ${line.error}`;
			if (!line.result) return "";
			const shown = formatValue(line.result).replace(/^=\s*/, "");
			return line.result.type === ValueType.Error ? `ERROR ${shown}` : shown;
		});
	} finally {
		evaluator.terminateWorker();
	}
}

const x: SymbolicNode = varNode("x");
const plus = (left: SymbolicNode, right: SymbolicNode): SymbolicNode => ({ kind: "add", left, right });
const times = (left: SymbolicNode, right: SymbolicNode): SymbolicNode => ({ kind: "mul", left, right });
const num = (n: number): SymbolicNode => constNode(rational(BigInt(n)));

describe("the reported documents", () => {
	test.each([
		[["y = x + 1", "x = 5", "y + x"], ["x+1", "5", "11"]],
		[["y = x + 1", "x = 5", "y"], ["x+1", "5", "6"]],
		[["y = x + 1", "x = 5", "y * 2"], ["x+1", "5", "12"]],
		[["y = x + 1", "x = 5", "z = y + x", "z"], ["x+1", "5", "11", "11"]],
		[["y = a * 2", "a = 3", "y + a"], ["2a", "3", "9"]],
		[["x = 5", "y = x + 1", "y + x"], ["5", "6", "11"]],
	])("%j", (lines, answers) => {
		expect(both(lines)).toEqual(answers);
	});

	test("a second pass on the same engine gives the answer the first now gives", () => {
		const engine = newTrackedEngine();
		const text = "y = x + 1\nx = 5\ny + x";
		expect(read(engine.parseDocument(text, { inputType: "markdown" }))[2]).toBe("11");
		expect(read(engine.parseDocument(text, { inputType: "markdown" }))[2]).toBe("11");
	});
});

describe("what it must not break", () => {
	test("the defining line still shows the formula", () => {
		expect(both(["y = x + 1", "x = 5"])).toEqual(["x+1", "5"]);
	});

	test("a name nothing above the reading line defines stays symbolic", () => {
		expect(both(["y = x + 1", "y * 2"])).toEqual(["x+1", "2(x+1)"]);
		// A line that is not an assignment reads an undefined name as undefined, as before.
		expect(both(["y = x + 1", "y + x"])).toEqual(["x+1", "ERROR Undefined variable: x"]);
	});

	test("a reading line above the later definition keeps the formula", () => {
		expect(both(["y = x + 1", "y + 1", "x = 5", "y + 1"])).toEqual(["x+1", "x+2", "5", "7"]);
	});

	test("a => line keeps its unknowns symbolic", () => {
		expect(both(["1+2+b+3+b =>"])).toEqual(["2*b+6"]);
	});

	test("a stored equation read by a solve keeps its behaviour", () => {
		expect(both([":a = 2", "x =>", "a * x = 20"])).toEqual(["2", "x", 'x stored as an equation: solve with "x =>"']);
	});

	test("a name defined twice is read with the value it holds at the reading line", () => {
		expect(both(["y = x + 1", "x = 5", "y", "x = 10", "y"])).toEqual(["x+1", "5", "6", "10", "11"]);
	});
});

describe("the reading follows every kind of formula", () => {
	test.each([
		[["y = sin(x)", "x = 0", "y"], "0"],
		[["y = sin(x)", "x = 5", "y"], "-0.96"],
		[["y = x / 3", "x = 1", "y"], "0.33"],
		[["y = x^2 - x", "x = 3", "y"], "6"],
		[["y = sqrt(x)", "x = 9", "y"], "3"],
		[["y = sqrt(x)", "x = -1", "y"], "i"],
		[["y = x + z", "x = 5", "y"], "z+5"],
		[["y = x + z", "x = 5", "z = 1", "y"], "6"],
	])("%j", (lines, answer) => {
		expect(both(lines).slice(-1)[0]).toBe(answer);
	});

	test("a chain of formulas defined in reverse order resolves", () => {
		expect(both(["y = x + 1", "x = z * 2", "z = 3", "y", "x"])).toEqual(["x+1", "2z", "3", "7", "6"]);
	});

	test("a circular pair stays as it is", () => {
		expect(both(["y = x + 1", "x = y * 2", "y"])).toEqual(["x+1", "2(x+1)", "x+1"]);
		expect(both(["y = y + 1", "y"])).toEqual(["y+1", "y+1"]);
	});
});

describe("a value a formula cannot take is refused by name", () => {
	test.each([
		[["y = x + 1", "x = $5", "y + x"], "money"],
		[["y = x + 1", "x = 5 km", "y"], "a length"],
		[["y = x * 2", "x = 5%", "y"], "a percentage"],
		[["y = x * 2", 'x = "five"', "y"], "text"],
	])("%j", (lines, kind) => {
		const last = both(lines).slice(-1)[0]!;
		expect(last).toBe(`ERROR y was written as a formula in x before x had a value, and x now holds ${kind}, which the formula cannot take. Define x above the line that defines y.`);
	});

	test("the same values in the other order still answer", () => {
		expect(both(["x = $5", "y = x + 1", "y + x"])).toEqual(["$5.00", "$6.00", "$11.00"]);
	});

	test("an unknown whose definition failed passes that failure on", () => {
		const answers = both(["y = x + 1", "x = 5 km + 2 kg", "y"]);
		expect(answers[1]).toBe("ERROR length and mass cannot be added");
		expect(answers[2]).toBe(answers[1]);
	});

	test("an unknown defined as another formula carries that formula", () => {
		expect(both(["y = x + 1", "x = nosuchname * 2", "y"])).toEqual(["x+1", "2*nosuchname", "2*nosuchname+1"]);
	});
});

describe("a live edit reaches the reading line", () => {
	test("editing an unrelated line keeps the read", () => {
		const shown = afterEdit(["y = x + 1", "x = 5", "y + x", "1"], 4, "2");
		expect(shown.slice(1)).toEqual(["5", "11", "2"]);
	});

	test("editing the formula changes the read", () => {
		const shown = afterEdit(["y = x + 1", "x = 5", "y"], 1, "y = x + 2");
		expect(shown.slice(1)).toEqual(["5", "7"]);
	});

	// Found while testing this change: on a re-run the live evaluator let a
	// line read a name only a line BELOW it defines, holding the value that
	// line stored on the previous pass, so `y = x + 1` stored 6 rather than
	// the formula. The evaluator now hides such a name from the line that
	// reads it (see FoundBug_forwardReadsInTheLiveEvaluator.spec.ts).
	test("a live re-run of the defining line still shows the formula, as a pass from scratch does", () => {
		expect(afterEdit(["y = x + 1", "x = 5", "y + x"], 2, "x = 6")[0]).toBe("x+1");
	});

	test("a live edit of the later definition reads the formula with the new value", () => {
		expect(afterEdit(["y = x + 1", "x = 5", "y + x"], 2, "x = 6")[2]).toBe("13");
	});
});

describe("resolveStoredFormula, the read itself", () => {
	const lookupOf = (entries: Record<string, Value>) => (name: string): Value | undefined => (Object.prototype.hasOwnProperty.call(entries, name) ? entries[name] : undefined);

	test("a value that is not a formula is returned as it is", () => {
		const five = numberValue(5);
		expect(resolveStoredFormula(five, "y", () => numberValue(1))).toBe(five);
		const text = stringValue("x");
		expect(resolveStoredFormula(text, "y", () => numberValue(1))).toBe(text);
	});

	test("a formula with nothing known is returned as it is", () => {
		const stored = symbolicValue(plus(x, num(1)));
		expect(resolveStoredFormula(stored, "y", () => undefined)).toBe(stored);
	});

	test("a formula whose unknown has a number becomes a number", () => {
		const out = resolveStoredFormula(symbolicValue(plus(x, num(1))), "y", lookupOf({ x: numberValue(5) }));
		expect(out.type).toBe(ValueType.Number);
		expect(out.toNumber()).toBe(6);
	});

	test("a fraction, a negative, zero and negative zero", () => {
		const stored = symbolicValue(times(x, num(3)));
		expect(resolveStoredFormula(stored, "y", lookupOf({ x: numberValue(0.5) })).toNumber()).toBe(1.5);
		expect(resolveStoredFormula(stored, "y", lookupOf({ x: numberValue(-2) })).toNumber()).toBe(-6);
		expect(resolveStoredFormula(stored, "y", lookupOf({ x: numberValue(0) })).toNumber()).toBe(0);
		expect(Math.abs(resolveStoredFormula(stored, "y", lookupOf({ x: numberValue(-0) })).toNumber())).toBe(0);
	});

	test("2^53 is carried exactly", () => {
		const out = resolveStoredFormula(symbolicValue(plus(x, num(0))), "y", lookupOf({ x: numberValue(2 ** 53) }));
		expect(out.toNumber()).toBe(2 ** 53);
	});

	test("a non-finite number is refused by name", () => {
		for (const bad of [Infinity, -Infinity, NaN]) {
			const out = resolveStoredFormula(symbolicValue(plus(x, num(1))), "y", lookupOf({ x: numberValue(bad) }));
			expect(out.type).toBe(ValueType.Error);
			expect(out.errorCode).toBe("SYMBOLIC_NONFINITE_OPERAND");
		}
	});

	test("an error or a pending unknown passes that value on", () => {
		const failed = errorValue("SOME_CODE", "it failed");
		expect(resolveStoredFormula(symbolicValue(plus(x, num(1))), "y", lookupOf({ x: failed }))).toBe(failed);
	});

	test("money, a unit, a percentage, a date and text are refused", () => {
		for (const bound of [uomValue(5, "USD"), uomValue(5, "km"), percentageValue(5), datetimeValue(0), stringValue("a")]) {
			const out = resolveStoredFormula(symbolicValue(plus(x, num(1))), "y", lookupOf({ x: bound }));
			expect(out.errorCode).toBe("SYMBOLIC_FORMULA_VALUE_UNSUPPORTED");
			expect(String(out.errorMessage)).not.toMatch(/undefined|\[object/);
		}
	});

	test("a formula chain past the depth limit leaves the far names unknown", () => {
		const entries: Record<string, Value> = {};
		const length = STORED_FORMULA_MAX_DEPTH + 10;
		for (let i = 0; i < length; i++) entries[`v${i}`] = symbolicValue(plus(varNode(`v${i + 1}`), num(1)));
		entries[`v${length}`] = numberValue(0);
		const out = resolveStoredFormula(entries.v0, "v0", lookupOf(entries));
		expect(out.type).toBe(ValueType.Symbolic);
	});

	test("a short chain resolves in full", () => {
		const entries: Record<string, Value> = {
			a: symbolicValue(plus(varNode("b"), num(1))),
			b: symbolicValue(plus(varNode("c"), num(1))),
			c: numberValue(1),
		};
		expect(resolveStoredFormula(entries.a, "a", lookupOf(entries)).toNumber()).toBe(3);
	});

	test("formulaCannotTake names the owner, the unknown and the kind", () => {
		const out = formulaCannotTake("total", "rate", uomValue(3, "kg"));
		expect(out.errorMessage).toBe("total was written as a formula in rate before rate had a value, and rate now holds a mass, which the formula cannot take. Define rate above the line that defines total.");
		expect(formulaCannotTake("a", "b", new Value(ValueType.Boolean, true)).errorMessage).toContain("a value that is not a plain number");
	});
});

describe("substituteAll and the iterative variable scan", () => {
	test("an empty map returns the same tree", () => {
		const tree = plus(x, num(1));
		expect(substituteAll(tree, new Map())).toBe(tree);
	});

	test("every named variable is replaced in one walk, and a replacement is not rewritten", () => {
		const tree = plus(x, times(varNode("y"), x));
		const out = substituteAll(tree, new Map([["x", num(2)], ["y", x]]));
		expect(out).toEqual(plus(num(2), times(x, num(2))));
	});

	test("an untouched branch is shared, not copied", () => {
		const branch = times(varNode("a"), num(3));
		const out = substituteAll(plus(x, branch), new Map([["x", num(1)]])) as { kind: "add"; right: SymbolicNode };
		expect(out.right).toBe(branch);
	});

	test("a call and a power are rebuilt", () => {
		const tree: SymbolicNode = { kind: "call", name: "sin", args: [{ kind: "pow", base: x, exponent: num(2) }] };
		expect(substituteAll(tree, new Map([["x", num(3)]]))).toEqual({ kind: "call", name: "sin", args: [{ kind: "pow", base: num(3), exponent: num(2) }] });
	});

	test("a prototype-named variable is only a name", () => {
		const tree = plus(varNode("constructor"), varNode("__proto__"));
		expect(substituteAll(tree, new Map([["x", num(1)]]))).toBe(tree);
		expect([...freeVariables(tree)]).toEqual(["constructor", "__proto__"]);
	});

	test("a chain deeper than the native stack is rewritten and scanned without overflowing", () => {
		let deep: SymbolicNode = x;
		for (let i = 0; i < 9_000; i++) deep = plus(deep, num(1));
		const out = substituteAll(deep, new Map([["x", num(0)]]));
		expect(nodeCount(out)).toBe(nodeCount(deep));
		expect([...freeVariables(deep)]).toEqual(["x"]);
		expect(freeVariables(out).size).toBe(0);
	});

	test("free variables are listed in order of first appearance", () => {
		const tree = plus(varNode("b"), plus(varNode("a"), varNode("b")));
		expect([...freeVariables(tree)]).toEqual(["b", "a"]);
	});
});

describe("adversarial", () => {
	test("prototype words as the formula's unknown and as its name", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch: lines } = expectHonestDocument(`y = ${word} + 1\n${word} = 5\ny + ${word}`);
				if (!lines[0].startsWith("ERROR") && !lines[1].startsWith("ERROR")) expect(lines[2]).toBe("= 11");
				expectHonestDocument(`${word} = q + 1\nq = 2\n${word}`);
			}
		});
	});

	test("a long chain of formulas defined in reverse is answered within budget", () => {
		const size = 300;
		const lines = Array.from({ length: size }, (_, i) => `v${i} = v${i + 1} + 1`);
		lines.push(`v${size} = 0`, "v0");
		const { batch: answers } = expectHonestDocument(lines.join("\n"), { budgetMs: 10_000 });
		expect(answers.slice(-1)[0]).toMatch(/^= |v\d+/);
	});

	test("a formula near the size limit read with its unknown known is refused or answered, never a crash", () => {
		const sum = RESOURCE_PROBES.longSum(2_000).replace(/^0/, "x");
		expectHonestDocument(`y = ${sum}\nx = 1\ny`, { budgetMs: 10_000 });
	});

	test("look-alike names are other names", () => {
		// A zero-width space makes a different name, which nothing defines.
		expectHonestDocument("y = x + 1\nx​ = 5\ny");
	});

	test("markup-shaped text as the later value is refused as text", () => {
		const last = both(["y = x + 1", 'x = "<script>alert(1)</script>"', "y"]).slice(-1)[0]!;
		expect(last).toMatch(/^ERROR y was written as a formula in x/);
	});

	test("the edge numbers as the later value", () => {
		for (const edge of ["0", "-0", "-1", "0.5", "1/3", "2^53", "1e308", "1e-320"]) {
			expectHonestDocument(`y = x + 1\nx = ${edge}\ny`);
		}
		// Past the largest double the formula answers as the same line written below x does.
		expect(both(["y = x * 2", "x = 1e308", "y"]).slice(-1)[0]).toBe(both(["x = 1e308", "x * 2"]).slice(-1)[0]);
		expect(both(["y = x + 1", "x = 1/0", "y"]).slice(-1)[0]).toMatch(/^ERROR/);
	});

	test("CRLF and a trailing newline read the same", () => {
		expect(batch(["y = x + 1\r", "x = 5\r", "y + x\r", ""]).slice(0, 3)).toEqual(["x+1", "5", "11"]);
	});
});

describe("resolveStoredFormulaIn reads the unknowns from what holds the variables", () => {
	test("the same answer as a lookup, and a hostile name misses", () => {
		const stored = symbolicValue({ kind: "add", left: varNode("x"), right: constNode(1) } as SymbolicNode);
		const vars = { getVar: (name: string) => (name === "x" ? numberValue(5) : undefined) };
		expect(resolveStoredFormulaIn(stored, "y", vars).toNumber()).toBe(resolveStoredFormula(stored, "y", (n) => vars.getVar(n)).toNumber());
		expect(resolveStoredFormulaIn(numberValue(3), "y", vars).toNumber()).toBe(3);
		expect(resolveStoredFormulaIn(stored, "__proto__", { getVar: () => undefined })).toBe(stored);
	});
});
