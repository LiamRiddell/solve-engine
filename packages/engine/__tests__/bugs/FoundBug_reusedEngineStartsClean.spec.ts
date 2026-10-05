import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `evaluateDocument` on a reused engine did not clear the tables of
 * user units and names of several words first, as `parseDocument` does, so a
 * note evaluated after another read its units and names: `5 sprints in weeks`
 * answered 10 weeks after a note defining `1 sprint = 2 weeks`. Found beside
 * it, and in both passes: a variable, a function or a stored equation one note
 * (or the previous pass over the same note) defined was still defined, so
 * `x * 2` answered 10 on an engine that had parsed `x = 5`, and a second parse
 * of `x * 2` over `x = 5` answered 10 where the first refused.
 *
 * Every document pass now opens with `ExpressionEngine.beginDocument`, which
 * empties the unit and name tables and removes every variable, function and
 * equation a document line wrote. What a host set outside a document stays.
 */

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
	});
}

type Pass = (engine: ExpressionEngine, text: string) => string[];
const PASSES: [string, Pass][] = [
	["parseDocument", (engine, text) => read(engine.parseDocument(text, { inputType: "markdown" }))],
	["evaluateDocument", (engine, text) => read(evaluateDocument(engine, text, { inputType: "markdown" }))],
	["evaluateLines", (engine, text) => read({ lines: engine.evaluateLines(text.split("\n")), totalLines: 0, errors: [] })],
];

const fresh = (text: string): string[] => read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));

/** Note A then note B on one engine through `pass`; B's answers. */
function afterAnother(pass: Pass, a: string, b: string): string[] {
	const engine = newTrackedEngine();
	pass(engine, a);
	return pass(engine, b);
}

describe("the reported case: a note after another reads nothing the first defined", () => {
	const A = ["a", "b", "c", "1 sprint = 2 weeks", "hourly rate = 5", "x = 5", "f(n) = n + 1", "k * y = 10"].join("\n");
	const B = ["5 sprints in weeks", "hourly rate * 2", "x * 2", "f(2)", "y =>"].join("\n");

	test.each(PASSES)("%s", (_name, pass) => {
		expect(afterAnother(pass, A, B)).toEqual(fresh(B));
	});

	test.each(PASSES)("%s, the other passes between", (_name, pass) => {
		for (const [, other] of PASSES) {
			const engine = newTrackedEngine();
			other(engine, A);
			expect(pass(engine, B)).toEqual(fresh(B));
		}
	});

	test.each(PASSES)("%s over the same note twice gives the first answer both times", (_name, pass) => {
		const engine = newTrackedEngine();
		const text = "x * 2\nx = 5\nf(1)\nf(n) = n * 3";
		const first = pass(engine, text);
		expect(first).toEqual(fresh(text));
		expect(pass(engine, text)).toEqual(first);
	});
});

describe("the three entry points", () => {
	test("a single expression after a note still reads the note's names, as a host's scratch line does", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("x = 5");
		expect(formatValue(engine.evaluateExpression("x * 2"))).toBe("= 10");
	});

	test("a name a host set outside a document survives a document pass", () => {
		for (const [, pass] of PASSES) {
			const engine = newTrackedEngine();
			engine.evaluateExpression(":hostRate = 3");
			expect(pass(engine, "hostRate * 2")).toEqual(["6"]);
			expect(pass(engine, "hostRate * 3")).toEqual(["9"]);
		}
	});
});

describe("the parts: beginDocument", () => {
	test("ordinary: it removes a document's variables, functions, units, names and equations", () => {
		const engine = newTrackedEngine();
		engine.parseDocument(["x = 5", "f(n) = n", "1 sprint = 2 weeks", "hourly rate = 2", "k * y = 10"].join("\n"));
		engine.beginDocument();
		const vm = engine.getVM();
		expect(vm.getVar("x")).toBeUndefined();
		expect(vm.hasUserFunction("f")).toBe(false);
		expect(vm.getVar("hourly rate")).toBeUndefined();
		expect(vm.hasEquation("y") || vm.hasScalarEquation("y")).toBe(false);
		expect(engine.userUnitNames()).toEqual([]);
	});

	test("boundary: on a fresh engine it does nothing and throws nothing, twice", () => {
		const engine = newTrackedEngine();
		expect(() => {
			engine.beginDocument();
			engine.beginDocument();
		}).not.toThrow();
		expect(formatValue(engine.evaluateExpression("1 + 1"))).toBe("= 2");
	});

	test("boundary: a name written outside a document is kept", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression(":kept = 4");
		engine.parseDocument("gone = 5");
		engine.beginDocument();
		expect(engine.getVM().getVar("kept")?.toNumber()).toBe(4);
		expect(engine.getVM().getVar("gone")).toBeUndefined();
	});

	test("hostile: names that are inherited properties are removed like any other", () => {
		expectPrototypeUntouched(() => {
			const engine = newTrackedEngine();
			engine.parseDocument(PROTOTYPE_WORDS.map((word, i) => `:${word} = ${i}`).join("\n"));
			engine.beginDocument();
			for (const word of PROTOTYPE_WORDS) expect(engine.getVM().getVar(word)).toBeUndefined();
		});
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a note defining %s does not reach the next", (word) => {
		expectPrototypeUntouched(() => {
			for (const [, pass] of PASSES) expect(afterAnother(pass, `:${word} = 5`, `${word} * 2`)).toEqual(fresh(`${word} * 2`));
		});
	});

	test("a note defining ten thousand names, then an empty one, within budget", () => {
		const big = Array.from({ length: 10_000 }, (_, i) => `v${i} = ${i}`).join("\n");
		const engine = newTrackedEngine();
		engine.parseDocument(big);
		const started = performance.now();
		expect(read(evaluateDocument(engine, "v9999"))).toEqual(fresh("v9999"));
		expect(performance.now() - started).toBeLessThan(10_000);
	});
});

describe("adversarial: realistic breakage", () => {
	test("switching between two notes on one engine, back and forth", () => {
		const engine = newTrackedEngine();
		const a = "rate = 4\nrate * 2";
		const b = "rate * 3";
		for (let i = 0; i < 3; i++) {
			expect(read(evaluateDocument(engine, a))).toEqual(["4", "8"]);
			expect(read(engine.parseDocument(b))).toEqual(fresh(b));
		}
	});

	test("a running total restarts from its seed on every pass", () => {
		const engine = newTrackedEngine();
		for (let i = 0; i < 3; i++) expect(read(evaluateDocument(engine, "total += 5\ntotal += 5"))).toEqual(["5", "10"]);
	});
});

describe("adversarial: edge cases", () => {
	test.each(NUMERIC_EDGES)("a name holding %s does not outlive its note", (value) => {
		for (const [, pass] of PASSES) expect(afterAnother(pass, `x = ${value}`, "x")).toEqual(fresh("x"));
	});

	test("an empty note after a full one", () => {
		for (const [, pass] of PASSES) expect(afterAnother(pass, "x = 1", "")).toEqual(fresh(""));
	});
});
