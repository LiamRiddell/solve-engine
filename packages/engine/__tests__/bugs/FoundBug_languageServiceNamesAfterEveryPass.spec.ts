import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { LanguageService } from "@solve-js/language/LanguageService";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Found bug: the language service knew no variables after `parseDocument`.
 *
 * Its default `variableNameSource` read the dependency graph's keys, and only
 * the incremental pass (`evaluateDocument`, a live `ThreeTierEvaluator`)
 * records a plain assignment there. After `parseDocument("rent = 1200\nrate =
 * 5\nre")`, or `evaluateLines`, or `evaluateLine` on numbered lines, the graph
 * held nothing for `rent = 1200`, so completing `re` offered no `rent` and a
 * lone `rent` line was not highlighted. The graph also holds every name a line
 * merely reads, so the incremental pass offered the half-typed word itself
 * (`re`) and any undefined name a line mentioned.
 *
 * The default now reads `engine.documentVariableNames()`: the names the
 * document's lines define and the engine still holds, which every pass fills
 * the same way, and which `clear()`, the next document pass and a live
 * editor's settle of an orphaned name take away.
 */

type Pass = "parseDocument" | "evaluateLines" | "evaluateDocument" | "live editor";
const PASSES: readonly Pass[] = ["parseDocument", "evaluateLines", "evaluateDocument", "live editor"];

/** An engine that has run `text` through `pass`, and a language service over it. */
function after(pass: Pass, text: string): { engine: ExpressionEngine; ls: LanguageService } {
	const engine = newTrackedEngine();
	if (pass === "parseDocument") engine.parseDocument(text);
	else if (pass === "evaluateLines") engine.evaluateLines(text.split("\n"));
	else if (pass === "evaluateDocument") evaluateDocument(engine, text);
	else {
		const doc = new DocumentModel();
		doc.setDocument(text);
		const evaluator = new ThreeTierEvaluator(doc, engine);
		evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		evaluator.terminateWorker();
	}
	return { engine, ls: new LanguageService(engine) };
}

/** The variable completions for `prefix` typed at the end of a line. */
function variables(ls: LanguageService, prefix: string): string[] {
	return ls.getCompletions(prefix, prefix.length).filter((c) => c.category === "variable").map((c) => c.label);
}

/** Every completion for `prefix`, label and category, in the order offered. */
function completions(ls: LanguageService, prefix: string): string[] {
	return ls.getCompletions(prefix, prefix.length).map((c) => `${c.label}:${c.category}`);
}

/** Whether a line holding only `word` is highlighted. */
function highlighted(ls: LanguageService, word: string): boolean {
	return ls.getSemanticTokens(word, 99).length > 0;
}

/** A live evaluator over `lines`, with the engine, its service and a way to edit and re-run. */
function liveEditor(lines: readonly string[]) {
	const engine = newTrackedEngine();
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, engine);
	evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
	return {
		engine,
		ls: new LanguageService(engine),
		edit(lineNumber: number, text: string): void {
			doc.editLine(lineNumber, text);
			evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		},
		remove(lineNumber: number): void {
			evaluator.applyTransaction([{ startLine: lineNumber, deleteCount: 1, insertLines: [] }]);
			evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		},
		done(): void {
			evaluator.terminateWorker();
		},
	};
}

const RICH = [
	"rent = 1200",
	"rate = 5",
	"hourly rate = $50",
	":gas = 2",
	"food: 5 #groceries",
	"f(x) = x * 2",
	"broken = undefinedthing + 1",
	"1 sprint = 2 weeks",
	"total += 5",
	"rent * 2",
].join("\n");

describe("the document that exposed it", () => {
	const text = "rent = 1200\nrate = 5\nre";

	test.each(PASSES)("after %s, `re` offers rent and `ra` offers rate", (pass) => {
		const { ls } = after(pass, text);
		expect(variables(ls, "re")).toEqual(["rent"]);
		expect(variables(ls, "ra")).toEqual(["rate"]);
	});

	test.each(PASSES)("after %s, a lone `rent` line is highlighted and a lone `rest` is not", (pass) => {
		const { ls } = after(pass, text);
		expect(highlighted(ls, "rent")).toBe(true);
		expect(highlighted(ls, "rest")).toBe(false);
	});

	test("the half-typed word on the last line is not offered as a name of its own", () => {
		// The incremental pass offered `re` here, since the line reads it.
		const { ls } = after("evaluateDocument", text);
		expect(variables(ls, "re")).not.toContain("re");
		expect(highlighted(ls, "re")).toBe(false);
	});

	test("evaluateLine on numbered lines offers a plain assignment, which the graph never recorded", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "rent = 1200");
		engine.evaluateLine(2, "rate = 5");
		const ls = new LanguageService(engine);
		expect(variables(ls, "r")).toEqual(["rate", "rent"]);
	});

	test("evaluateExpression still offers nothing: a name set outside a document is not the document's", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("rent = 1200");
		const ls = new LanguageService(engine);
		expect(variables(ls, "re")).toEqual([]);
		expect(highlighted(ls, "rent")).toBe(false);
	});
});

describe("every pass knows the same names", () => {
	test.each(PASSES)("after %s the names are the variables, the name of several words, the global, the function and the total", (pass) => {
		const { engine } = after(pass, RICH);
		expect([...engine.documentVariableNames()]).toEqual(["rent", "rate", "hourly rate", "gas", "f", "broken", "total"]);
	});

	test("a name only read is not offered by any pass, nor a label, nor a tag", () => {
		for (const pass of PASSES) {
			const { ls } = after(pass, RICH);
			expect({ pass, un: variables(ls, "undef"), fo: variables(ls, "foo"), gr: variables(ls, "gro") }).toEqual({ pass, un: [], fo: [], gr: [] });
		}
	});

	test.each(["re", "r", "h", "g", "f", "t", "b", "sp", "x"])("the two document passes give the same completion list for %j", (prefix) => {
		const batch = completions(after("parseDocument", RICH).ls, prefix);
		expect(completions(after("evaluateDocument", RICH).ls, prefix)).toEqual(batch);
		expect(completions(after("evaluateLines", RICH).ls, prefix)).toEqual(batch);
		expect(completions(after("live editor", RICH).ls, prefix)).toEqual(batch);
	});

	test("the name of several words is offered by its first word", () => {
		expect(variables(after("parseDocument", RICH).ls, "hour")).toEqual(["hourly rate"]);
	});
});

describe("documentVariableNames, the engine's table", () => {
	test("a fresh engine has none", () => {
		expect([...newTrackedEngine().documentVariableNames()]).toEqual([]);
	});

	test("an empty document has none", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("");
		expect([...engine.documentVariableNames()]).toEqual([]);
	});

	test("names come once each, in the order first defined, a redefinition included", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("b = 1\na = 2\nb = 3");
		expect([...engine.documentVariableNames()]).toEqual(["b", "a"]);
	});

	test("case is kept: Rent and RENT are two names", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("Rent = 1\nRENT = 2");
		expect([...engine.documentVariableNames()]).toEqual(["Rent", "RENT"]);
	});

	test("each call is a fresh iterator", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("a = 1\nb = 2");
		const first = engine.documentVariableNames();
		expect([...first]).toEqual(["a", "b"]);
		expect([...first]).toEqual([]);
		expect([...engine.documentVariableNames()]).toEqual(["a", "b"]);
	});

	test("clear() takes every name away", () => {
		const engine = newTrackedEngine();
		engine.parseDocument(RICH);
		engine.clear();
		expect([...engine.documentVariableNames()]).toEqual([]);
		expect(engine.isDocumentVariableName("rent")).toBe(false);
	});

	test("the next document pass starts without the last document's names", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("rent = 1200");
		engine.parseDocument("rate = 5");
		expect([...engine.documentVariableNames()]).toEqual(["rate"]);
		evaluateDocument(engine, "price = 3");
		expect([...engine.documentVariableNames()]).toEqual(["price"]);
	});

	test("a host's own name set outside a document is not among them, and survives a document pass", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression(":hostRate = 7");
		engine.parseDocument("rent = 1200");
		expect([...engine.documentVariableNames()]).toEqual(["rent"]);
		expect(engine.evaluateNumber("hostRate")).toBe(7);
	});
});

describe("isDocumentVariableName", () => {
	/** A fresh engine per test, since a tracked engine is cleared after each one. */
	function parsed(): ExpressionEngine {
		const engine = newTrackedEngine();
		engine.parseDocument("rent = 1200\nhourly rate = 5\nf(x) = x\nrent * missing");
		return engine;
	}

	test.each([
		["rent", true],
		["hourly rate", true],
		["f", true],
		["missing", false],
		["Rent", false],
		["", false],
		[" rent", false],
		["hourly", false],
		["x", false],
	])("%j is %s", (name, answer) => {
		expect(parsed().isDocumentVariableName(name)).toBe(answer);
	});

	test.each(PROTOTYPE_WORDS)("an inherited property name, %s, is not a name until a line defines it", (word) => {
		expectPrototypeUntouched(() => {
			expect(parsed().isDocumentVariableName(word)).toBe(false);
		});
	});

	test("it agrees with documentVariableNames for every name the document holds", () => {
		const engine = parsed();
		const names = [...engine.documentVariableNames()];
		expect(names).toEqual(["rent", "hourly rate", "f"]);
		for (const name of names) expect(engine.isDocumentVariableName(name)).toBe(true);
	});
});

describe("the names follow a live editor's edits", () => {
	test("renaming a variable takes the old name away and offers the new one", () => {
		const editor = liveEditor(["rent = 1200", "rate = 5", "rent + rate"]);
		try {
			editor.edit(1, "rental = 1200");
			expect([...editor.engine.documentVariableNames()].sort()).toEqual(["rate", "rental"]);
			expect(variables(editor.ls, "ren")).toEqual(["rental"]);
			// The graph still has `rent` (line 3 reads it), which the old default offered.
			expect(highlighted(editor.ls, "rent")).toBe(false);
		} finally {
			editor.done();
		}
	});

	test("deleting the defining line takes the name away", () => {
		const editor = liveEditor(["rent = 1200", "rate = 5", "rent + rate"]);
		try {
			editor.remove(2);
			expect([...editor.engine.documentVariableNames()]).toEqual(["rent"]);
			expect(variables(editor.ls, "ra")).toEqual([]);
		} finally {
			editor.done();
		}
	});

	test("renaming it back offers it again, and a fresh pass of the edited text agrees", () => {
		const editor = liveEditor(["rent = 1200", "rent * 2"]);
		try {
			editor.edit(1, "rental = 1200");
			editor.edit(1, "rent = 1200");
			expect([...editor.engine.documentVariableNames()]).toEqual(["rent"]);
			expect(variables(editor.ls, "ren")).toEqual(variables(after("parseDocument", "rent = 1200\nrent * 2").ls, "ren"));
		} finally {
			editor.done();
		}
	});

	test("a name that stops being defined after many renames is not kept in the table", () => {
		const editor = liveEditor(["n0 = 1"]);
		try {
			for (let i = 1; i <= 200; i++) editor.edit(1, `n${i} = 1`);
			expect([...editor.engine.documentVariableNames()]).toEqual(["n200"]);
		} finally {
			editor.done();
		}
	});
});

describe("a snapshot round trip", () => {
	test("the restored engine offers the document's names and not a host's", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression(":hostRate = 7");
		engine.parseDocument("rent = 1200\nrate = 5\nrent * rate");
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())), { packages: BUILTIN_PACKAGES });
		try {
			const ls = new LanguageService(restored);
			expect(variables(ls, "r")).toEqual(["rate", "rent"]);
			expect(variables(ls, "host")).toEqual([]);
			expect(highlighted(ls, "rent")).toBe(true);
		} finally {
			restored.clear();
		}
	});
});

describe("the language service's own handling", () => {
	test("with no engine there are no names and no lone word is highlighted", () => {
		const ls = new LanguageService(null);
		expect(ls.getCompletions("re", 2)).toEqual([]);
		expect(highlighted(ls, "rent")).toBe(false);
	});

	test("a host's own source replaces the default, for completions and for the lone-word check", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("rent = 1200");
		const ls = new LanguageService(engine, { variableNameSource: () => ["rate"] });
		expect(variables(ls, "r")).toEqual(["rate"]);
		expect(highlighted(ls, "rate")).toBe(true);
		expect(highlighted(ls, "rent")).toBe(false);
	});

	test("a host reading another engine's names through documentVariableNames works as the playground's split does", () => {
		const evaluating = newTrackedEngine();
		evaluating.parseDocument("rent = 1200");
		const lexingOnly = newTrackedEngine();
		const ls = new LanguageService(lexingOnly, { variableNameSource: () => evaluating.documentVariableNames() });
		expect(variables(ls, "re")).toEqual(["rent"]);
		expect(highlighted(ls, "rent")).toBe(true);
	});

	test("a lone word's highlight follows another line's edit without its own text changing", () => {
		const engine = newTrackedEngine();
		const ls = new LanguageService(engine);
		engine.parseDocument("rent = 1200\nrent");
		expect(ls.getSemanticTokens("rent", 2)).toHaveLength(1);
		engine.parseDocument("rental = 1200\nrent");
		expect(ls.getSemanticTokens("rent", 2)).toHaveLength(0);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("%s defined as a variable is offered and highlighted by both passes, and Object.prototype is unchanged", (word) => {
		expectPrototypeUntouched(() => {
			for (const pass of ["parseDocument", "evaluateDocument"] as const) {
				const { engine, ls } = after(pass, `${word} = 5\n${word} * 2`);
				expect({ pass, names: [...engine.documentVariableNames()] }).toEqual({ pass, names: [word] });
				expect(variables(ls, word.slice(0, 3))).toEqual([word]);
				expect(highlighted(ls, word)).toBe(true);
			}
		});
	});

	test("constructor = 5 then completing con offers constructor, as the variable", () => {
		const { ls } = after("parseDocument", "constructor = 5\ncon");
		const item = ls.getCompletions("con", 3).find((c) => c.label === "constructor");
		expect(item).toEqual({ label: "constructor", category: "variable" });
	});

	test.each(PROTOTYPE_WORDS)("%s typed with nothing defined offers no variable and leaves Object.prototype unchanged", (word) => {
		expectPrototypeUntouched(() => {
			const { ls } = after("parseDocument", "rent = 1");
			expect(variables(ls, word)).toEqual([]);
			expect(highlighted(ls, word)).toBe(false);
		});
	});

	test("5,000 defined names keep a keystroke's completion and a lone word's check within budget", () => {
		const text = RESOURCE_PROBES.manyLines(0) + "\n" + Array.from({ length: 5_000 }, (_, i) => `v${i} = ${i}`).join("\n");
		const { engine, ls } = after("parseDocument", text);
		expect([...engine.documentVariableNames()]).toHaveLength(5_000);
		ls.getCompletions("v1", 2);
		let started = performance.now();
		for (let i = 0; i < 20; i++) ls.getCompletions("v12", 3);
		expect((performance.now() - started) / 20).toBeLessThan(50);
		expect(ls.getCompletions("v", 1)).toHaveLength(50);
		started = performance.now();
		for (let i = 0; i < 1_000; i++) ls.getSemanticTokens("v4999", i);
		expect(performance.now() - started).toBeLessThan(500);
		expect(highlighted(ls, "v4999")).toBe(true);
	});

	test("a 1,500-character name is offered whole, and a 10,000-character line is refused and defines nothing", () => {
		const name = RESOURCE_PROBES.longIdentifier(1_500);
		expect(variables(after("parseDocument", `${name} = 1`).ls, "xxx")).toEqual([name]);
		for (const pass of ["parseDocument", "evaluateDocument"] as const) {
			const { engine, ls } = after(pass, `${RESOURCE_PROBES.longIdentifier()} = 1`);
			expect({ pass, names: [...engine.documentVariableNames()] }).toEqual({ pass, names: [] });
			expect(variables(ls, "xxx")).toEqual([]);
		}
	});

	test("a look-alike name (a Cyrillic e) is a name of its own, offered as written", () => {
		const { engine, ls } = after("parseDocument", "rеnt = 1\nrent = 2");
		expect([...engine.documentVariableNames()]).toEqual(["rеnt", "rent"]);
		expect(variables(ls, "re")).toEqual(["rent"]);
		expect(highlighted(ls, "rent")).toBe(true);
	});

	test("a zero-width space inside a name defines nothing in either pass", () => {
		for (const pass of ["parseDocument", "evaluateDocument"] as const) {
			const { engine, ls } = after(pass, "re​nt = 5");
			expect({ pass, names: [...engine.documentVariableNames()] }).toEqual({ pass, names: [] });
			expect(variables(ls, "re")).toEqual([]);
		}
	});

	test.each(["<script>x</script> = 5", "'; DROP TABLE notes; -- = 5", "${rent} = 5", "%s%s = 5"])("markup-shaped text %j defines no name", (line) => {
		for (const pass of ["parseDocument", "evaluateDocument"] as const) {
			const { engine } = after(pass, line);
			expect({ pass, names: [...engine.documentVariableNames()] }).toEqual({ pass, names: [] });
		}
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo in the reading line does not become a name", () => {
		const { ls } = after("parseDocument", "rent = 1200\nrnet * 2");
		expect(variables(ls, "r")).toEqual(["rent"]);
	});

	test("a line that fails still defines its name, in both passes alike", () => {
		for (const pass of ["parseDocument", "evaluateDocument"] as const) {
			const { ls } = after(pass, "broken = undefinedthing + 1");
			expect({ pass, names: variables(ls, "b") }).toEqual({ pass, names: ["broken"] });
		}
	});

	test("a what-if over a name keeps the document's names and adds none of its scratch run", () => {
		const text = "rent = 1200\ncost = rent * 12\nwhat if rent = 1500 then cost";
		for (const pass of ["parseDocument", "evaluateDocument"] as const) {
			const { engine } = after(pass, text);
			expect({ pass, names: [...engine.documentVariableNames()] }).toEqual({ pass, names: ["rent", "cost"] });
		}
	});

	test("a check over a name and a tagged line keep the names the same in both passes", () => {
		const text = "rent = 1200 #housing\nrent > 1000?\n#housing";
		const batch = [...after("parseDocument", text).engine.documentVariableNames()];
		expect([...after("evaluateDocument", text).engine.documentVariableNames()]).toEqual(batch);
		expect(batch).toEqual(["rent"]);
	});

	test("asking for completions and highlighting changes no answer in the document", () => {
		const engine = newTrackedEngine();
		const first = engine.parseDocument("rent = 1200\ntotal += 5\nrent + total").lines.map((l) => l.result?.toString());
		const ls = new LanguageService(engine);
		for (let i = 0; i < 5; i++) {
			ls.getCompletions("re", 2);
			ls.getSemanticTokens("total += 5", 2);
			ls.getSemanticTokens("rent", 9);
		}
		expect(engine.evaluateNumber("total")).toBe(5);
		expect(engine.parseDocument("rent = 1200\ntotal += 5\nrent + total").lines.map((l) => l.result?.toString())).toEqual(first);
	});
});

describe("adversarial: edge cases", () => {
	test.each(DOCUMENT_EDGES)("the document edge %j gives both passes the same names, and stays honest", (text) => {
		expectHonestDocument(text);
		expect([...after("evaluateDocument", text).engine.documentVariableNames()]).toEqual([...after("parseDocument", text).engine.documentVariableNames()]);
	});

	test("CRLF line endings and a trailing newline define the same names", () => {
		for (const text of ["rent = 1200\r\nrate = 5\r\n", "rent = 1200\nrate = 5\n"]) {
			for (const pass of ["parseDocument", "evaluateDocument"] as const) {
				expect({ pass, text, names: [...after(pass, text).engine.documentVariableNames()] }).toEqual({ pass, text, names: ["rent", "rate"] });
			}
		}
	});

	test.each(TEXT_EDGES)("typing the text edge %j after a defined name offers no wrong name and does not throw", (typed) => {
		const { ls } = after("parseDocument", "rent = 1200");
		expect(() => ls.getCompletions(typed, typed.length)).not.toThrow();
		expect(variables(ls, typed).every((label) => label === "rent")).toBe(true);
	});

	test.each([["zero", "0"], ["negative zero", "-0"], ["a negative", "-5"], ["2^53", "9007199254740993"], ["the largest double", "1.7976931348623157e308"], ["a quotient with no answer", "1/0"]])("a name holding %s is still a name", (_label, value) => {
		for (const pass of ["parseDocument", "evaluateDocument"] as const) {
			const { ls } = after(pass, `edge = ${value}`);
			expect({ pass, names: variables(ls, "ed") }).toEqual({ pass, names: ["edge"] });
		}
	});

	test("whitespace-only and comment-only documents define nothing", () => {
		for (const text of ["   \n\t\n", "// rent = 1200"]) {
			expect([...after("parseDocument", text).engine.documentVariableNames()]).toEqual([]);
		}
	});
});
