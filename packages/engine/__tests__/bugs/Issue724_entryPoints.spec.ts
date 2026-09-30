import { describe, expect, test } from "@jest/globals";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import { BUILTIN_PACKAGES } from "@solve-js/packages";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #724: a host can evaluate through one expression, `parseDocument`,
 * `evaluateDocument` or a live `ThreeTierEvaluator`, and no page compared them.
 * `guide/entry-points.md` now does. This spec runs every claim that page makes:
 * the single-expression refusals and their codes, goal seek refused by the
 * batch pass and solved by the incremental one, the what-if resolved by both,
 * the four paths agreeing on the forms they share, and the table of lines run
 * after a one-line edit.
 */

/** Each line of a document result as a reader sees it, a refusal marked. */
function read(engine: ExpressionEngine, result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.errorCode}`;
		if (!line.result) return "";
		return line.result.type === ValueType.Error ? `ERROR ${line.result.errorCode}` : engine.formatValue(line.result);
	});
}

/** The same document through a live evaluator, from line 1 to its end. */
function live(text: string): string[] {
	const engine = newTrackedEngine();
	const doc = new DocumentModel();
	doc.setDocument(text);
	const evaluator = new ThreeTierEvaluator(doc, engine);
	try {
		return evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map((line) => {
			if (line.error) return `ERROR ${line.errorCode}`;
			if (!line.result) return "";
			return line.result.type === ValueType.Error ? `ERROR ${line.result.errorCode}` : engine.formatValue(line.result);
		});
	} finally {
		evaluator.dispose();
	}
}

const NOTE = [":price = 100", "price * 1.25", "solve line 2 for price = 150", "line 2 with price = 10"].join("\n");

describe("the page's examples, run", () => {
	test.each([
		["line 1 * 2", "LINE_REF_NO_DOCUMENT"],
		["total of #food", "TAG_NO_DOCUMENT"],
		['sum of column "cost" above', "TABLE_NO_DOCUMENT"],
		["line 2 with price = 10", "WHAT_IF_NO_DOCUMENT"],
		["solve line 2 for price = 150", "GOAL_SEEK_NO_DOCUMENT"],
	])("one expression: %s refuses with %s, as a value", (line, code) => {
		const engine = newTrackedEngine();
		const value = engine.evaluateLine(1, line);
		expect(value.type).toBe(ValueType.Error);
		expect(value.errorCode).toBe(code);
		expect(engine.evaluateExpression(line).errorCode).toBe(code);
	});

	test("goal seek: refused by parseDocument, solved by evaluateDocument", () => {
		const engine = newTrackedEngine();
		expect(engine.parseDocument(NOTE).lines[2].result?.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
		expect(engine.formatValue(evaluateDocument(engine, NOTE).lines[2].result!)).toBe("= 120");
	});

	test("the what-if resolves through both passes", () => {
		const engine = newTrackedEngine();
		expect(engine.formatValue(engine.parseDocument(NOTE).lines[3].result!)).toBe("= 12.50");
		expect(engine.formatValue(evaluateDocument(engine, NOTE).lines[3].result!)).toBe("= 12.50");
	});

	test("the whole note through the three document paths", () => {
		const engine = newTrackedEngine();
		expect(read(engine, engine.parseDocument(NOTE))).toEqual(["= 100", "= 125", "ERROR GOAL_SEEK_NO_DOCUMENT", "= 12.50"]);
		expect(read(engine, evaluateDocument(newTrackedEngine(), NOTE))).toEqual(["= 100", "= 125", "= 120", "= 12.50"]);
		expect(live(NOTE)).toEqual(["= 100", "= 125", "= 120", "= 12.50"]);
	});

	test("evaluateDocument puts back the document an engine had", () => {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		engine.setDocumentModel(doc);
		evaluateDocument(engine, NOTE);
		expect(engine.getDocumentModel()).toBe(doc);
	});
});

// ── The cost table ───────────────────────────────────────────────────────

class TickParselet implements PrefixParselet {
	readonly category = "Function";
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");
		builder.emitPluginCall("tick", 1);
	}
}

/** An engine with `tick(n)`, which answers `n` and counts each call. */
function countingEngine(): { engine: ExpressionEngine; runs: () => number; reset: () => void } {
	let count = 0;
	const pkg: IEnginePackage = {
		name: "issue724-tick",
		callFusions: { tick: "TICK_CALL" },
		prefixParselets: { TICK_CALL: new TickParselet() },
		pluginFunctions: { tick: (args) => { count++; return args[0]; } },
	};
	const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, pkg] });
	return { engine, runs: () => count, reset: () => { count = 0; } };
}

describe("lines run after a one-line edit, as the page's table has them", () => {
	const lines = Array.from({ length: 1_000 }, (_, i) => `a${i + 1} = tick(${i + 1})`);
	const edited = [...lines.slice(0, 999), "a1000 = tick(1001)"];

	test("parseDocument, on the engine that ran the first pass: 1,000", () => {
		const { engine, runs, reset } = countingEngine();
		engine.parseDocument(lines.join("\n"));
		reset();
		engine.parseDocument(edited.join("\n"));
		expect(runs()).toBe(1_000);
	});

	test("evaluateDocument: 1,000", () => {
		const { engine, runs, reset } = countingEngine();
		evaluateDocument(engine, lines.join("\n"));
		reset();
		evaluateDocument(engine, edited.join("\n"));
		expect(runs()).toBe(1_000);
	});

	test.each([
		["lines 1 to 1,000", 1, 1_000],
		["the 20 lines on screen", 981, 20],
	])("a ThreeTierEvaluator evaluating %s", (_label, startLine, expected) => {
		const { engine, runs, reset } = countingEngine();
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, engine);
		evaluator.evaluate({ startLine, endLine: 1_000 });
		evaluator.applyTransaction([{ startLine: 1_000, deleteCount: 1, insertLines: ["a1000 = tick(1001)"] }]);
		reset();
		evaluator.evaluate({ startLine, endLine: 1_000 });
		expect(runs()).toBe(expected);
		evaluator.dispose();
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("%s through every entry point, with Object.prototype unchanged", (word) => {
		expectPrototypeUntouched(() => {
			const text = `:${word} = 5\n${word} * 2\nsolve line 2 for ${word} = 20`;
			const engine = newTrackedEngine();
			expect(() => engine.evaluateLine(1, `${word} * 2`)).not.toThrow(TypeError);
			const batch = read(engine, engine.parseDocument(text));
			const incremental = read(newTrackedEngine(), evaluateDocument(newTrackedEngine(), text));
			expect(batch.slice(0, 2)).toEqual(incremental.slice(0, 2));
			expect(live(text)).toEqual(incremental);
		});
	});

	test("a long note through the three document paths, within budget", () => {
		const text = RESOURCE_PROBES.manyLines(2_000);
		const started = performance.now();
		expectHonestDocument(text, { budgetMs: 10_000 });
		expect(live(text)[2_000]).toBe("= 2,001");
		expect(performance.now() - started).toBeLessThan(20_000);
	});

	test("markup-shaped lines are read as text on every path", () => {
		const text = ["<script>alert(1)</script>", "'; DROP TABLE notes; --", "2 + 2"].join("\n");
		const engine = newTrackedEngine();
		expect(read(engine, engine.parseDocument(text))[2]).toBe("= 4");
		expect(read(engine, evaluateDocument(newTrackedEngine(), text))[2]).toBe("= 4");
		expect(live(text)[2]).toBe("= 4");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo in the goal seek target: every path refuses rather than answering", () => {
		const text = [":price = 100", "price * 1.25", "solve line 2 for prise = 150"].join("\n");
		const engine = newTrackedEngine();
		expect(read(engine, engine.parseDocument(text))[2]).toMatch(/^ERROR /);
		expect(read(engine, evaluateDocument(newTrackedEngine(), text))[2]).toMatch(/^ERROR /);
		expect(live(text)[2]).toMatch(/^ERROR /);
	});

	test("the note after an edit agrees between a live evaluator and a fresh evaluateDocument", () => {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(NOTE);
		const evaluator = new ThreeTierEvaluator(doc, engine);
		evaluator.evaluate({ startLine: 1, endLine: 4 });
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [":price = 200"] }]);
		const shown = evaluator.evaluate({ startLine: 1, endLine: 4 }).lines.map((l) => (l.result ? engine.formatValue(l.result) : ""));
		evaluator.dispose();
		const fresh = evaluateDocument(newTrackedEngine(), [":price = 200", ...NOTE.split("\n").slice(1)].join("\n"));
		expect(shown).toEqual(fresh.lines.map((l) => (l.result ? engine.formatValue(l.result) : "")));
	});

	test("a snapshot taken after either pass restores the note's variables", () => {
		for (const pass of [(e: ExpressionEngine) => e.parseDocument(NOTE), (e: ExpressionEngine) => evaluateDocument(e, NOTE)]) {
			const engine = newTrackedEngine();
			pass(engine);
			const restored = JSON.parse(JSON.stringify(engine.toJSON()));
			expect(restored.variables.price).toBeDefined();
		}
	});
});

describe("adversarial: edge cases", () => {
	test.each(DOCUMENT_EDGES.map((t) => [JSON.stringify(t).slice(0, 40), t]))("the document %s answers honestly and alike on both passes", (_label, text) => {
		expectHonestDocument(text);
	});

	test.each(["0", "-0", "2^53", "1e308", "1/0"])("goal seek towards %s answers or refuses, never throws", (target) => {
		const text = `:x = 1\nx * 2\nsolve line 2 for x = ${target}`;
		expect(() => evaluateDocument(newTrackedEngine(), text)).not.toThrow();
		expect(() => newTrackedEngine().parseDocument(text)).not.toThrow();
		expect(live(text)).toHaveLength(3);
	});
});
