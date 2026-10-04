import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, DOCUMENT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, numberValue, stringValue, uomValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { LEAD_IN_WORDS, isAmount, isLabelWord, wordLabelEnd } from "@solve-js/engine/WordLabel";
import { columnTotalNormalizerRule, isColumnTotal } from "@solve-js/packages/lines/normalizer/ColumnTotalNormalizerRule";
import { columnTotalHandler } from "@solve-js/packages/lines/LinesPluginFunctions";
import { isSummaryLine } from "@solve-js/packages/lines/SectionReader";

/**
 * Issue #742: the Soulver habit of a label and an amount on each line with a
 * total underneath answered nothing. `Rent $1200` was a parse error where
 * `Rent: $1200` gave $1,200.00, and a line that was only `sum` or `total` was
 * an undefined variable. Now a run of words followed by an amount of money or a
 * quantity reads as that label and amount, and a lone `sum` or `total` is
 * `total above`, unless the note defines a variable of that name.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
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

/** The normalised tokens of a line, as the fallback sees them. */
function normalised(line: string): Token[] {
	return newTrackedEngine().tokenizeForClassification(line);
}

/** The raw tokens the lexer gives a line, before the normaliser. */
function lexed(line: string): Token[] {
	const lexer = newTrackedEngine().getLexer();
	lexer.resetExpression(line);
	return Array.from(lexer);
}

/** A live evaluator: evaluate, apply edits, and evaluate again. */
function afterEdits(text: string, edits: ReadonlyArray<readonly [number, string]>): string[] {
	const doc = new DocumentModel();
	doc.setDocument(text);
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	try {
		evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		for (const [n, t] of edits) doc.editLine(n, t);
		const pass = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		return pass.lines.map((l) => (l.error ? `ERROR ${l.error}` : l.result ? formatValue(l.result).replace(/^=\s*/, "") : ""));
	} finally {
		evaluator.terminateWorker();
	}
}

describe("a label without its colon", () => {
	test.each([
		["Rent $1200", "$1,200.00"],
		["Rent $1,200.50", "$1,200.50"],
		["Food £45.50", "£45.50"],
		["Salary £50,000", "£50,000.00"],
		["Bonus $1.2k", "$1,200.00"],
		["Fees 45 EUR", "€45.00"],
		["Rent 1200 dollars", "$1,200.00"],
		["Petrol 40 l", "40.00 l"],
		["Car 2 km", "2.00 km"],
		["Area 20 square metres", "20.00 square metres"],
		["Width 3 ft 4 in", "40.00 in"],
		["Flight to Paris $450", "$450.00"],
		["take home $500", "$500.00"],
		["Mum's gift $20", "$20.00"],
		["I walked 5 km", "5.00 km"],
		["Rent $5 // note", "$5.00"],
		["Rent $0", "$0.00"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("reads as the colon form does", () => {
		for (const [colonFree, colon] of [
			["Rent $1200", "Rent: $1200"],
			["Flight to Paris $450", "Flight to Paris: $450"],
			["Petrol 40 l", "Petrol: 40 l"],
		]) {
			expect(show(colonFree)).toBe(show(colon));
		}
	});

	test("a budget note typed the Soulver way", () => {
		expect(both("Rent $1200\nFood $300\ntotal above")).toEqual(["$1,200.00", "$300.00", "$1,500.00"]);
		expect(both("Rent $1200\nFood $300\nsum")).toEqual(["$1,200.00", "$300.00", "$1,500.00"]);
	});

	test("a markdown list marker, a tag and a comment around the label", () => {
		expect(both("- Rent $1200\n- Food $300\nsum")).toEqual(["$1,200.00", "$300.00", "$1,500.00"]);
		expect(both("Rent $1200 #home\nFood $300 #food\ntotal\ntotal of #home")).toEqual(["$1,200.00", "$300.00", "$1,500.00", "$1,200.00"]);
	});

	test("a label that is also a defined variable is still a label", () => {
		expect(both("rent = 5\nrent $1200\nrent")).toEqual(["5", "$1,200.00", "5"]);
	});
});

describe("prose stays prose", () => {
	test.each([
		"I walked 5 km to the shop",
		"Meeting at 3 in room 4",
		"Chapter 12",
		"Groceries 45",
		"Room 4",
		"Page 3 of the report",
		"Back in 5 min",
		"Call me at 3 pm",
		"Hotel in Paris 3 nights",
		"The 2 cats $5",
		"Coffee 3 x $4",
		"Price 5%",
		"Rent USD 1200",
		"Total above budget $50",
		"We paid $5 for it",
		"Take the 5 km route",
		"Split it with $5",
		"Remember the $5",
		"It is 5 km",
		"A little over $5",
		"Item e $1",
		"version 2",
	])("%s is not an answer", (line) => {
		expect(show(line)).toMatch(/^THROWS /);
	});

	test("a line that already answers or already fails at run time is unchanged", () => {
		// `Rent -$5` parses as a subtraction, so it is never a label candidate.
		expect(show("Rent -$5")).toBe("THROWS Undefined variable: Rent");
		expect(show("Rent: -$5")).toBe("-$5.00");
		expect(show("5 km")).toBe("5.00 km");
		expect(show("$5 + $3")).toBe("$8.00");
	});

	test("a prose note has no answers in either pass", () => {
		const note = "Notes from Tuesday\nI walked 5 km to the shop\nMeeting at 3 in room 4\nChapter 12 is long\nnot now";
		for (const line of both(note)) expect(line === "" || line.startsWith("ERROR")).toBe(true);
	});
});

describe("a lone sum or total", () => {
	test("totals the block above, as total above does", () => {
		expect(both("Rent: $1200\nFood: $300\nsum")).toEqual(["$1,200.00", "$300.00", "$1,500.00"]);
		expect(both("Rent: $1200\nFood: $300\ntotal")).toEqual(["$1,200.00", "$300.00", "$1,500.00"]);
		expect(both("Rent: $1200\nFood: $300\nTotal")).toEqual(["$1,200.00", "$300.00", "$1,500.00"]);
		expect(both("Walk 2 km\nRun 5 km\ntotal")).toEqual(["2.00 km", "5.00 km", "7.00 km"]);
	});

	test("after a label", () => {
		expect(both("Rent $1200\nFood $300\nSubtotal: total")).toEqual(["$1,200.00", "$300.00", "$1,500.00"]);
	});

	test("is a subtotal the next total passes over", () => {
		expect(both("Rent $1200\nFood $300\nsum\nExtra $5\ntotal")).toEqual(["$1,200.00", "$300.00", "$1,500.00", "$5.00", "$1,505.00"]);
		expect(both("Rent $1200\nFood $300\nsum\ntotal")).toEqual(["$1,200.00", "$300.00", "$1,500.00", "$1,500.00"]);
	});

	test("stops at a blank line and a heading", () => {
		expect(both("# Budget\nRent $1200\nFood $300\nsum\n\n# Travel\nFlight $450\ntotal")).toEqual([
			"", "$1,200.00", "$300.00", "$1,500.00", "", "", "$450.00", "$450.00",
		]);
	});

	test("refuses what total above refuses", () => {
		expect(both("Walk 2 km\nLunch $5\ntotal")[2]).toBe("ERROR length and money cannot be added");
		expect(both("total")[0]).toMatch(/^ERROR No lines above to aggregate/);
	});

	test("a variable named sum or total keeps winning", () => {
		expect(both("total = 5\ntotal")).toEqual(["5", "5"]);
		expect(both("sum = 3\nRent $5\nsum")).toEqual(["3", "$5.00", "3"]);
	});

	test("the other readings of the words are unchanged", () => {
		expect(show("total of 1, 2, 3")).toBe("6");
		expect(show("sum(1, 2, 3)")).toBe("6");
		expect(both("Rent $5\nsum * 2")[1]).toBe('ERROR Undefined variable: sum. To add up the lines above, write "total above".');
		expect(both("x = 1\nx\ntotal = 7\ntotal * 2")).toEqual(["1", "1", "7", "14"]);
	});

	test("on its own it is refused by name, never a number", () => {
		const value = newTrackedEngine().evaluateLine(1, "sum");
		expect(value.type).toBe(ValueType.Error);
		expect(formatValue(value)).toMatch(/needs a document/);
	});

	test("an edit above reaches it, and so does defining or removing the variable", () => {
		expect(afterEdits("Rent $1200\nFood $300\nsum", [[2, "Food $400"]])).toEqual(["$1,200.00", "$400.00", "$1,600.00"]);
		expect(afterEdits("x = 3\nRent $5\ntotal", [[1, "total = 9"]])).toEqual(["9", "$5.00", "9"]);
		// With the variable gone the line totals the block: 3 and $5.
		expect(afterEdits("total = 9\nRent $5\ntotal", [[1, "x = 3"]])).toEqual(["3", "$5.00", "$8.00"]);
		expect(both("x = 3\nRent $5\ntotal")).toEqual(["3", "$5.00", "$8.00"]);
	});
});

describe("wordLabelEnd and its parts", () => {
	test("ordinary: a word and money, words and a quantity", () => {
		expect(wordLabelEnd(normalised("Rent $1200"))).toBe(1);
		expect(wordLabelEnd(normalised("Flight to Paris $450"))).toBe(3);
		expect(wordLabelEnd(normalised("Petrol 40 l"))).toBe(1);
	});

	test("boundary: no label, only a label, a bare number, a word the engine reads last", () => {
		expect(wordLabelEnd(normalised("$1200"))).toBe(-1);
		expect(wordLabelEnd(normalised("Rent"))).toBe(-1);
		expect(wordLabelEnd(normalised("Chapter 12"))).toBe(-1);
		expect(wordLabelEnd(normalised("Back in 5 min"))).toBe(-1);
		expect(wordLabelEnd(normalised("I walked 5 km to the shop"))).toBe(-1);
		// A word that only leads into what follows never ends a label.
		expect(wordLabelEnd(normalised("Remember the $5"))).toBe(-1);
		expect(wordLabelEnd(normalised("It is 5 km"))).toBe(-1);
		expect(LEAD_IN_WORDS.has("the")).toBe(true);
		expect(LEAD_IN_WORDS.has("rent")).toBe(false);
		expect(wordLabelEnd([])).toBe(-1);
	});

	test("hostile: symbols, digits in the label, markup and prototype words", () => {
		expect(wordLabelEnd(normalised("R2D2 $5"))).toBe(-1);
		expect(wordLabelEnd(normalised("<b> $5"))).toBe(-1);
		expect(wordLabelEnd(normalised("constructor $5"))).toBe(1);
		expect(wordLabelEnd(normalised("__proto__ $5"))).toBe(-1);
	});

	test("isLabelWord", () => {
		const [rent, dollar, number] = normalised("Rent $1200");
		expect(isLabelWord(rent)).toBe(true);
		expect(isLabelWord(dollar)).toBe(false);
		expect(isLabelWord(number)).toBe(false);
		// A fused phrase has the engine's own words in it.
		expect(normalised("total above").map(isLabelWord)).toEqual([false]);
	});

	test("isAmount", () => {
		const money = normalised("$5");
		expect(isAmount(money, 0)).toBe(true);
		expect(isAmount(normalised("-$5"), 0)).toBe(true);
		expect(isAmount(normalised("5 km"), 0)).toBe(true);
		expect(isAmount(normalised("5"), 0)).toBe(false);
		expect(isAmount(normalised("$5 + $3"), 0)).toBe(false);
		expect(isAmount(normalised("5 km to the shop"), 0)).toBe(false);
		expect(isAmount(money, 5)).toBe(false);
	});
});

describe("the column total's parts", () => {
	test("isColumnTotal: only the whole line, or the whole line after a label", () => {
		expect(isColumnTotal(lexed("total"), 0)).toBe(true);
		expect(isColumnTotal(lexed("SUM"), 0)).toBe(true);
		expect(isColumnTotal(lexed("Subtotal: total"), 2)).toBe(true);
		expect(isColumnTotal(lexed(":total"), 1)).toBe(false);
		expect(isColumnTotal(lexed("total * 2"), 0)).toBe(false);
		expect(isColumnTotal(lexed("totals"), 0)).toBe(false);
		expect(isColumnTotal(lexed("5: total"), 2)).toBe(false);
		expect(isColumnTotal([], 0)).toBe(false);
	});

	test("the rule fuses a lone word and marks it as a possible name", () => {
		const rule = columnTotalNormalizerRule();
		const lexer = newTrackedEngine().getLexer();
		lexer.resetExpression("total");
		const tokens = Array.from(lexer);
		const match = rule.match(tokens, 0);
		expect(match?.replacement[0].type).toBe("COLUMN_TOTAL");
		expect(match?.replacement[0].value).toBe("total");
		expect(match?.replacement[0].mayNameVariable).toBe(true);
		lexer.resetExpression(":total");
		expect(rule.match(Array.from(lexer), 1)).toBeNull();
		lexer.resetExpression("constructor");
		expect(rule.match(Array.from(lexer), 0)).toBeNull();
	});

	test("columnTotalHandler: the variable first, then the block, then the refusal", () => {
		const withVariable = { lineIndex: 3, getVariable: (name: string) => (name === "total" ? numberValue(9) : undefined) } as LineExecutionContext;
		expect(columnTotalHandler([stringValue("total")], withVariable).value).toBe(9);
		expect(columnTotalHandler([stringValue("sum")], withVariable).type).toBe(ValueType.Error);
		expect(columnTotalHandler([], undefined).type).toBe(ValueType.Error);
		const hostile = { lineIndex: 1, getVariable: () => uomValue(5, "USD") } as LineExecutionContext;
		expect(columnTotalHandler([stringValue("__proto__")], hostile).unit).toBe("USD");
	});

	test("isSummaryLine knows a lone total, after a label too", () => {
		expect(isSummaryLine("total")).toBe(true);
		expect(isSummaryLine("  Sum  ")).toBe(true);
		expect(isSummaryLine("Subtotal: total")).toBe(true);
		expect(isSummaryLine("total * 2")).toBe(false);
		expect(isSummaryLine("Rent $5")).toBe(false);
	});
});

describe("adversarial", () => {
	test.each(fill("Rent $X", NUMERIC_EDGES))("a label over a numeric edge: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test.each(fill("Rent X km", NUMERIC_EDGES))("a quantity label over a numeric edge: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test.each(TEXT_EDGES.map((t) => `Rent ${t} $5`))("a text edge inside a label: %j", (line) => {
		expectHonestLine(line);
	});

	test.each(PROTOTYPE_WORDS)("a prototype word as a label, and before a lone total: %s", (word) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(`${word} $5`);
			expectHonestDocument(`${word} $5\n${word} 3 km\ntotal`);
			expectHonestDocument(`${word} = 4\n${word} $5\nsum`);
		});
	});

	test("digits from other scripts and direction overrides are not an amount", () => {
		expect(show("Rent ٥ km")).toMatch(/^THROWS /);
		expect(show("Rent ５ km")).toMatch(/^THROWS /);
		expect(show("The ‮Rent $5")).toMatch(/^THROWS /);
		expectHonestLine("Rent ​$5");
	});

	test("markup-shaped text is read as text", () => {
		expect(show("Rent <b>$5</b>")).toMatch(/^THROWS /);
		expect(show("<script>alert(1)</script> $5")).toMatch(/^THROWS /);
		expectHonestLine("'; DROP TABLE notes; -- $5");
	});

	test("a very long line of words stays linear", () => {
		const words = Array.from({ length: 5_000 }, (_, i) => `word${"abcdefghij"[i % 10]}`).join(" ");
		expectHonestLine(`${words} $5`, { budgetMs: 5_000 });
		expectHonestLine(`${words} 12`, { budgetMs: 5_000 });
		expectHonestLine(`${"a: ".repeat(200)}${words} $5`, { budgetMs: 5_000 });
	});

	test("a thousand labelled lines and a total", () => {
		const names = ["rent", "food", "fuel", "coal", "cake", "book", "lamp", "desk", "bike", "milk"];
		const text = [...Array.from({ length: 1_000 }, (_, i) => `Item ${names[i % 10]} $1`), "total"].join("\n");
		const { batch: answers } = expectHonestDocument(text, { budgetMs: 15_000 });
		expect(answers[1_000]).toBe("= $1,000.00");
	});

	test.each(DOCUMENT_EDGES.map((d) => `${d}\nsum`))("a lone sum under a document edge: %j", (text) => {
		expectHonestDocument(text);
	});

	test("CRLF and a trailing newline", () => {
		expect(both("Rent $1200\r\nFood $300\r\nsum")).toEqual(["$1,200.00", "$300.00", "$1,500.00"]);
		expect(both("Rent $1200\nFood $300\nsum\n")).toEqual(["$1,200.00", "$300.00", "$1,500.00", ""]);
	});

	test("the feature meeting the others: a check, a what-if, a trace", () => {
		expect(both("Rent $1200\nFood $300\nsum\ncheck line 3 == $1500")[3]).toBe("✓");
		expect(both("Rent $1200\ninputs of line 1")[1]).toMatch(/^\$1,200\.00 \(line 1\)/);
		expect(both("a = 2\nRent $5\nb = a * 3\nline 3 with a = 5")[3]).toBe("15");
	});
});
