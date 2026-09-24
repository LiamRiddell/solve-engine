/**
 * Reference-aware editing through the language service: find references, go to
 * definition, hover, rename, and keeping `line N` on its line when lines are
 * inserted or deleted (issue #524).
 *
 * The property every test here leans on is the one the feature exists for: a
 * word is a variable only where the engine reads it as one. A line that does
 * not parse is prose, and nothing on it is ever reported or edited. The rename
 * and shift tests also run the document before and after through both document
 * passes and compare the answers, since an edit that reads differently is the
 * failure that matters, not an edit at an unexpected offset.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { LanguageService } from "@solve-js/language/LanguageService";
import { applyTextEdits, type LineShift, type TextEdit } from "@solve-js/language/DocumentReferences";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Each line's formatted answer, or `ERROR: <message>`, from a document result. */
function readLines(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR: ${line.error}`;
		if (!line.result) return "";
		const formatted = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR: ${formatted}` : formatted;
	});
}

const batch = (text: string): string[] => readLines(newTrackedEngine().parseDocument(text));
const incremental = (text: string): string[] => readLines(evaluateDocument(newTrackedEngine(), text));

let engine: ExpressionEngine;
let service: LanguageService;

beforeEach(() => {
	engine = newTrackedEngine();
	service = new LanguageService(engine);
});

afterEach(() => {
	engine.clear();
});

const doc = (...lines: string[]): string => lines.join("\n");

/** `line:from-to:kind`, compactly, for asserting a list of references. */
function spans(refs: { line: number; from: number; to: number; kind: string }[]): string[] {
	return refs.map((r) => `${r.line}:${r.from}-${r.to}:${r.kind}`);
}

/** Apply a successful rename, failing the test with the refusal otherwise. */
function renamed(text: string, line: number, character: number, newName: string): string {
	const result = service.rename(text, { line, character }, newName);
	if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
	return applyTextEdits(text, result.edits);
}

/** Apply a successful shift, failing the test with the refusal otherwise. */
function shifted(text: string, change: LineShift): string {
	const result = service.shiftLineReferences(text, change);
	if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
	return applyTextEdits(text, result.edits);
}

describe("the issue's rename: variables are renamed, prose is not", () => {
	const text = doc(":tax = 20%", "100 + 100 * tax", "tax is due in April");

	test("edits lines 1 and 2 only", () => {
		const result = service.rename(text, { line: 1, character: 2 }, "vat");
		expect(result).toEqual({
			ok: true,
			edits: [
				{ line: 1, from: 1, to: 4, text: "vat" },
				{ line: 2, from: 12, to: 15, text: "vat" },
			],
		});
		expect(applyTextEdits(text, (result as { edits: TextEdit[] }).edits)).toBe(
			doc(":vat = 20%", "100 + 100 * vat", "tax is due in April"),
		);
	});

	test("line 2 still gives 120, through both document passes", () => {
		const after = renamed(text, 2, 13, "vat");
		expect(batch(text)[1]).toBe("120");
		expect(batch(after)[1]).toBe("120");
		expect(incremental(after)[1]).toBe("120");
		expect(batch(after)).toEqual(batch(text));
		expect(incremental(after)).toEqual(incremental(text));
	});

	test("the prose tax is not a reference, and renaming from it is refused", () => {
		expect(service.findReferences(text, { line: 3, character: 1 })).toEqual([]);
		const result = service.rename(text, { line: 3, character: 1 }, "vat");
		expect(result.ok).toBe(false);
		expect(result.ok || result.code).toBe("RENAME_NOT_A_VARIABLE");
	});
});

describe("findReferences reads a line the way the batch pass does", () => {
	test("definitions and reads, in document order", () => {
		const text = doc(":tax = 20%", "100 + 100 * tax", "tax is due in April", "tax * 2");
		expect(spans(service.findReferences(text, { line: 4, character: 0 }))).toEqual([
			"1:1-4:definition",
			"2:12-15:read",
			"4:0-3:read",
		]);
	});

	test("a position just past the name still counts, one further does not", () => {
		const text = doc(":tax = 20%", "tax * 2");
		expect(service.findReferences(text, { line: 2, character: 3 })).toHaveLength(2);
		expect(service.findReferences(text, { line: 2, character: 4 })).toEqual([]);
	});

	test("a label is prose: only the name after the colon is read", () => {
		const text = doc(":tax = 2", "tax: 100 * tax");
		expect(spans(service.findReferences(text, { line: 1, character: 1 }))).toEqual(["1:1-4:definition", "2:11-14:read"]);
		expect(service.findReferences(text, { line: 2, character: 1 })).toEqual([]);
	});

	test("a comment, a blockquote and a string are not code", () => {
		const text = doc(":a = 4", 'a * 2 // a is nice', "> a * 3", '"a" + "b"');
		expect(spans(service.findReferences(text, { line: 1, character: 1 }))).toEqual(["1:1-2:definition", "2:0-1:read"]);
	});

	test("inside inline solves and list items, at their place on the line", () => {
		const inline = doc("The tax is s`100 * tax` and s`tax * 2`", ":tax = 3");
		expect(spans(service.findReferences(inline, { line: 2, character: 2 }))).toEqual([
			"1:19-22:read",
			"1:30-33:read",
			"2:1-4:definition",
		]);
		const list = doc("- :a = 4", "- a * 2");
		expect(spans(service.findReferences(list, { line: 2, character: 2 }))).toEqual(["1:3-4:definition", "2:2-3:read"]);
	});

	test("a global and a local of the same name are different variables", () => {
		const text = doc("global :rate = 5%", "global :rate * 100", ":rate = 3", "rate * 2");
		const globals = service.findReferences(text, { line: 1, character: 9 });
		expect(spans(globals)).toEqual(["1:8-12:definition", "2:8-12:read"]);
		expect(globals.every((r) => r.global)).toBe(true);
		expect(spans(service.findReferences(text, { line: 4, character: 1 }))).toEqual(["3:1-5:definition", "4:0-4:read"]);
	});

	test("a function's parameter is not the document's variable of that name", () => {
		const text = doc("f(x) = 2*x + 1", "f(3)", ":x = 10", "f(x)");
		expect(spans(service.findReferences(text, { line: 3, character: 1 }))).toEqual(["3:1-2:definition", "4:2-3:read"]);
		expect(spans(service.findReferences(text, { line: 1, character: 0 }))).toEqual([
			"1:0-1:definition",
			"2:0-1:read",
			"4:0-1:read",
		]);
		expect(service.findReferences(text, { line: 1, character: 2 })).toEqual([]);
	});

	test("a goal seek's unknown names the variable it varies", () => {
		const text = doc(":x = 0", "x * 2 + 10", "solve line 2 for x = 30");
		expect(spans(service.findReferences(text, { line: 1, character: 1 }))).toEqual([
			"1:1-2:definition",
			"2:0-1:read",
			"3:17-18:read",
		]);
	});

	test("a unit definition's name is a unit, not a variable", () => {
		const text = doc("1 sprint = 2 weeks", "3 sprints in days");
		expect(service.findReferences(text, { line: 1, character: 3 })).toEqual([]);
	});

	test("a note's own unit is a unit below its definition, on an engine that has never evaluated the note", () => {
		// The service's engine here has not run the note, so the unit is not in
		// its table; the note's definitions above each line are read with it.
		const text = doc("1 sprint = 2 weeks", "3 sprints in days", ":x = 3", "2 x");
		expect(service.findReferences(text, { line: 2, character: 3 })).toEqual([]);
		expect(service.rename(text, { line: 2, character: 3 }, "laps")).toMatchObject({ ok: false, code: "RENAME_NOT_A_VARIABLE" });
		// `2 x` renamed to `2 sprints` would become a quantity of the unit.
		expect(service.rename(text, { line: 3, character: 1 }, "sprints")).toMatchObject({ ok: false, code: "RENAME_CHANGES_MEANING" });
		// Above its definition, the same word is still an ordinary name.
		expect(spans(service.findReferences(doc("3 sprints", "1 sprint = 2 weeks"), { line: 1, character: 3 }))).toEqual(["1:2-9:read"]);
	});

	test("a variable that shares a unit's name is still found where it is a variable", () => {
		const text = doc(":s = 5", "s * 2", "3 s");
		expect(spans(service.findReferences(text, { line: 1, character: 1 }))).toEqual(["1:1-2:definition", "2:0-1:read"]);
	});
});

describe("getDefinition and getHover", () => {
	test("a read goes to the last definition above it", () => {
		const text = doc(":x = 5", ":x = x + 1", "x");
		// The right-hand side of line 2 reads the x defined on line 1.
		expect(service.getDefinition(text, { line: 2, character: 6 })).toMatchObject({ line: 1, from: 1, to: 2, kind: "definition" });
		expect(service.getDefinition(text, { line: 3, character: 0 })).toMatchObject({ line: 2, from: 1, to: 2 });
		// A definition is its own definition.
		expect(service.getDefinition(text, { line: 2, character: 1 })).toMatchObject({ line: 2, from: 1 });
	});

	test("a read above every definition has none, which is when the engine says undefined", () => {
		const text = doc("100 * tax", ":tax = 2");
		expect(service.getDefinition(text, { line: 1, character: 7 })).toBeNull();
		expect(batch(text)[0]).toBe("ERROR: Undefined variable: tax");
	});

	test("not on a variable: no definition, no hover", () => {
		const text = doc(":tax = 2", "tax is due");
		expect(service.getDefinition(text, { line: 2, character: 1 })).toBeNull();
		expect(service.getHover(text, { line: 2, character: 1 })).toBeNull();
	});

	test("the hover shows the defining line and its value from the host's results", () => {
		const text = doc(":tax = 20%", "100 + 100 * tax");
		const hover = service.getHover(text, { line: 2, character: 13 }, newTrackedEngine().parseDocument(text));
		expect(hover?.reference).toMatchObject({ line: 2, from: 12, to: 15, name: "tax", kind: "read" });
		expect(hover?.definition).toMatchObject({ line: 1, from: 1, to: 4 });
		expect(hover?.definitionText).toBe(":tax = 20%");
		expect(formatValue(hover!.value!)).toBe("= 20.00%");
	});

	test("results can be a function from line to value, and are optional", () => {
		const text = doc(":tax = 20%", "tax * 2");
		const parsed = newTrackedEngine().parseDocument(text);
		const viaFunction = service.getHover(text, { line: 2, character: 0 }, (line) => parsed.lines[line - 1].result);
		expect(formatValue(viaFunction!.value!)).toBe("= 20.00%");
		const withoutResults = service.getHover(text, { line: 2, character: 0 });
		expect(withoutResults?.definition).toMatchObject({ line: 1 });
		expect(withoutResults?.value).toBeNull();
	});

	test("a definition inside an inline solve reads that solve's value", () => {
		const text = doc("Rate s`:r = 4` here", "r * 3");
		const hover = service.getHover(text, { line: 2, character: 0 }, newTrackedEngine().parseDocument(text));
		expect(hover?.definition).toMatchObject({ line: 1, from: 8, to: 9 });
		expect(formatValue(hover!.value!)).toBe("= 4");
	});
});

describe("rename", () => {
	test("renames a function, a running total, a bare assignment and a goal seek's unknown", () => {
		expect(renamed(doc("f(x) = 2*x + 1", "f(3)"), 1, 0, "double")).toBe(doc("double(x) = 2*x + 1", "double(3)"));
		expect(renamed(doc("total += 5", "total += 7", "total"), 3, 1, "spent")).toBe(doc("spent += 5", "spent += 7", "spent"));
		expect(renamed(doc("tax = 20%", "100 + tax", "tax is due"), 1, 0, "vat")).toBe(doc("vat = 20%", "100 + vat", "tax is due"));
		expect(renamed(doc(":x = 0", "x * 2 + 10", "solve line 2 for x = 30"), 1, 1, "y")).toBe(
			doc(":y = 0", "y * 2 + 10", "solve line 2 for y = 30"),
		);
	});

	test("every answer is unchanged, through both passes", () => {
		const text = doc(":price = 40", "total += price", "total += price * 2", "f(n) = n + price", "f(1) + total");
		const after = renamed(text, 1, 1, "cost");
		expect(after).toBe(doc(":cost = 40", "total += cost", "total += cost * 2", "f(n) = n + cost", "f(1) + total"));
		expect(batch(after)).toEqual(batch(text));
		expect(incremental(after)).toEqual(incremental(text));
		expect(batch(text)[4]).toBe("161");
	});

	test("renaming to the same name makes no edits", () => {
		expect(service.rename(doc(":a = 1", "a"), { line: 2, character: 0 }, "a")).toEqual({ ok: true, edits: [] });
	});

	test("keeps the document's own line breaks", () => {
		expect(renamed(":a = 1\r\na * 2\r\n", 1, 1, "b2")).toBe(":b2 = 1\r\nb2 * 2\r\n");
	});

	test.each([
		["pi", "RENAME_KEYWORD"],
		["in", "RENAME_KEYWORD"],
		["prev", "RENAME_KEYWORD"],
		["line3", "RENAME_KEYWORD"],
		["km", "RENAME_UNIT_NAME"],
		["EUR", "RENAME_UNIT_NAME"],
		["2x", "RENAME_INVALID_NAME"],
		["x y", "RENAME_INVALID_NAME"],
		[":vat", "RENAME_INVALID_NAME"],
		["", "RENAME_INVALID_NAME"],
	])("a new name %j is refused with %s", (newName, code) => {
		const result = service.rename(doc(":tax = 20%", "100 * tax"), { line: 1, character: 1 }, newName);
		expect(result.ok).toBe(false);
		expect(result.ok || result.code).toBe(code);
		expect(result.ok || result.message).toContain(newName === "" ? "not a valid name" : newName);
	});

	test("a name the document already uses is refused, naming the line", () => {
		const text = doc(":tax = 20%", ":rate = 3", "tax * rate");
		const result = service.rename(text, { line: 1, character: 1 }, "rate");
		expect(result).toMatchObject({ ok: false, code: "RENAME_NAME_TAKEN" });
		expect(result.ok || result.message).toContain("line 2");
	});

	test("a name read but never defined is taken as well, since the rename would bind it", () => {
		const result = service.rename(doc(":tax = 20%", "tax * rate"), { line: 1, character: 1 }, "rate");
		expect(result).toMatchObject({ ok: false, code: "RENAME_NAME_TAKEN" });
	});

	test("a unit the document defines is taken", () => {
		const result = service.rename(doc("1 sprint = 2 weeks", ":x = 3", "x sprints in days"), { line: 2, character: 1 }, "sprint");
		expect(result).toMatchObject({ ok: false, code: "RENAME_NAME_TAKEN" });
	});

	test("a global is refused, since other documents read it", () => {
		const result = service.rename(doc("global :rate = 5%", "global :rate * 100"), { line: 1, character: 9 }, "r2");
		expect(result).toMatchObject({ ok: false, code: "RENAME_GLOBAL_NAME" });
	});

	test("a rename that would change how a line reads is refused", () => {
		// `sum(` is the map-reduce call, so `f(3)` renamed to `sum(3)` is a different expression.
		expect(service.rename(doc("f(x) = 2*x + 1", "f(3)"), { line: 1, character: 0 }, "sum")).toMatchObject({
			ok: false,
			code: "RENAME_CHANGES_MEANING",
		});
		// `y` renamed to `x` inside `f(x) = 2*x + y` would become the parameter.
		expect(service.rename(doc(":y = 1", "f(x) = 2*x + y", "f(3)"), { line: 1, character: 1 }, "x")).toMatchObject({
			ok: false,
			code: "RENAME_CHANGES_MEANING",
		});
	});

	test("without an engine nothing is code, and the refusal says why", () => {
		const bare = new LanguageService(null);
		expect(bare.rename(":a = 1", { line: 1, character: 1 }, "b2")).toMatchObject({ ok: false, code: "RENAME_NO_ENGINE" });
		expect(bare.findReferences(":a = 1", { line: 1, character: 1 })).toEqual([]);
		expect(bare.shiftLineReferences("1", { kind: "insert", line: 1, count: 1 })).toMatchObject({ ok: false, code: "LINE_SHIFT_NO_ENGINE" });
	});
});

describe("shiftLineReferences", () => {
	test("the issue's insertion: a line above `line 1 + line 2` gives `line 2 + line 3`, and the answer is unchanged", () => {
		const before = doc("10", "20", "line 1 + line 2");
		const inserted = doc("", "10", "20", "line 1 + line 2");
		const result = service.shiftLineReferences(inserted, { kind: "insert", line: 1, count: 1 });
		expect(result).toEqual({
			ok: true,
			edits: [
				{ line: 4, from: 5, to: 6, text: "2" },
				{ line: 4, from: 14, to: 15, text: "3" },
			],
			deleted: [],
		});
		const after = applyTextEdits(inserted, (result as { edits: TextEdit[] }).edits);
		expect(after).toBe(doc("", "10", "20", "line 2 + line 3"));
		expect(batch(before)[2]).toBe("30");
		expect(batch(after)[3]).toBe("30");
		expect(incremental(after)[3]).toBe("30");
	});

	// #596: a what-if and a sweep fuse their `line N` into one token, which the
	// shift used to pass over, so an inserted line left them on the old line.
	test("a what-if and a sweep target are renumbered, and their answers are unchanged", () => {
		const lines = ["x = 1", "y = x * 10 + 10", "line 2 with x = 5", "line 2 for x from 1 to 3 step 1"];
		const inserted = doc("# Heading", ...lines);
		const after = shifted(inserted, { kind: "insert", line: 1, count: 1 });
		expect(after).toBe(doc("# Heading", "x = 1", "y = x * 10 + 10", "line 3 with x = 5", "line 3 for x from 1 to 3 step 1"));
		expect(batch(doc(...lines)).slice(2)).toEqual(["60", "[20, 30, 40]"]);
		expect(batch(after).slice(3)).toEqual(["60", "[20, 30, 40]"]);
		expect(incremental(after).slice(3)).toEqual(["60", "[20, 30, 40]"]);
	});

	test("a what-if into a deleted line becomes `line deleted`, and says so", () => {
		const after = shifted(doc("y = 2", "line 1 with x = 5"), { kind: "delete", line: 1, count: 1 });
		expect(after).toBe(doc("y = 2", "line deleted with x = 5"));
		expect(batch(after)[1]).toBe(incremental(after)[1]);
		expect(batch(after)[1]).toMatch(/^ERROR:/);
	});

	test("a reference above the insertion is left alone", () => {
		expect(shifted(doc("10", "line 1 * 2", "new", "20", "line 3 + 1"), { kind: "insert", line: 3, count: 1 })).toBe(
			doc("10", "line 1 * 2", "new", "20", "line 4 + 1"),
		);
	});

	test("glued references, inline solves and list items are shifted in place", () => {
		expect(shifted(doc("", "10", "line1*2", "- line 1 + 1", "is s`line 1 * 3` ok"), { kind: "insert", line: 1, count: 1 })).toBe(
			doc("", "10", "line2*2", "- line 2 + 1", "is s`line 2 * 3` ok"),
		);
	});

	test("the inserted lines, prose, and the relative forms are left as written", () => {
		// The inserted line was written against the document as it now stands.
		expect(shifted(doc("10", "line 1 * 5", "line 1 + 1"), { kind: "insert", line: 2, count: 1 })).toBe(
			doc("10", "line 1 * 5", "line 1 + 1"),
		);
		// Prose does not parse, and prev and total above read what is above them now.
		expect(shifted(doc("", "10", "see line 1 above", "prev", "total above"), { kind: "insert", line: 1, count: 1 })).toBe(
			doc("", "10", "see line 1 above", "prev", "total above"),
		);
	});

	test("a range's ends move independently: an insertion inside a range is inside it afterwards", () => {
		const after = shifted(doc("10", "15", "20", "30", "sum(line 1 : line 3)"), { kind: "insert", line: 2, count: 1 });
		expect(after).toBe(doc("10", "15", "20", "30", "sum(line 1 : line 4)"));
		expect(batch(after)[4]).toBe("75");
		expect(shifted(doc("", "10", "20", "average(line 2 : line 1)"), { kind: "insert", line: 1, count: 1 })).toBe(
			doc("", "10", "20", "average(line 3 : line 2)"),
		);
	});

	test("a deletion renumbers what moved and writes a reference into the deleted line as `line deleted`", () => {
		const before = doc("10", "20", "30", "line 3 - line 1", "line 2 * 2", "solve line 2 for x = 5");
		const deletedDoc = doc("10", "30", "line 3 - line 1", "line 2 * 2", "solve line 2 for x = 5");
		const result = service.shiftLineReferences(deletedDoc, { kind: "delete", line: 2, count: 1 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.deleted).toEqual([
			{ line: 4, from: 0, to: 6, target: 2 },
			{ line: 5, from: 6, to: 12, target: 2 },
		]);
		const after = applyTextEdits(deletedDoc, result.edits);
		expect(after).toBe(doc("10", "30", "line 2 - line 1", "line deleted * 2", "solve line deleted for x = 5"));
		expect(batch(before)[3]).toBe("20");
		const deletedError = "ERROR: This reference pointed at a line that has been deleted";
		for (const answers of [batch(after), incremental(after)]) {
			expect(answers.slice(2)).toEqual(["20", deletedError, deletedError]);
		}
	});

	test("a range loses its deleted lines, and only a range with none left becomes `line deleted`", () => {
		expect(shifted(doc("1", "2", "sum(line 1 : line 4)"), { kind: "delete", line: 3, count: 2 })).toBe(doc("1", "2", "sum(line 1 : line 2)"));
		expect(shifted(doc("5", "sum(line 2 : line 4)"), { kind: "delete", line: 2, count: 3 })).toBe(
			doc("5", "sum(line deleted : line deleted)"),
		);
		const result = service.shiftLineReferences(doc("5", "sum(line 2 : line 4)"), { kind: "delete", line: 2, count: 3 });
		expect(result.ok && result.deleted.map((d) => d.target)).toEqual([2, 4]);
	});

	test.each<[string, LineShift, number]>([
		["an insertion past the end of the text", { kind: "insert", line: 2, count: 2 }, 2],
		["a deletion past the end of the text", { kind: "delete", line: 3, count: 1 }, 1],
		["line 0", { kind: "insert", line: 0, count: 1 }, 1],
		["a count of 0", { kind: "insert", line: 1, count: 0 }, 1],
		["a fractional line", { kind: "delete", line: 1.5, count: 1 }, 1],
	])("%s is refused", (_label, change, lines) => {
		const text = Array.from({ length: lines }, (_, i) => String(i + 1)).join("\n");
		expect(service.shiftLineReferences(text, change)).toMatchObject({ ok: false, code: "LINE_SHIFT_OUT_OF_RANGE" });
	});
});

describe("reading a document has no side effects on the engine", () => {
	test("a running total is not advanced and a unit is not defined", () => {
		const text = doc("total += 5", "1 sprint = 2 weeks", "total");
		expect(readLines(engine.parseDocument(text))[2]).toBe("5");
		const unitBefore = engine.evaluateExpression("3 sprints in days");
		for (let i = 0; i < 3; i++) {
			service.findReferences(text, { line: 3, character: 0 });
			service.shiftLineReferences(text, { kind: "insert", line: 1, count: 1 });
		}
		// tryCompileExpression would have run `total += 5` three more times.
		expect(formatValue(engine.evaluateExpression("total"))).toBe("= 5");
		expect(formatValue(engine.evaluateExpression("3 sprints in days"))).toBe(formatValue(unitBefore));
	});

	test("the note's units are read with, and not left behind in an engine that never evaluated it", () => {
		const fresh = newTrackedEngine();
		const answer = (): string => {
			try {
				return formatValue(fresh.evaluateExpression("3 sprints in days"));
			} catch (error) {
				return (error as Error).message;
			}
		};
		const before = answer();
		expect(before).toContain("Undefined variable: sprints");
		new LanguageService(fresh).findReferences(doc("1 sprint = 2 weeks", "3 sprints in days"), { line: 2, character: 3 });
		expect(answer()).toBe(before);
	});
});

describe("ExpressionEngine.readExpressionTokens", () => {
	test("prose and half-typed lines are not expressions", () => {
		expect(engine.readExpressionTokens("tax is due in April")).toBeNull();
		expect(engine.readExpressionTokens("total =")).toBeNull();
		expect(engine.readExpressionTokens('"unterminated')).toBeNull();
	});

	test("a label is set aside: the parser starts after the colon", () => {
		const read = engine.readExpressionTokens("rent: 100 * tax");
		expect(read?.start).toBe(2);
		expect(read?.tokens.slice(read.start).map((t) => t.type)).toEqual(["NUMBER", "STAR", "IDENT"]);
		expect(engine.readExpressionTokens("100 * tax")?.start).toBe(0);
	});

	test("statements the engine runs are recognised by shape, and a unit definition says so", () => {
		for (const statement of ["total += 5", "tax = 20%", "x^2 - 4 = 0", "x =>"]) {
			expect(engine.readExpressionTokens(statement)).toMatchObject({ start: 0, unit: null });
		}
		expect(engine.readExpressionTokens("1 sprint = 2 weeks")?.unit).toEqual({ nameWords: ["sprint"], ratioText: "2", baseUnit: "weeks" });
		// A name of several words, which neither side would parse on its own.
		expect(engine.readExpressionTokens("1 story point = 4 hours")?.unit?.nameWords).toEqual(["story", "point"]);
	});

	test("a note's units can be passed in, and are gone again afterwards", () => {
		const sprint = { nameWords: ["sprint"], ratioText: "2", baseUnit: "weeks" };
		const types = (units: (typeof sprint)[]) => engine.readExpressionTokens("3 sprints", units)?.tokens.map((t) => t.type);
		// Unknown, `sprints` is a name; known, it is a quantity of weeks.
		expect(types([])).toEqual(["NUMBER", "STAR", "IDENT"]);
		expect(types([sprint])).toEqual(["NUMBER", "STAR", "NUMBER", "UNIT"]);
		expect(types([])).toEqual(["NUMBER", "STAR", "IDENT"]);
	});
});

describe("applyTextEdits", () => {
	test("applies edits on one line from the last to the first", () => {
		const edits: TextEdit[] = [
			{ line: 1, from: 0, to: 1, text: "alpha" },
			{ line: 1, from: 4, to: 5, text: "beta" },
		];
		expect(applyTextEdits("a + b", edits)).toBe("alpha + beta");
	});

	test("no edits leaves the text as it was", () => {
		expect(applyTextEdits("x\r\ny", [])).toBe("x\r\ny");
	});
});
