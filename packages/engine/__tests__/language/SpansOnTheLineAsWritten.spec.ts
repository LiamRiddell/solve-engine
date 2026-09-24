/**
 * Every semantic token span is measured on the line as written (#567).
 *
 * A host colours the characters a span names, so a span measured on anything
 * but the line it was handed colours the wrong ones. A quoted line had its
 * `> ` set aside before it was tokenized, and its spans were measured from
 * there, two columns short. A list item was tokenized marker and all, so its
 * bullet was painted as a minus sign, and a `*`, `1.` or task-box marker, which
 * does not parse as an operator, stopped the line being painted at all, though
 * the evaluator reads each of them as the list item it is:
 *
 * | line                 | painted, before                                   | now                     |
 * | ---                  | ---                                               | ---                     |
 * | `> 1 + 2`            | `>` number, `1` operator, `+` number              | `1` number, `+` operator, `2` number |
 * | `- 100 + 20` (= 120) | `-` operator, `100` number, `+` operator, `20` number | `100` number, `+` operator, `20` number |
 * | `* 1 + 2` (= 3)      | nothing                                           | `1` number, `+` operator, `2` number |
 * | `- [ ] total += 5`   | nothing                                           | `total` variable, `+=` operator, `5` number |
 *
 * Now the lexer starts past the marker the way `scanDocument` already did for a
 * list item, and offsets stay those of the whole line. The property pinned
 * below is the one a host relies on: a line behind any marker is painted
 * exactly as its content is on a line of its own, moved along by the marker.
 */
import { afterEach, describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { LanguageService, type SemanticToken } from "@solve-js/language/LanguageService";

const engines: ExpressionEngine[] = [];
afterEach(() => {
	for (const engine of engines.splice(0)) engine.clear();
});

/** A service over an engine whose document defines `total` and `x`, in either highlighting mode. */
function service(normalizeForHighlighting: boolean, knownNames: string[] = ["total", "x"]): LanguageService {
	const engine = createEngine() as unknown as ExpressionEngine;
	engines.push(engine);
	engine.parseDocument("total += 5\n:x = 3");
	return new LanguageService(engine, { normalizeForHighlighting, variableNameSource: () => knownNames });
}

/** Each span as the characters it names on the line, with its category. */
function painted(tokens: SemanticToken[], line: string): string[] {
	return tokens.map(t => `${t.from}-${t.to} ${JSON.stringify(line.slice(t.from, t.to))} ${t.category}`);
}

/** Every marker the highlighter looks past. */
const MARKERS = ["> ", "- ", "* ", "+ ", "1. ", "12. ", "- [ ] ", "- [x] ", "  - ", "\t- ", "> - ", "> 1. "];

/** Expressions to put behind them, none of which is itself a marker. */
const CONTENTS = ["1 + 2", "12 kg in lb", "sqrt(16) + 2", "20% off 80", "total += 5", "b += 5", "\"gbp\"", "5(3)", "x * 2", "total", "3 +"];

describe.each([
	["lexer categories", false],
	["normalized highlighting", true],
])("with %s", (_mode, normalizeForHighlighting) => {
	test("the issue's line is painted on its own characters", () => {
		const line = "> 1 + 2";
		expect(painted(service(normalizeForHighlighting).getSemanticTokens(line, 1), line)).toEqual([
			`2-3 "1" number`,
			`4-5 "+" operator`,
			`6-7 "2" number`,
		]);
	});

	test.each(MARKERS)("a line behind %j is painted as its content is, moved along by the marker", marker => {
		const highlighter = service(normalizeForHighlighting);
		for (const content of CONTENTS) {
			const line = marker + content;
			const alone = highlighter.getSemanticTokens(content, 1).map(t => ({ ...t, from: t.from + marker.length, to: t.to + marker.length }));
			expect({ line, spans: painted(highlighter.getSemanticTokens(line, 2), line) }).toEqual({ line, spans: painted(alone, line) });
		}
	});
});

describe("a list marker is markup, not arithmetic", () => {
	test("a bullet is not painted as a minus sign, and the line evaluates without it", () => {
		const line = "- 100 + 20";
		expect(painted(service(false).getSemanticTokens(line, 1), line)).toEqual([
			`2-5 "100" number`,
			`6-7 "+" operator`,
			`8-10 "20" number`,
		]);
		const engine = createEngine() as unknown as ExpressionEngine;
		engines.push(engine);
		expect(engine.parseDocument(line).lines[0].result?.toNumber()).toBe(120);
	});

	test("a minus with no space after it is still a minus", () => {
		const line = "-100 + 20";
		expect(painted(service(false).getSemanticTokens(line, 1), line)[0]).toBe(`0-1 "-" operator`);
	});

	test.each(["* 1 + 2", "+ 1 + 2", "1. 1 + 2", "- [ ] 1 + 2", "- [x] 1 + 2"])("%s is painted, as the evaluator reads it", line => {
		const engine = createEngine() as unknown as ExpressionEngine;
		engines.push(engine);
		expect(engine.parseDocument(line).lines[0].result?.toNumber()).toBe(3);
		const spans = painted(service(false).getSemanticTokens(line, 1), line);
		expect(spans.map(span => span.split(" ").slice(1).join(" "))).toEqual([`"1" number`, `"+" operator`, `"2" number`]);
	});

	test("a lone name behind a marker is gated on being known, as it is on its own", () => {
		expect(service(false, []).getSemanticTokens("- total", 1)).toEqual([]);
		expect(painted(service(false, ["total"]).getSemanticTokens("- total", 1), "- total")).toEqual([`2-7 "total" variable`]);
		expect(painted(service(false, ["total"]).getSemanticTokens("> total", 1), "> total")).toEqual([`2-7 "total" variable`]);
	});

	test("an inline solve in a list item keeps its spans", () => {
		const line = "- spent `s`2 + 3`` today";
		expect(painted(service(false).getSemanticTokens(line, 1), line)).toEqual([
			`11-12 "2" number`,
			`13-14 "+" operator`,
			`15-16 "3" number`,
		]);
	});
});

describe("structure is still not painted", () => {
	test.each(["# 1 + 2", "> ", "- ", "1. ", "- [ ] ", "* * *", "---", "| --- | --- |", ">1 + 2", "> > 1 + 2"])("%j", line => {
		expect(service(false).getSemanticTokens(line, 1)).toEqual([]);
		expect(service(true).getSemanticTokens(line, 1)).toEqual([]);
	});
});

describe("the lexer's own highlight tokens", () => {
	test("are measured on the line as written, columns included", () => {
		const engine = createEngine() as unknown as ExpressionEngine;
		engines.push(engine);
		const lexer = engine.getLexer();
		const describe = (line: string) => lexer.getHighlightTokens(line).map(t => `${t.type} offset ${t.offset} col ${t.col}`);
		expect(describe("> 1 + 2")).toEqual(["NUMBER offset 2 col 3", "PLUS offset 4 col 5", "NUMBER offset 6 col 7"]);
		expect(describe("- 1 + 2")).toEqual(["NUMBER offset 2 col 3", "PLUS offset 4 col 5", "NUMBER offset 6 col 7"]);
		expect(lexer.getHighlightTokenObjects("> 1 + 2").map(t => t.offset)).toEqual([2, 4, 6]);
		expect(lexer.highlightContentStart("> - [ ] 1 + 2")).toBe(8);
		expect(lexer.highlightContentStart("# heading")).toBe(-1);
	});
});
