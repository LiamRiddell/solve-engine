import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine } from "@tools/adversarial";
import { createVM, executeBytecode } from "@solve-js/vm/VM";
import { OpRegistry } from "@solve-js/vm/OpRegistry";
import { OpCode } from "@solve-js/parser/OpCode";
import { OPERAND_BYTES } from "@solve-js/parser/OperandWidth";
import { numberValue } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { extractReadsAndWrites } from "@solve-js/engine/ExpressionEngineSafety";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { Token } from "@solve-js/lexer/Token";

/**
 * Issue #642: a variable named like a unit was read as the unit after a slash.
 * With `t = 5`, `100 / t` gave `100.00 /t`, a hundred per tonne, where `100 * t`
 * and `100 / (t)` read the variable. The bare-rate rule fuses a slash and a unit
 * spelling into a rate denominator from the text alone, and no rule knows which
 * names the document defines. The fused denominator now compiles to a choice made
 * at run time: a defined variable of that name is divided by, and otherwise the
 * rate is built as before.
 */

function lines(text: string): string[] {
	return expectHonestDocument(text).batch;
}

describe("a defined variable after a slash is divided by", () => {
	test.each([
		["t = 5\n100 / t", "= 20"],
		["t = 5\n100/t", "= 20"],
		["distance = 120\nt = 2\nspeed = distance / t", "= 60"],
		["s = 2\n100 / s", "= 50"],
		["h = 4\n100 / h", "= 25"],
		["d = 4\n100 / d", "= 25"],
		["m = 4\n100 / m", "= 25"],
		["g = 4\n100 / g", "= 25"],
		["kg = 2\n10 / kg", "= 5"],
		["km = 2\n10 / km", "= 5"],
		["hr = 2\n30 / hr", "= 15"],
		[":t = 5\n100 / t", "= 20"],
		["t = 5\n(2 + 3) / t", "= 1"],
		["t = 5\nx = 100 / t\nx * 2", "= 40"],
	])("%j", (text, expected) => {
		const answers = lines(text);
		expect(answers[answers.length - 1]).toBe(expected);
	});

	test("the capitals the rule already left alone still divide", () => {
		for (const name of ["N", "W", "J", "K", "F"]) {
			expect(lines(`${name} = 5\n100 / ${name}`)[1]).toBe("= 20");
		}
	});

	test("a function's parameter is divided by inside the function", () => {
		expect(lines("f(t) = 100 / t\nf(4)")[1]).toBe("= 25");
	});

	test("a quantity in the variable divides as it does in brackets", () => {
		expect(lines("distance = 120 km\nt = 2\ndistance / t")[2]).toBe("= 60.00 km");
		expect(lines("t = 5 kg\n100 / t")[1]).toBe("= 20.00 /kg");
	});
});

describe("the division is the one 100 / (t) gives, for any value of t", () => {
	test.each([
		"5", "0", "-2", "0.1", "1/3", "1e308", "5 kg", "$5", "5%", "2 +/- 0.1", "[1, 2]", "\"text\"", "5 km/h", "true",
	])("t = %s", (value) => {
		const bare = expectHonestDocument(`t = ${value}\n100 / t`, { allowNaN: true }).batch[1];
		const bracketed = expectHonestDocument(`t = ${value}\n100 / (t)`, { allowNaN: true }).batch[1];
		expect(bare).toBe(bracketed);
	});
});

describe("what keeps the rate", () => {
	test.each([
		["100 / t", 0, "= 100.00 /t"],
		["100 / t\nt = 5", 0, "= 100.00 /t"],
		["h = 4\n$15 / h", 1, "= 15.00 USD/h"],
		["h = 4\n$15/h", 1, "= 15.00 USD/h"],
		["h = 4\n60 km / h", 1, "= 60.00 km/h"],
		["h = 4\n100 per h", 1, "= 100.00 /h"],
		["d = 2\n3 hours / d", 1, "= 3.00 hours/d"],
	])("%j", (text, line, expected) => {
		expect(lines(text)[line]).toBe(expected);
	});

	test("the single-expression path has no variables to divide by", () => {
		expect(formatValue(newTrackedEngine().evaluateExpression("100 / t"))).toBe("= 100.00 /t");
	});
});

describe("the dependency graph reads the name", () => {
	function readsOf(expr: string): string[] {
		const engine = new ExpressionEngine({ diagnostics: true, packages: BUILTIN_PACKAGES });
		const tokens = engine.evaluateLineWithDebug(1, expr).diagnostic!.tokens as Token[];
		engine.clear();
		return extractReadsAndWrites(tokens).reads;
	}

	test("a denominator after a plain value is a read of its name", () => {
		expect(readsOf("100 / t")).toEqual(["t"]);
		expect(readsOf("(2 + 3) / h")).toEqual(["h"]);
	});

	test("one after a currency amount, a per-word or a unit is not", () => {
		expect(readsOf("$15 / h")).toEqual([]);
		expect(readsOf("100 per h")).toEqual([]);
		expect(readsOf("60 km / h")).toEqual([]);
	});
});

describe("RATE_OR_DIVIDE in the VM", () => {
	const RATE_BUILTIN = 95;

	function run(opcodes: number[], defined?: number) {
		const vm = createVM(new OpRegistry());
		if (defined !== undefined) vm.setVar("t", numberValue(defined));
		return executeBytecode({ opcodes: new Uint8Array(opcodes), numbers: new Float64Array([100]), strings: ["t"] }, vm);
	}

	test("takes two operands: the name and the rate builtin", () => {
		expect(OPERAND_BYTES[OpCode.RATE_OR_DIVIDE]).toBe(2);
	});

	test("builds the rate and steps over the DIV when the name is not defined", () => {
		const result = run([OpCode.PUSH_NUMBER, 0, OpCode.RATE_OR_DIVIDE, 0, RATE_BUILTIN, OpCode.DIV, OpCode.HALT]);
		expect(result.type).toBe("value");
		if (result.type !== "value") return;
		expect(formatValue(result.value)).toBe("= 100.00 /t");
	});

	test("pushes the variable for the DIV when it is defined", () => {
		const result = run([OpCode.PUSH_NUMBER, 0, OpCode.RATE_OR_DIVIDE, 0, RATE_BUILTIN, OpCode.DIV, OpCode.HALT], 4);
		expect(result.type).toBe("value");
		if (result.type !== "value") return;
		expect(formatValue(result.value)).toBe("= 25");
	});

	test("refuses a stream where no DIV follows, rather than stepping over something else", () => {
		const result = run([OpCode.PUSH_NUMBER, 0, OpCode.RATE_OR_DIVIDE, 0, RATE_BUILTIN, OpCode.ADD, OpCode.HALT]);
		expect(result.type).toBe("error");
		if (result.type !== "error") return;
		expect(result.error.code).toBe("MALFORMED_BYTECODE_RATE_OR_DIVIDE");
	});

	test("refuses a rate builtin index nothing is registered at", () => {
		const result = run([OpCode.PUSH_NUMBER, 0, OpCode.RATE_OR_DIVIDE, 0, 250, OpCode.DIV, OpCode.HALT]);
		expect(result.type).toBe("value");
		if (result.type !== "value") return;
		expect(result.value.errorCode).toBe("UNKNOWN_BUILTIN_FUNCTION");
	});
});

describe("adversarial: every form answers honestly", () => {
	const names = ["t", "h", "s", "d", "m", "g", "kg", "hr", "min", "constructor", "__proto__"];
	test.each(names.flatMap((n) => [`100 / ${n}`, `-100 / ${n}`, `100 / ${n} / ${n}`, `(100 / ${n}) ^ 2`, `100 / ${n} in s`]))("%s", (line) => {
		expectHonestLine(line, { allowNaN: true });
	});

	test.each(["t", "h", "kg"])("%s defined, then divided by, through both passes", (n) => {
		expectHonestDocument(`${n} = 5\n100 / ${n}\n100 / ${n} / ${n}\n${n} = 0\n100 / ${n}`, { allowNaN: true });
	});
});
