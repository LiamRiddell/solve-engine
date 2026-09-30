import { describe, expect, test } from "@jest/globals";
import { serializeParsedLine, serializeParsingResult, serializeSpan, serializeValue } from "@solve-js/worker/serialize";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #725: no page explained a result as JSON. `serializeValue` and
 * `serializeParsingResult` (the worker's display shape) were documented
 * nowhere, and `JSON.stringify` of a result threw until `Value.toJSON` (#598).
 * `guide/results-as-json.md` now sets out the three shapes. This spec runs that
 * page's examples, and covers the one gap writing it found: the worker's
 * serialised line dropped the `errorCode` and `errorSpan` a document line has
 * carried on the main thread since #709, so a host behind the worker could not
 * branch on a line's failure code. Both are now on `SerializedParsedLine` and
 * `SerializedInlineSolve`, through `serializeSpan`.
 *
 * The snapshot's own `serializeValue` (`engine/EngineSnapshot.ts`) is renamed
 * `snapshotValue`, so the source no longer has two functions of one name
 * writing two different shapes.
 */

const engine = newTrackedEngine();
const settings = engine.getFormattingSettings();
const json = (source: string): string => JSON.stringify(engine.evaluateExpression(source));

describe("the page's examples: a value as it is", () => {
	test.each([
		["2 + 3", '{"type":0,"value":5}'],
		["0.1 + 0.2", '{"type":0,"value":0.3,"exact":"0.3"}'],
		["$10", '{"type":6,"value":10,"unit":"USD","exact":"10"}'],
		["1/3", '{"type":0,"value":0.3333333333333333,"rational":"1/3"}'],
		["5 kg to m", '{"type":13,"value":"INCOMPATIBLE_UNITS","unit":"a mass cannot be converted to a length"}'],
		["12345678901234567891n", '{"type":2,"value":"12345678901234567891"}'],
		["1/0", '{"type":0,"value":null}'],
	])("%s", (source, expected) => {
		expect(json(source)).toBe(expected);
	});

	test("a whole document stringifies", () => {
		const text = JSON.stringify(engine.parseDocument("a = 1.5\na * 2"));
		expect(JSON.parse(text).lines[0].result).toEqual({ type: 0, value: 1.5, exact: "1.5" });
	});
});

describe("the page's examples: the display shape", () => {
	test.each([
		["0.1 + 0.2", { type: 0, text: "= 0.30", number: 0.3 }],
		["5 km", { type: 6, text: "= 5.00 km", number: 5, unit: "km" }],
		["$10", { type: 6, text: "= $10.00", number: 10, unit: "USD" }],
		["1/0", { type: 0, text: "= ∞", number: 0, nonFinite: "Infinity" }],
		["5 kg to m", { type: 13, text: "a mass cannot be converted to a length", number: 0, errorCode: "INCOMPATIBLE_UNITS" }],
	])("%s", (source, expected) => {
		expect(serializeValue(engine.evaluateExpression(source), settings)).toEqual(expected);
	});

	test("a document, with the failing line's code and span", () => {
		const doc = serializeParsingResult(engine.parseDocument("a = 1.5\na * 2\n3 + * 4"), settings);
		expect(doc.lines[0].result).toEqual({ type: 0, text: "= 1.50", number: 1.5 });
		expect(doc.lines[1].result).toEqual({ type: 0, text: "= 3", number: 3 });
		expect(doc.lines[2].error).toBe('Expected a value after "+", but found "*"');
		expect(doc.lines[2].errorCode).toBe("NO_PREFIX_PARSELET");
		expect(doc.lines[2].errorSpan).toEqual({ start: 4, end: 5, line: 3, col: 5 });
		expect(doc.errors).toEqual(['Line 3: Expected a value after "+", but found "*"']);
	});

	test("the snapshot restores, as the page says the others do not", () => {
		const source = newTrackedEngine();
		source.parseDocument(":price = 100\n:total = price * 2");
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(source.toJSON())), { packages: BUILTIN_PACKAGES });
		expect(restored.formatValue(restored.evaluateExpression("total + 1"))).toBe("= 201");
		restored.clear();
	});
});

// ── serializeSpan, the part ──────────────────────────────────────────────

describe("serializeSpan", () => {
	test("copies a full span", () => {
		const span = { start: 4, end: 5, line: 3, col: 5 };
		const out = serializeSpan(span);
		expect(out).toEqual(span);
		expect(out).not.toBe(span);
	});

	test("an absent line or column stays absent, not undefined", () => {
		const out = serializeSpan({ start: 0, end: 1 });
		expect(out).toEqual({ start: 0, end: 1 });
		expect(Object.keys(out!)).toEqual(["start", "end"]);
	});

	test("null, undefined and a non-object are null", () => {
		expect(serializeSpan(null)).toBeNull();
		expect(serializeSpan(undefined)).toBeNull();
		expect(serializeSpan("4..5" as never)).toBeNull();
	});

	test("an object with extra keys crosses as the four fields only", () => {
		const hostile = Object.assign(Object.create({ inherited: 1 }), { start: 1, end: 2, line: 1, col: 2, extra: "x", toString: () => "boom" });
		expect(serializeSpan(hostile)).toEqual({ start: 1, end: 2, line: 1, col: 2 });
	});

	test("a __proto__ key on the span does not reach Object.prototype", () => {
		expectPrototypeUntouched(() => {
			const hostile = JSON.parse('{"start":1,"end":2,"__proto__":{"polluted":true}}');
			const out = serializeSpan(hostile);
			expect(out).toEqual({ start: 1, end: 2 });
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		});
	});

	test("zero-width and edge offsets pass through as numbers", () => {
		expect(serializeSpan({ start: 0, end: 0, line: 1, col: 1 })).toEqual({ start: 0, end: 0, line: 1, col: 1 });
		expect(serializeSpan({ start: 2 ** 53, end: 2 ** 53, line: 1, col: 1 })).toEqual({ start: 2 ** 53, end: 2 ** 53, line: 1, col: 1 });
	});
});

// ── serializeParsedLine and the inline solve, the parts ──────────────────

describe("a serialised line keeps its failure", () => {
	test("a line that ran carries null code and span", () => {
		const line = serializeParsedLine(engine.parseDocument("1 + 1").lines[0], settings);
		expect(line.errorCode).toBeNull();
		expect(line.errorSpan).toBeNull();
	});

	test("a runtime failure with no position has a code and a null span", () => {
		const line = serializeParsedLine(newTrackedEngine().parseDocument("nope + 1").lines[0], settings);
		expect(line.errorCode).toBe("UNDEFINED_VARIABLE");
		expect(line.errorSpan).toBeNull();
	});

	test("a returned failure keeps its code on the result, not the line", () => {
		const line = serializeParsedLine(engine.parseDocument("5 kg to m").lines[0], settings);
		expect(line.errorCode).toBeNull();
		expect(line.result?.errorCode).toBe("INCOMPATIBLE_UNITS");
	});

	test("an inline solve that throws keeps its code and a span in the line's terms", () => {
		const doc = engine.parseDocument("total is s`2 +`");
		const solve = serializeParsedLine(doc.lines[0], settings).inlineSolves[0];
		expect(solve.errorCode).toBe(doc.lines[0].inlineSolves[0].errorCode);
		expect(solve.errorSpan).toEqual(doc.lines[0].inlineSolves[0].errorSpan);
		expect(solve.errorCode).not.toBeNull();
	});

	test("an inline solve that answers has null code and span", () => {
		const solve = serializeParsedLine(engine.parseDocument("total is s`2 + 2`").lines[0], settings).inlineSolves[0];
		expect(solve.result?.text).toBe("= 4");
		expect(solve.errorCode).toBeNull();
		expect(solve.errorSpan).toBeNull();
	});

	test("both document passes serialise to the same line failures", () => {
		const text = "3 + * 4\nnope + 1\n5 kg to m\ntotal is s`2 +`";
		const batch = serializeParsingResult(newTrackedEngine().parseDocument(text), settings);
		const incremental = serializeParsingResult(evaluateDocument(newTrackedEngine(), text), settings);
		const failures = (doc: typeof batch) => doc.lines.map((l) => [l.error, l.errorCode, l.errorSpan, l.inlineSolves.map((s) => [s.errorCode, s.errorSpan])]);
		expect(failures(incremental)).toEqual(failures(batch));
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

/** The DTO and the raw value both survive a JSON round trip unchanged, and structured cloning. */
function roundTrips(source: string): void {
	const e = newTrackedEngine();
	let value;
	try {
		value = e.evaluateExpression(source);
	} catch {
		return;
	}
	const dto = serializeValue(value, settings);
	expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
	expect(structuredClone(dto)).toEqual(dto);
	expect(() => JSON.stringify(value)).not.toThrow();
	expect(dto.text).not.toMatch(/\[object |undefined/);
}

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a document naming %s serialises, with Object.prototype unchanged", (word) => {
		expectPrototypeUntouched(() => {
			const doc = newTrackedEngine().parseDocument(`:${word} = 5\n${word} * 2\n${word} +`);
			const dto = serializeParsingResult(doc, settings);
			expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
			expect(() => JSON.stringify(doc)).not.toThrow();
		});
	});

	test("three thousand failing lines serialise within budget", () => {
		const text = Array.from({ length: 3_000 }, (_, i) => `${i} + * 1`).join("\n");
		const started = performance.now();
		const dto = serializeParsingResult(newTrackedEngine().parseDocument(text), settings);
		expect(dto.lines.every((l) => l.errorCode === "NO_PREFIX_PARSELET" && l.errorSpan !== null)).toBe(true);
		expect(JSON.parse(JSON.stringify(dto)).lines).toHaveLength(3_000);
		expect(performance.now() - started).toBeLessThan(10_000);
	});

	test("a long sum and a long text serialise", () => {
		roundTrips(RESOURCE_PROBES.longSum(2_000));
		roundTrips(RESOURCE_PROBES.longText(10_000));
	});

	test.each(TEXT_EDGES.map((t) => [JSON.stringify(t), t]))("the line %s serialises as text, never as markup", (_label, text) => {
		const doc = newTrackedEngine().parseDocument(text);
		const dto = serializeParsingResult(doc, settings);
		expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
		expect(dto.lines[0]?.text ?? "").toBe(doc.lines[0]?.text ?? "");
	});
});

describe("adversarial: realistic breakage", () => {
	test.each(["5 kg + 3 m", "10 USD + 5 kg", "sqrt(-1)", "nope", "#ff0000", "[1, 2; 3, 4]", "1 +/- 0.1", "x^2 + 2x"])("%s round trips", (source) => {
		roundTrips(source);
	});

	test("a de-DE engine's settings write German text in the DTO", () => {
		const de = newTrackedEngine({ locale: "de-DE" });
		expect(serializeValue(de.evaluateExpression("€1.250"), de.getFormattingSettings()).text).toBe("= €1.250,00");
	});

	test("a value from the line above serialises as the line's own", () => {
		const dto = serializeParsingResult(newTrackedEngine().parseDocument("$9.50\nprev * 2"), settings);
		expect(dto.lines[1].result).toEqual({ type: 6, text: "= $19.00", number: 19, unit: "USD" });
	});
});

describe("adversarial: edge cases", () => {
	test.each(NUMERIC_EDGES)("%s round trips", (source) => {
		roundTrips(source);
	});

	test.each(DOCUMENT_EDGES.map((t) => [JSON.stringify(t).slice(0, 40), t]))("the document %s serialises on both passes alike", (_label, text) => {
		const batch = serializeParsingResult(newTrackedEngine().parseDocument(text), settings);
		expect(JSON.parse(JSON.stringify(batch))).toEqual(batch);
		expect(() => JSON.stringify(newTrackedEngine().parseDocument(text))).not.toThrow();
		expect(() => JSON.stringify(serializeParsingResult(evaluateDocument(newTrackedEngine(), text), settings))).not.toThrow();
	});

	test("negative zero and the non-finite readings are named, not lost", () => {
		expect(serializeValue(newTrackedEngine().evaluateExpression("-1/0"), settings).nonFinite).toBe("-Infinity");
		expect(serializeValue(newTrackedEngine().evaluateExpression("0/0"), settings).nonFinite).toBe("NaN");
		// Negative zero crosses as zero, so JSON and structured cloning agree.
		const zero = serializeValue(newTrackedEngine().evaluateExpression("-0"), settings);
		expect(Object.is(zero.number, 0)).toBe(true);
		expect(Object.is(structuredClone(zero).number, JSON.parse(JSON.stringify(zero)).number)).toBe(true);
	});
});
