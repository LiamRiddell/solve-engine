import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { createVM, executeBytecode, type EvalResult } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { OpCode } from "@solve-js/parser/OpCode";
import { EngineError } from "@solve-js/errors/EngineError";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #714: called from a timer callback, a line reading a name nothing
 * defines cost about 47 times `2 + 5` on this spec's machine (26.8 against
 * 0.57 microseconds), because `LOAD_VAR` threw `UNDEFINED_VARIABLE` from
 * inside `executeBytecode`'s dispatch loop. A throw outside a promise job has
 * V8 record where it was thrown, and finding that position in a function as
 * large as the dispatch loop is what cost. Every throw in the loop now goes
 * through a small module-level function typed `never`, and the same zz + 1
 * costs 6.6 microseconds. The codes, messages and suggestions are unchanged.
 *
 * The gate is the source check below, a count of the loop's own throw
 * statements, which is exact. The cost itself is timed from a timer callback
 * in `benchmarks/incrementalEditBenchmarks.spec.ts`, where a ratio between
 * two timings can vary without failing the fast suite.
 */

// ── The shape: executeBytecode throws nothing itself ─────────────────────

/** Every `throw` statement in `executeBytecode`'s own body, outside nested functions. */
function throwsInExecuteBytecode(): string[] {
	const file = path.resolve(__dirname, "../../src/vm/VM.ts");
	const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
	let body: ts.Block | undefined;
	source.forEachChild((node) => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === "executeBytecode" && node.body) body = node.body;
	});
	expect(body).toBeDefined();
	const found: string[] = [];
	const visit = (node: ts.Node): void => {
		// A nested function is a function of its own, with its own throw site.
		if (ts.isFunctionLike(node)) return;
		if (ts.isThrowStatement(node)) {
			const { line } = source.getLineAndCharacterOfPosition(node.getStart());
			found.push(`VM.ts:${line + 1}: ${node.getText().split("\n")[0]}`);
		}
		node.forEachChild(visit);
	};
	body!.forEachChild(visit);
	return found;
}

describe("the dispatch loop", () => {
	test("has no throw statement of its own", () => {
		expect(throwsInExecuteBytecode()).toEqual([]);
	});
});

// ── Each moved throw still reports what it did ───────────────────────────

const bc = (ops: number[], strings: string[] = [], numbers: number[] = []) => ({
	opcodes: new Uint8Array(ops),
	numbers: new Float64Array(numbers),
	strings,
});

/** The error arm of a run, or a failure naming what came back instead. */
function errorOf(result: EvalResult): EngineError {
	expect(result.type).toBe("error");
	if (result.type !== "error") throw new TypeError("not an error");
	expect(result.error).toBeInstanceOf(EngineError);
	return result.error;
}

describe("every arm that threw reports the same code and message", () => {
	test("LOAD_VAR on an undefined name, with its did-you-mean", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression(":price = 5");
		expect(() => engine.evaluateExpression("prise + 1")).toThrow("Undefined variable: prise. Did you mean price?");
		try {
			engine.evaluateExpression("zz + 1");
		} catch (error) {
			expect((error as EngineError).code).toBe("UNDEFINED_VARIABLE");
			expect((error as EngineError).message).toBe("Undefined variable: zz");
		}
		const vm = createVM(sharedOpRegistry);
		const error = errorOf(executeBytecode(bc([OpCode.LOAD_VAR, 0, OpCode.HALT], ["zz"]), vm));
		expect(error.code).toBe("UNDEFINED_VARIABLE");
		expect(vm.getStack().length).toBe(0);
	});

	test("the column-total word keeps its own suggestion", () => {
		const error = errorOf(executeBytecode(bc([OpCode.LOAD_VAR, 0, OpCode.HALT], ["total"]), createVM(sharedOpRegistry)));
		expect(error.message).toBe('Undefined variable: total. To add up the lines above, write "total above".');
		expect(error.suggestion).toBe("total above");
	});

	test("CALL_USER_FUNCTION on an undefined function, with its did-you-mean", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("double(x) = x * 2");
		expect(() => engine.evaluateExpression("doubel(3)")).toThrow(/Undefined function: doubel\. Did you mean double\?/);
		const error = errorOf(executeBytecode(bc([OpCode.CALL_USER_FUNCTION, 0, 0, OpCode.HALT], ["nofn"]), createVM(sharedOpRegistry)));
		expect(error.code).toBe("UNDEFINED_FUNCTION");
		expect(error.message).toBe("Undefined function: nofn");
	});

	test("CALL_USER_FUNCTION with the wrong number of arguments", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("f(x) = x + 1");
		const vm = engine.getVM();
		const error = errorOf(executeBytecode(bc([OpCode.PUSH_NUMBER, 0, OpCode.PUSH_NUMBER, 1, OpCode.CALL_USER_FUNCTION, 0, 2, OpCode.HALT], ["f"], [1, 2]), vm));
		expect(error.code).toBe("FUNCTION_ARITY_MISMATCH");
		expect(error.message).toBe("f expects 1 argument(s) but got 2");
		expect(error.context).toMatchObject({ name: "f", expected: 1, actual: 2 });
	});

	test("CALL_BUILTIN with too few arguments", () => {
		expect(() => newTrackedEngine().evaluateExpression("sqrt()")).toThrow(EngineError);
	});

	test("DEFINE_USER_FUNCTION naming a missing body", () => {
		const error = errorOf(executeBytecode(bc([OpCode.DEFINE_USER_FUNCTION, 3, OpCode.HALT]), createVM(sharedOpRegistry)));
		expect(error.code).toBe("INTERNAL_MISSING_FUNCTION_BODY");
		expect(error.message).toBe("Internal error: DEFINE_USER_FUNCTION referenced missing body index 3");
	});

	test("BIND_UNKNOWN naming a missing body", () => {
		const error = errorOf(executeBytecode(bc([OpCode.BIND_UNKNOWN, 4, OpCode.HALT]), createVM(sharedOpRegistry)));
		expect(error.code).toBe("INTERNAL_MISSING_ANONYMOUS_BODY");
		expect(error.message).toBe("Internal error: BIND_UNKNOWN referenced missing anonymous body index 4");
	});

	test("LOAD_GLOBAL_VAR before its value resolved", () => {
		const error = errorOf(executeBytecode(bc([OpCode.LOAD_GLOBAL_VAR, 0, OpCode.HALT], ["never_declared_714"]), createVM(sharedOpRegistry)));
		expect(error.code).toBe("GLOBAL_VARIABLE_NOT_RESOLVED");
		expect(error.message).toBe('Global variable "never_declared_714" was read before it resolved');
	});

	test("an opcode with no arm", () => {
		const error = errorOf(executeBytecode(bc([OpCode.PUSH_NUMBER, 0, 255, OpCode.HALT], [], [7]), createVM(sharedOpRegistry)));
		expect(error.code).toBe("MALFORMED_BYTECODE_UNKNOWN_OPCODE");
		expect(error.context).toMatchObject({ opcode: 255, offset: 2 });
	});

	test("the instruction and stack limits", () => {
		const limited = new ExpressionEngine({ config: { vm: { maxStackDepth: 5, maxInstructions: 20 } }, packages: BUILTIN_PACKAGES });
		try {
			expect(() => limited.evaluateExpression("1" + "+1".repeat(12))).toThrow("Execution exceeded maximum of 20 instructions");
			expect(() => limited.evaluateExpression("(1+(2+(3+(4+(5+6)))))")).toThrow("Execution exceeded maximum stack depth of 5");
			expect(limited.evaluateExpression("1+1").toNumber()).toBe(2);
		} finally {
			limited.clear();
		}
	});

	test("an exact power past its ceiling", () => {
		expect(() => newTrackedEngine().evaluateExpression("2n ^ 100000")).toThrow(/past the limit of [\d,]+ bits/);
	});

	test("a user function whose body fails passes its error up unchanged", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("g(x) = x + missing");
		expect(() => engine.evaluateExpression("g(1)")).toThrow("Undefined variable: missing");
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: a prototype word read as a name is an honest undefined name", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const outcome = expectHonestLine(`${word} + 1`);
				expect(outcome.kind).not.toBe("value");
			}
		});
	});

	test("security: a prototype word called as a function is an honest undefined function", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expectHonestLine(`${word}(1)`);
		});
	});

	test("security: a long undefined name, and a thousand different ones in a row", () => {
		expectHonestLine("x".repeat(10_000) + " + 1");
		const engine = newTrackedEngine();
		const started = performance.now();
		for (let i = 0; i < 1_000; i++) {
			expect(() => engine.evaluateExpression(`unknown${i} + 1`)).toThrow(EngineError);
		}
		expect(performance.now() - started).toBeLessThan(20_000);
	});

	test("security: look-alike and markup-shaped text beside an undefined name", () => {
		for (const text of TEXT_EDGES) expectHonestLine(`zz ${text}`);
	});

	test("realistic: an undefined name inside a user function, a list and a conversion", () => {
		for (const line of ["h(x) = x + nope", "[1, nope, 3]", "nope to m", "sum(1, nope)", "nope ? 1 : 2"]) expectHonestLine(line);
	});

	test("realistic: an undefined name in a document, through both passes", () => {
		const engine = newTrackedEngine();
		const lines = engine.parseDocument("a = 1\nb + 1\na + 1").lines;
		expect(lines[1].error ?? lines[1].result?.toString()).toMatch(/Undefined variable: b/);
		expect(lines[2].result?.toNumber()).toBe(2);
	});

	test("edge: the engine still answers after every kind of refusal", () => {
		const engine = newTrackedEngine();
		for (const line of ["zz + 1", "nofn(1)", "2n ^ 100000", "sqrt()"]) {
			expect(() => engine.evaluateExpression(line)).toThrow(EngineError);
			expect(engine.evaluateExpression("2 + 5").toNumber()).toBe(7);
		}
		expect(engine.getVM().getStack().length).toBe(0);
	});
});
