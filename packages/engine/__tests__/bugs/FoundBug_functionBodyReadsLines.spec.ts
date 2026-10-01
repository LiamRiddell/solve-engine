import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { BUILTIN_PACKAGES, createCryptoPackage, createKnowledgePackage, createStocksPackage } from "@solve-js/packages/builtins";
import { DOCUMENT_READING_PLUGIN_FUNCTIONS, SYNCHRONOUS_PLUGIN_FUNCTIONS, emitBuiltinPluginCall, pluginCallOptions } from "@solve-js/packages/SynchronousPluginFunctions";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `f(x) = x + prev` and `f(x) = x + line 1` were refused as a body
 * that "calls an async operation (weather, stocks, currency, ...)".
 *
 * Neither waits for anything: each reads another line of the document, which
 * a function body cannot do, since it is run wherever it is called, away from
 * the line that wrote it. Both kinds of call marked the body the same way, so
 * the one refusal covered both. A call that reads other lines now carries
 * `readsDocument` (`DOCUMENT_READING_PLUGIN_FUNCTIONS` in
 * packages/SynchronousPluginFunctions.ts, tracked by
 * `BytecodeBuilder.readsDocument`), and the definition is refused for what it
 * is, with its own code, `FUNCTION_BODY_READS_LINES`: a function body has no
 * lines to read, so the value is passed in as an argument.
 */

/** The refusal of a body that reads other lines, for a function named `name`. */
function readsLines(name: string): string {
	return `FUNCTION_BODY_READS_LINES: "${name}(...)"'s body reads other lines of the document, and a function body has no lines to read: pass the value in as an argument instead`;
}

/** A line's answer through evaluateExpression, or `CODE: message` for a refusal. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** A line's answer through the single-line entry point evaluateLine, or `CODE: message`. */
function single(line: string): string {
	try {
		const value = newTrackedEngine().evaluateLine(1, line);
		if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
		return formatValue(value).replace(/^=\s*/, "");
	} catch (error) {
		if (error instanceof EngineError) return `${error.code}: ${error.message}`;
		throw error;
	}
}

/** A document line's answer, or `ERROR <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "ERROR no line";
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	if (line.result.isError()) return `ERROR ${String(line.result.errorMessage)}`;
	return formatValue(line.result).replace(/^=\s*/, "");
}

/** Each line of a document through both document passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** The refusal's suggestion, read from the thrown error. */
function suggestionFor(line: string): string | undefined {
	try {
		newTrackedEngine().evaluateLine(1, line);
	} catch (error) {
		if (error instanceof EngineError) return error.suggestion;
	}
	return undefined;
}

describe("the lines that exposed it", () => {
	test.each([["f(x) = x + prev"], ["f(x) = x + line 1"], ["f(x) = x + total above"], ["f(x) = x + sum above"]])(
		"%s is refused as reading other lines, through evaluateExpression and evaluateLine",
		(line) => {
			expect(outcome(line)).toBe(readsLines("f"));
			expect(single(line)).toBe(readsLines("f"));
		},
	);

	test("through both document passes, which agree, and the lines around it still answer", () => {
		const message = `ERROR ${readsLines("f").replace(/^FUNCTION_BODY_READS_LINES: /, "")}`;
		expect(both(["10", "f(x) = x + prev", "1 + 1"])).toEqual(["10", message, "2"]);
	});

	test("a lookup that waits keeps its own refusal", () => {
		expect(outcome("f(x) = x + weather in London")).toMatch(/^FUNCTION_BODY_MUST_BE_SYNCHRONOUS: /);
	});

	test("the refusal says how to pass the value in, and that way works", () => {
		expect(suggestionFor("f(x) = x + prev")).toBe("Add a parameter for the line's value, f(x, v), and pass prev or line 1 to it when you call it");
		expect(suggestionFor("g(a, b) = a + b + line 1")).toBe("Add a parameter for the line's value, g(a, b, v), and pass prev or line 1 to it when you call it");
		expect(both(["f(x, v) = x + v", "10", "f(2, prev)", "f(2, line 2)"])).toEqual(["f(x, v) defined", "10", "12", "12"]);
	});
});

describe("the parts: pluginCallOptions and the reading names", () => {
	/** Every built-in plugin function name, with the package it belongs to. */
	const names = new Map<string, string>();
	for (const pkg of [...BUILTIN_PACKAGES, createStocksPackage(), createCryptoPackage(), createKnowledgePackage()]) {
		for (const name of Object.keys(pkg.pluginFunctions ?? {})) names.set(name, pkg.name);
	}
	/** The built-in calls that wait for data, the ones left on the asynchronous refusal. */
	const WAITS = new Set(["historicalCurrency", "weather", "stock", "stockhistorical", "crypto", "knowledge"]);

	test("ordinary: a reading name carries readsDocument", () => {
		expect(pluginCallOptions("prev")).toEqual({ readsDocument: true });
		expect(pluginCallOptions("lineRef")).toEqual({ readsDocument: true });
		expect(pluginCallOptions("TABLE_COLUMN_SUM")).toEqual({ readsDocument: true });
		expect(pluginCallOptions("goalseek")).toEqual({ readsDocument: true });
	});

	test("every built-in name is synchronous, reads the document, or waits, and only one of those", () => {
		for (const [name, pkg] of names) {
			const kinds = [SYNCHRONOUS_PLUGIN_FUNCTIONS.has(name), DOCUMENT_READING_PLUGIN_FUNCTIONS.has(name), WAITS.has(name)].filter(Boolean).length;
			expect({ name, pkg, kinds }).toEqual({ name, pkg, kinds: 1 });
		}
		for (const name of DOCUMENT_READING_PLUGIN_FUNCTIONS) expect({ name, registered: names.has(name) }).toEqual({ name, registered: true });
	});

	test("boundary: a waiting name, a different case, the empty name", () => {
		expect(pluginCallOptions("weather")).toEqual({});
		expect(pluginCallOptions("PREV")).toEqual({});
		expect(pluginCallOptions("")).toEqual({});
	});

	test("hostile: a prototype word reads nothing, and the options cannot be changed", () => {
		for (const word of PROTOTYPE_WORDS) expect(pluginCallOptions(word)).toEqual({});
		expect(Object.isFrozen(pluginCallOptions("prev"))).toBe(true);
	});
});

describe("the parts: BytecodeBuilder.readsDocument", () => {
	/** A builder that knows the three names used here. */
	function builder(): BytecodeBuilder {
		return new BytecodeBuilder(new Map([["prev", 0], ["textUpper", 1], ["weather", 2]]));
	}

	test("ordinary: a reading call sets it and marks the program", () => {
		const b = builder();
		emitBuiltinPluginCall(b, "prev", 0);
		expect(b.readsDocument).toBe(true);
		expect(b.build().hasAsync).toBe(true);
	});

	test("boundary: a synchronous call and a waiting call leave it unset, and reset clears it", () => {
		const b = builder();
		emitBuiltinPluginCall(b, "textUpper", 1);
		emitBuiltinPluginCall(b, "weather", 1);
		expect(b.readsDocument).toBe(false);
		emitBuiltinPluginCall(b, "prev", 0);
		expect(b.readsDocument).toBe(true);
		b.reset();
		expect(b.readsDocument).toBe(false);
	});

	test("hostile: synchronous and readsDocument together is synchronous, and an unknown name sets nothing", () => {
		const b = builder();
		b.emitPluginCall("prev", 0, { synchronous: true, readsDocument: true });
		expect(b.readsDocument).toBe(false);
		expect(b.build().hasAsync).toBe(false);
		expect(() => b.emitPluginCall("constructor", 0, { readsDocument: true })).toThrow(/No registered plugin function/);
		expect(b.readsDocument).toBe(false);
	});
});

describe("adversarial: security", () => {
	test("a prototype word as the function or parameter name is refused honestly and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word}(x) = x + prev`);
				expectHonestLine(`f(${word}) = ${word} + line 1`);
			}
		});
	});

	test("a long body that reads a line is refused within the budget", () => {
		expect(expectHonestLine(`f(x) = ${"x + ".repeat(2_000)}prev`, { budgetMs: 5_000 }).kind).toBe("thrown");
		expectHonestDocument(`f(x) = x + prev\n${"f(1)\n".repeat(200)}`);
	});

	test("markup-shaped text after the body is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`f(x) = x + prev ${edge}`);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a body that both reads a line and waits is refused for reading the line", () => {
		expect(outcome("f(x) = x + line 1 + weather in London")).toBe(readsLines("f"));
	});

	test("a section, a tag and a table column in a body are refused the same way", () => {
		expect(both(["# Costs", "10", 'f(x) = x + total of section "Costs"'])[2]).toMatch(/^ERROR "f\(\.\.\.\)"'s body reads other lines/);
		expect(both(["| a |", "| --- |", "| 1 |", "", 'f(x) = x + sum of column "a"'])[4]).toMatch(/^ERROR "f\(\.\.\.\)"'s body reads other lines/);
	});

	test("a call of the refused function says it is not defined, and a synchronous body still works", () => {
		expect(both(["f(x) = x + prev", "f(1)"])[1]).toMatch(/^ERROR Undefined function: f/);
		expect(both(["g(s) = upper(s)", 'g("a")'])).toEqual(["g(s) defined", "A"]);
	});
});

describe("adversarial: edge cases", () => {
	test("each numeric edge in the body beside the line read is still that refusal", () => {
		for (const line of fill("f(x) = X + prev", NUMERIC_EDGES)) expect(outcome(line)).toBe(readsLines("f"));
	});

	test("a body of nothing but a line reference", () => {
		expect(outcome("f(x) = line 1")).toBe(readsLines("f"));
		expect(outcome("f(x) = prev")).toBe(readsLines("f"));
	});

	test("CRLF and a trailing newline", () => {
		expectHonestDocument("10\r\nf(x) = x + prev\r\n");
	});
});
