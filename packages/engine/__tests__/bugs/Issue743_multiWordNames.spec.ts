import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { LanguageService } from "@solve-js/language/LanguageService";
import { applyTextEdits } from "@solve-js/language/DocumentReferences";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import {
	MAX_NAME_WORDS,
	MultiWordNameTable,
	definedNameWords,
	isNameWord,
	multiWordDefinitionRule,
	multiWordNameRefusal,
	multiWordNameRule,
	nameKey,
	nameWordRun,
} from "@solve-js/packages/variables/MultiWordNames";

/**
 * Issue #743: a variable name was one word, so `hourly rate = $50` failed on
 * `rate` while `hourly_rate = $50` worked. Now a run of plain words before a
 * definition's `=` is one name, registered for the document, and the same words
 * on a later line read as that name, longest first. A would-be name holding an
 * operator word or a phrase is refused by name: `take home = 5` used to be
 * stored quietly as the equation `-home = 5`.
 */

function show(line: string, engine = newTrackedEngine()): string {
	try {
		return formatValue(engine.evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const shown = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${shown}` : shown;
	});
}

const batch = (text: string) => read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
const incremental = (text: string) => read(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }));

/** Both document passes, asserted to agree, and the answers. */
function both(text: string): string[] {
	const answers = batch(text);
	expect(incremental(text)).toEqual(answers);
	return answers;
}

/** The raw tokens the lexer gives a line, before the normaliser. */
function lexed(line: string): Token[] {
	const lexer = newTrackedEngine().getLexer();
	lexer.resetExpression(line);
	return Array.from(lexer);
}

/**
 * A live evaluator: evaluate, apply edits (a line and its new text, or a line
 * number alone to delete it), and evaluate again. The answers are compared with
 * a fresh batch pass of the edited text, which a live editor must agree with.
 */
function liveEdit(text: string, edits: ReadonlyArray<readonly [number, string] | number>): string[] {
	const doc = new DocumentModel();
	doc.setDocument(text);
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	const lines = text.split("\n");
	try {
		evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		for (const edit of edits) {
			if (typeof edit === "number") {
				evaluator.applyTransaction([{ startLine: edit, deleteCount: 1, insertLines: [] }]);
				lines.splice(edit - 1, 1);
			} else {
				doc.editLine(edit[0], edit[1]);
				lines[edit[0] - 1] = edit[1];
			}
		}
		const pass = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		const shown = pass.lines.map((l) => (l.error ? `ERROR ${l.error}` : l.result ? formatValue(l.result).replace(/^=\s*/, "") : ""));
		expect(shown).toEqual(batch(lines.join("\n")));
		return shown;
	} finally {
		evaluator.terminateWorker();
	}
}

describe("a name of several words", () => {
	test("on the line that defines it, on every path", () => {
		expect(show("hourly rate = $50")).toBe("$50.00");
		expect(show("monthly rent = $1,200")).toBe("$1,200.00");
		expect(show("hourly_rate = $50")).toBe("$50.00");
	});

	test("read on the lines below", () => {
		expect(both("hourly rate = $50\nhours = 8\nhourly rate * hours")).toEqual(["$50.00", "8", "$400.00"]);
		expect(both("hourly rate = $50\nhours = 8\ndaily pay = hourly rate * hours\ndaily pay * 5")).toEqual(["$50.00", "8", "$400.00", "$2,000.00"]);
	});

	test("longest registered name first, beside a name it begins or ends with", () => {
		expect(both("rate = 5\nhourly rate = 50\nhourly rate * rate")).toEqual(["5", "50", "250"]);
		expect(both("hourly rate = 50\nhourly rate cap = 70\nhourly rate cap - hourly rate")).toEqual(["50", "70", "20"]);
	});

	test("a later definition of the same name wins, as for one word", () => {
		expect(both("hourly rate = $50\nhourly rate = $60\nhourly rate * 2")).toEqual(["$50.00", "$60.00", "$120.00"]);
	});

	test("above its definition it is not a name yet, in both passes", () => {
		const answers = both("hourly rate * 2\nhourly rate = $50\nhourly rate * 2");
		expect(answers[0]).toMatch(/^ERROR /);
		expect(answers.slice(1)).toEqual(["$50.00", "$100.00"]);
	});

	test("names are matched as written: case counts, extra spaces do not", () => {
		const answers = both("hourly rate = $50\nHourly rate * 2\nhourly  rate * 2");
		expect(answers[1]).toMatch(/^ERROR /);
		expect(answers[2]).toBe("$100.00");
	});

	test("the colon forms keep their one-word name", () => {
		expect(show(":hourly rate = 5")).toMatch(/^THROWS /);
		expect(both(":rate = 5\nrate * 2")).toEqual(["5", "10"]);
	});

	test("a single-expression engine keeps its names, as it keeps its variables", () => {
		const engine = newTrackedEngine();
		expect(show("hourly rate = $50", engine)).toBe("$50.00");
		expect(show("hourly rate * 8", engine)).toBe("$400.00");
		expect(show("hourly rate * 8")).toBe('THROWS Expected an operator or the end of the line, but found "rate"');
	});
});

describe("prose and the engine's own words", () => {
	test("a sentence holding a defined name is still prose", () => {
		expect(both("hourly rate = $50\nThe hourly rate went up")[1]).toMatch(/^ERROR /);
	});

	test("a run of words no line defines stays the error it was", () => {
		expect(show("hourly rate * 8")).toMatch(/^THROWS /);
		expect(show("I think the answer is = 5")).toMatch(/^THROWS /);
	});

	test.each([
		["take home = 5", '"take home" cannot be a name: "take" is a spelling of minus. Choose other words, or join them as take_home. For the equation, write -home = 5.'],
		["plus rate = 5", '"plus rate" cannot be a name: "plus" is a spelling of plus. Choose other words, or join them as plus_rate. For the equation, write +rate = 5.'],
		["with rate = 5", '"with rate" cannot be a name: "with" is a spelling of plus. Choose other words, or join them as with_rate. For the equation, write +rate = 5.'],
		["minus x = 5", '"minus x" cannot be a name: "minus" is a spelling of minus. Choose other words, or join them as minus_x. For the equation, write -x = 5.'],
		["tax on = 5", '"tax on" cannot be a name: "tax on" is a phrase the engine reads. Choose other words, or join them as tax_on.'],
		["hourly for = 5", '"hourly for" cannot be a name: "hourly for" is a phrase the engine reads. Choose other words, or join them as hourly_for.'],
		["value of = 5", '"value of" cannot be a name: "value of" is a phrase the engine reads. Choose other words, or join them as value_of.'],
		["interest on = 5", '"interest on" cannot be a name: "interest on" is a phrase the engine reads. Choose other words, or join them as interest_on.'],
		["sum of rent = 5", '"sum of rent" cannot be a name: "sum of" is a phrase the engine reads. Choose other words, or join them as sum_of_rent.'],
	])("%s is refused by name", (line, message) => {
		expect(show(line)).toBe(`THROWS ${message}`);
	});

	test("the equation spellings are still equations", () => {
		expect(both("-home = 5\nhome =>")).toEqual(["home stored as an equation: solve with \"home =>\"", "-5"]);
		expect(both("2 * x = 10\nx =>")[1]).toBe("5");
	});

	test("a name never takes a phrase's words", () => {
		expect(both("hourly rate = $50\nhourly for £50,000")).toEqual(["$50.00", "£26.04"]);
		expect(both("interest rate = 5%\n$1000 * interest rate")).toEqual(["5.00%", "$50.00"]);
	});

	test("a name beside a unit of several words", () => {
		expect(show("square metres = 5")).toMatch(/^THROWS /);
		expect(both("1 story point = 2 hours\nstory point = 3\n3 story points\nstory point * 2")).toEqual(["story point defined", "3", "6 hours", "6"]);
	});

	test("more than four words is not a name", () => {
		expect(MAX_NAME_WORDS).toBe(4);
		expect(both("the quick brown fox = 5\nthe quick brown fox * 2")).toEqual(["5", "10"]);
		expect(show("the quick brown fox jumps = 5")).toMatch(/^THROWS /);
	});
});

describe("the name meeting the other features", () => {
	test("a check, a tag, a label, a what-if and a goal seek", () => {
		expect(both("hourly rate = $50\ncheck hourly rate == $50\nhourly rate #pay\ntotal of #pay\nPay: hourly rate\nOur hourly rate $60")).toEqual([
			"$50.00", "✓", "$50.00", "$50.00", "$50.00", "$60.00",
		]);
		expect(both("hourly rate = 50\nhours = 8\npay = hourly rate * hours\nline 3 with hourly rate = 60")[3]).toBe("480");
		expect(incremental("hourly rate = $50\nhours = 8\nhourly rate * hours\nsolve line 3 for hours = $800")[3]).toBe("16");
	});

	test("a trace names it", () => {
		expect(both("hourly rate = $50\nhours = 8\nhourly rate * hours\ninputs of line 3")[3]).toBe("$400.00 (line 3) <- hourly rate $50.00 (line 1), hours 8 (line 2)");
	});

	test("references, hover and rename find every use", () => {
		const service = new LanguageService(newTrackedEngine());
		const text = "hourly rate = $50\nhours = 8\nhourly rate * hours";
		expect(service.findReferences(text, { line: 3, character: 2 }).map((r) => [r.line, r.from, r.to, r.kind])).toEqual([
			[1, 0, 11, "definition"],
			[3, 0, 11, "read"],
		]);
		const renamed = service.rename(text, { line: 1, character: 1 }, "wage");
		expect(renamed.ok).toBe(true);
		if (renamed.ok) expect(applyTextEdits(text, renamed.edits)).toBe("wage = $50\nhours = 8\nwage * hours");
		expect(service.rename(text, { line: 1, character: 1 }, "day rate").ok).toBe(false);
	});

	test("a snapshot round trip keeps the name", () => {
		const source = newTrackedEngine();
		source.parseDocument("hourly rate = $50\nhours = 8\nhourly rate * hours");
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(source.toJSON())), { packages: BUILTIN_PACKAGES });
		try {
			expect(show("hourly rate * 2", restored)).toBe("$100.00");
		} finally {
			restored.clear();
		}
	});

	test("an edit to the definition re-keys every reader, in a live editor as in a fresh pass", () => {
		const text = "hourly rate = $50\nhours = 8\nhourly rate * hours\nx = 1";
		expect(liveEdit(text, [[1, "hourly rate = $60"]])[2]).toBe("$480.00");
		expect(liveEdit(text, [[1, "hourly wage = $60"]])[2]).toMatch(/^ERROR /);
		expect(liveEdit(text, [[1, "hourly wage = $60"], [3, "hourly wage * hours"]])[2]).toBe("$480.00");
		expect(liveEdit(text, [[1, "x2 = 60"]])[2]).toMatch(/^ERROR /);
		expect(liveEdit(text, [1])[1]).toMatch(/^ERROR /);
	});

	test("a definition line settles: later passes re-run no more than a one-word name does", () => {
		const count = (text: string) => {
			const doc = new DocumentModel();
			doc.setDocument(text);
			const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
			try {
				evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
				return evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).tierCounts.tier1;
			} finally {
				evaluator.terminateWorker();
			}
		};
		expect(count("hourly rate = $50\nhours = 8\nhourly rate * hours\nx = 1\nx + 1")).toBe(count("hourly_rate = $50\nhours = 8\nhourly_rate * hours\nx = 1\nx + 1"));
	});
});

describe("MultiWordNameTable", () => {
	test("ordinary: define, match longest first, and report a new name", () => {
		const table = new MultiWordNameTable();
		expect(table.isEmpty).toBe(true);
		expect(table.define(["hourly", "rate"], 1)).toBe(true);
		expect(table.define(["hourly", "rate"], 2)).toBe(false);
		expect(table.define(["hourly", "rate", "cap"], 3)).toBe(true);
		expect(table.match(["hourly", "rate", "cap", "x"])).toBe(3);
		expect(table.match(["hourly", "rate", "x"])).toBe(2);
		expect(table.match(["hourly"])).toBe(0);
		expect(table.maxWordCount).toBe(3);
		expect(table.names.sort()).toEqual(["hourly rate", "hourly rate cap"]);
	});

	test("boundary: one word is never a name, and a name is its lines' until the last lets go", () => {
		const table = new MultiWordNameTable();
		expect(table.define(["rate"], 1)).toBe(false);
		expect(table.isEmpty).toBe(true);
		table.define(["day", "rate"], 1);
		table.define(["day", "rate"], 2);
		expect(table.undefineFrom(1)).toBe(false);
		expect(table.match(["day", "rate"])).toBe(2);
		expect(table.undefineFrom(2)).toBe(true);
		expect(table.match(["day", "rate"])).toBe(0);
		// Taken back before the pass settles: not new, and nothing went.
		expect(table.define(["day", "rate"], 2)).toBe(false);
		expect(table.settle()).toBe(false);
		table.undefineFrom(2);
		expect(table.settle()).toBe(true);
		expect(table.define(["day", "rate"], 2)).toBe(true);
		expect(table.undefineFrom(-1)).toBe(false);
	});

	test("withNames reads with names in place and takes only its own away", () => {
		const table = new MultiWordNameTable();
		table.define(["kept", "name"], 1);
		expect(table.withNames(["kept name", "read name"], () => table.match(["read", "name"]))).toBe(2);
		expect(table.match(["read", "name"])).toBe(0);
		expect(table.match(["kept", "name"])).toBe(2);
		table.clear();
		expect(table.isEmpty).toBe(true);
	});

	test("hostile: prototype words are only ever their own entries", () => {
		expectPrototypeUntouched(() => {
			const table = new MultiWordNameTable();
			expect(table.match(["constructor", "x"])).toBe(0);
			expect(table.define(["__proto__", "x"], 1)).toBe(true);
			expect(table.match(["__proto__", "x"])).toBe(2);
			expect(table.match(["toString", "x"])).toBe(0);
		});
	});
});

describe("the rules and helpers", () => {
	test("isNameWord and nameWordRun: plain words only", () => {
		expect(isNameWord(lexed("rate")[0])).toBe(true);
		expect(isNameWord(lexed("hourly_rate")[0])).toBe(false);
		expect(isNameWord(lexed("km")[0])).toBe(false);
		expect(isNameWord(lexed("take")[0])).toBe(false);
		expect(isNameWord(undefined)).toBe(false);
		expect(nameWordRun(lexed("hourly rate = 5"), 0, 10)).toBe(2);
		expect(nameWordRun(lexed("one two three four five six"), 0, 3)).toBe(3);
		expect(nameWordRun([], 0, 3)).toBe(0);
	});

	test("definedNameWords: two to four words, then =", () => {
		expect(definedNameWords(lexed("hourly rate = $50"))).toEqual(["hourly", "rate"]);
		expect(definedNameWords(lexed("rate = 5"))).toBeNull();
		expect(definedNameWords(lexed("hourly rate == 5"))).toBeNull();
		expect(definedNameWords(lexed("hourly rate * 5"))).toBeNull();
		expect(definedNameWords(lexed("one two three four five = 5"))).toBeNull();
		expect(definedNameWords([])).toBeNull();
		expect(nameKey(["a", "b"])).toBe("a b");
	});

	test("multiWordDefinitionRule fuses only at the start of a definition", () => {
		const rule = multiWordDefinitionRule();
		const match = rule.match(lexed("hourly rate = $50"), 0);
		expect(match?.consumed).toBe(2);
		expect(match?.replacement[0].type).toBe("IDENT");
		expect(match?.replacement[0].value).toBe("hourly rate");
		expect(rule.match(lexed("x hourly rate = 5"), 1)).toBeNull();
		expect(rule.match(lexed("hourly rate"), 0)).toBeNull();
	});

	test("multiWordNameRule fuses a registered name, and nothing when none is", () => {
		const table = new MultiWordNameTable();
		const rule = multiWordNameRule(table);
		expect(rule.match(lexed("hourly rate * 8"), 0)).toBeNull();
		table.define(["hourly", "rate"]);
		expect(rule.match(lexed("hourly rate * 8"), 0)?.replacement[0].value).toBe("hourly rate");
		expect(rule.match(lexed("2 * hourly rate"), 2)?.consumed).toBe(2);
		expect(rule.match(lexed(":hourly rate"), 1)).toBeNull();
		expect(rule.match(lexed("hourly rate(2)"), 0)).toBeNull();
		expect(rule.match(lexed("hourly wage"), 0)).toBeNull();
	});

	test("multiWordNameRefusal: operator words first, and phrases", () => {
		const engine = newTrackedEngine();
		const tokens = (line: string) => engine.tokenizeForClassification(line);
		const eq = (list: Token[]) => list.findIndex((t) => t.type === "EQUALS");
		const take = tokens("take home = 5");
		expect(multiWordNameRefusal(take, eq(take))?.code).toBe("NAME_HAS_RESERVED_WORD");
		const phrase = tokens("tax on = 5");
		expect(multiWordNameRefusal(phrase, eq(phrase))?.code).toBe("NAME_HAS_RESERVED_WORD");
		const plain = tokens("x = 5");
		expect(multiWordNameRefusal(plain, eq(plain))).toBeNull();
		const between = tokens("x plus y = 10");
		expect(multiWordNameRefusal(between, eq(between))).toBeNull();
		const long = tokens("take a b c d e = 5");
		expect(multiWordNameRefusal(long, eq(long))).toBeNull();
		expect(multiWordNameRefusal(take, 0)).toBeNull();
	});
});

describe("adversarial", () => {
	test.each(fill("hourly rate = X\nhours = 8\nhourly rate * hours", NUMERIC_EDGES))("a numeric edge as the value: %j", (text) => {
		expectHonestDocument(text, { allowNaN: text.includes("0/0") });
	});

	test.each(PROTOTYPE_WORDS)("a prototype word in a name: %s", (word) => {
		expectPrototypeUntouched(() => {
			expectHonestDocument(`${word} value = 5\n${word} value * 2`);
			expectHonestDocument(`my ${word} = 5\nmy ${word} * 2`);
			expectHonestLine(`${word} ${word} = 5`);
		});
	});

	test("toString value reads as its own name", () => {
		expect(both("toString value = 5\ntoString value * 2")).toEqual(["5", "10"]);
	});

	test("look-alike characters do not join a name", () => {
		const answers = both("hourly rate = $50\nhourly​ rate * 2\nhourly rate * 2");
		for (const line of answers.slice(1)) expect(line === "$100.00" || line.startsWith("ERROR")).toBe(true);
		expectHonestLine("hоurly rate = 5");
	});

	test("markup-shaped words are read as text", () => {
		expectHonestDocument("<b> rate = 5\n<b> rate * 2");
		expectHonestDocument("script alert = 5\nscript alert * 2");
	});

	test("a very long run of words, and hundreds of names", () => {
		const words = Array.from({ length: 5_000 }, (_, i) => `w${"abcdefghij"[i % 10]}`).join(" ");
		expectHonestLine(`${words} = 5`, { budgetMs: 5_000 });
		const names = Array.from({ length: 300 }, (_, i) => `cost ${"abcdefghijklmnopqrstuvwxyz"[i % 26]}${"abcdefghijklmnopqrstuvwxyz"[Math.floor(i / 26)]} = ${i}`);
		const { batch: answers } = expectHonestDocument([...names, "cost ba + cost ab"].join("\n"), { budgetMs: 15_000 });
		expect(answers[300]).toBe("= 27");
	});

	test("CRLF, a trailing newline and whitespace around the name", () => {
		expect(both("hourly rate = $50\r\nhourly rate * 2")).toEqual(["$50.00", "$100.00"]);
		expect(both("  hourly rate = $50  \nhourly rate * 2\n")).toEqual(["$50.00", "$100.00", ""]);
	});
});
