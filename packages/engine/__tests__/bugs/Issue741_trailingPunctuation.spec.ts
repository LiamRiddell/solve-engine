import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, NUMERIC_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_CONFIG } from "@solve-js/constants/Configuration";
import { isDroppableSentenceEnd } from "@solve-js/parser/TrailingPunctuation";
import { LanguageService } from "@solve-js/language/LanguageService";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createKnowledgePackage } from "@solve-js/packages/knowledge";
import { ValueType, stringValue } from "@solve-js/vm/Value";
import type { Token } from "@solve-js/lexer/Token";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * Issue #741: a line that ends a sentence the way people and language models
 * write one, with `?` or `.`, failed on its last character:
 * `what is 5 km in miles?` threw where `what is 5 km in miles` answers. The
 * opt-in `validation.allowTrailingPunctuation` reads one such character after
 * a complete expression as the end of the sentence. It is off by default, so
 * strict parsing is unchanged.
 */

const ON = { config: { validation: { allowTrailingPunctuation: true } } };

function engineOn(): ExpressionEngine {
	return newTrackedEngine(ON);
}

function show(line: string, engine: ExpressionEngine = engineOn()): string {
	try {
		return formatValue(engine.evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function showOff(line: string): string {
	return show(line, newTrackedEngine());
}

/** A token with only what {@link isDroppableSentenceEnd} reads. */
function token(type: string, value: string): Token {
	return { type, typeId: 0, value, text: value, offset: 0, lineBreaks: 0, line: 1, col: 1 } as Token;
}

describe("each shape from the issue, with the option on and off", () => {
	test.each([
		["what is 5 km in miles?", "what is 5 km in miles", "3.11 miles"],
		["what is 5+5?", "what is 5+5", "10"],
		["5 + 5?", "5 + 5", "10"],
		["5 + 5.", "5 + 5", "10"],
		["5 + 5 ?", "5 + 5", "10"],
		["20% of 50?", "20% of 50", "10"],
		["$5 * 3.", "$5 * 3", "$15.00"],
		["x = 5.", "x = 5", "5"],
		["total: 5 + 5?", "total: 5 + 5", "10"],
	])("%s", (withMark, without, answer) => {
		expect(show(withMark)).toBe(answer);
		expect(show(without)).toBe(answer);
		// Off, the line is refused as before: at the mark, or for a labelled
		// line at the label, which the retry without the mark reaches.
		expect(showOff(withMark)).toMatch(/^THROWS Expected an operator or the end of the line, but found "[?.:]"$/);
	});

	test("the option is off by default", () => {
		expect(DEFAULT_CONFIG.validation.allowTrailingPunctuation).toBe(false);
	});

	test("a . straight after digits is read as a full stop, which is why it is opt-in", () => {
		expect(show("1.5.")).toBe("1.50");
		expect(showOff("1.5.")).toMatch(/^THROWS/);
	});
});

describe("what it must not break", () => {
	test("in ? still lists the units a quantity converts to, on and off", () => {
		expect(show("5 cm in ?")).toBe(showOff("5 cm in ?"));
		expect(show("5 cm in ?")).toMatch(/^m, Pm, Tm/);
	});

	test("to ? is unchanged by the option", () => {
		expect(show("5 cm to ?")).toBe(showOff("5 cm to ?"));
	});

	test("= ? is still the knowledge package's question", () => {
		const engine = newTrackedEngine({ ...ON, packages: [...BUILTIN_PACKAGES, createKnowledgePackage()] });
		engine.queryClient.setQueryData(["knowledge", "distance to the moon"], stringValue("about 384,400 km"));
		const value = engine.evaluateExpression("distance to the moon = ?");
		expect(value.type).toBe(ValueType.String);
		expect(value.value).toBe("about 384,400 km");
		engine.clear();
	});

	test("a trailing = still shows the result, and =? is not a sentence ending", () => {
		expect(show("355/113=")).toBe("3.14");
		expect(show("355/113=?")).toMatch(/^THROWS/);
	});

	test("a line that fails for another reason keeps its own error", () => {
		expect(show("5 kg + 2 m?")).toBe(showOff("5 kg + 2 m"));
		expect(show("5 +?")).toBe('THROWS Expected a value after "+", but found "?"');
		expect(show("nosuchname * 2?")).toBe(showOff("nosuchname * 2"));
	});

	test("a ? inside a line, a doubled mark and a mark alone are left alone", () => {
		expect(show("5 ? 5")).toMatch(/^THROWS/);
		expect(show("5 + 5..")).toMatch(/^THROWS/);
		expect(show("5 + 5??")).toMatch(/^THROWS/);
		expect(show("5 + 5.?")).toMatch(/^THROWS/);
		expect(show("?")).toMatch(/^THROWS/);
		expect(show(".")).toMatch(/^THROWS/);
	});

	test("a ? inside a string is part of the string", () => {
		expect(show('"is it?"')).toBe("is it?");
		expect(show('"is it?"?')).toBe("is it?");
	});

	test("both document passes read a sentence ending the same way", () => {
		const text = "a = 3\na * 2?\nprev + 1.";
		const read = (lines: { result: unknown; error: string | null }[]) =>
			lines.map((l) => (l.error ? `ERROR ${l.error}` : formatValue(l.result as never)));
		const batch = read(engineOn().parseDocument(text, { inputType: "markdown" }).lines);
		expect(batch).toEqual(["= 3", "= 6", "= 7"]);
		expect(read(evaluateDocument(engineOn(), text, { inputType: "markdown" }).lines)).toEqual(batch);
	});

	test("the highlighting of a line whose last character was dropped covers the line and no further", () => {
		const service = new LanguageService(engineOn());
		const line = "what is 5 km in miles?";
		const spans = service.getSemanticTokens(line, 1);
		expect(spans.length).toBeGreaterThan(0);
		for (const span of spans) {
			expect(span.from).toBeGreaterThanOrEqual(0);
			expect(span.to).toBeLessThanOrEqual(line.length);
			expect(span.from).toBeLessThan(span.to);
		}
		// The spans before the mark are the ones the line without it has.
		const without = new LanguageService(engineOn()).getSemanticTokens("what is 5 km in miles", 1);
		expect(spans.filter((s) => s.to <= line.length - 1)).toEqual(without);
	});
});

describe("isDroppableSentenceEnd, the check itself", () => {
	const number = token("NUMBER", "5");

	test("a lone ? or . at the end, after a value", () => {
		expect(isDroppableSentenceEnd(token("QUESTION", "?"), number, undefined)).toBe(true);
		expect(isDroppableSentenceEnd(token("DOT", "."), number, undefined)).toBe(true);
		expect(isDroppableSentenceEnd(token("DOT", "."), token("RPAREN", ")"), undefined)).toBe(true);
		expect(isDroppableSentenceEnd(token("QUESTION", "?"), token("UNIT", "km"), undefined)).toBe(true);
	});

	test("not with anything after it", () => {
		expect(isDroppableSentenceEnd(token("QUESTION", "?"), number, number)).toBe(false);
		expect(isDroppableSentenceEnd(token("DOT", "."), number, token("DOT", "."))).toBe(false);
	});

	test("not as the first token", () => {
		expect(isDroppableSentenceEnd(token("QUESTION", "?"), undefined, undefined)).toBe(false);
	});

	test("not after a conversion word, as or =", () => {
		for (const type of ["TO", "IN", "AS", "CONVERT", "EQUALS", "THEREFORE"]) {
			expect(isDroppableSentenceEnd(token("QUESTION", "?"), token(type, "x"), undefined)).toBe(false);
		}
	});

	test("not after another mark", () => {
		expect(isDroppableSentenceEnd(token("QUESTION", "?"), token("QUESTION", "?"), undefined)).toBe(false);
		expect(isDroppableSentenceEnd(token("QUESTION", "?"), token("DOT", "."), undefined)).toBe(false);
	});

	test("only those two tokens, spelled as themselves", () => {
		expect(isDroppableSentenceEnd(token("BANG", "!"), number, undefined)).toBe(false);
		expect(isDroppableSentenceEnd(token("SEMICOLON", ";"), number, undefined)).toBe(false);
		expect(isDroppableSentenceEnd(token("COMMA", ","), number, undefined)).toBe(false);
		// A token that claims the type with another spelling is not the mark.
		expect(isDroppableSentenceEnd(token("QUESTION", "??"), number, undefined)).toBe(false);
		expect(isDroppableSentenceEnd(token("DOT", "․"), number, undefined)).toBe(false);
	});
});

describe("adversarial", () => {
	test("prototype words before the mark are names, refused or answered as without it", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word}?`, { engine: engineOn() });
				expect(show(`${word} + 1?`)).toBe(show(`${word} + 1`));
			}
		});
	});

	test("look-alike marks are not the mark", () => {
		// A fullwidth question mark, an Arabic one, and a one-dot leader.
		for (const mark of ["？", "؟", "․", "。"]) {
			expectHonestLine(`5 + 5${mark}`, { engine: engineOn() });
			expect(show(`5 + 5${mark}`)).toMatch(/^THROWS/);
		}
		// A zero-width space between the value and the mark is still one mark.
		expect(show("5 + 5​?")).toBe(show("5 + 5?"));
	});

	test("markup and injection-shaped text followed by a mark is read as text", () => {
		for (const text of TEXT_EDGES) expectHonestLine(`${text}?`, { engine: engineOn() });
	});

	test("the edge numbers followed by a mark answer as without it", () => {
		for (const line of fill("X?", NUMERIC_EDGES)) {
			expectHonestLine(line, { engine: engineOn(), allowNaN: true });
			expect(show(line)).toBe(show(line.slice(0, -1)));
		}
	});

	test("a long sum and deep brackets followed by a mark are answered within budget", () => {
		const engine = newTrackedEngine({ config: { validation: { allowTrailingPunctuation: true, maxExpressionLength: 100_000, maxComplexity: 100_000 } } });
		expectHonestLine(`${RESOURCE_PROBES.longSum(2_000)}?`, { engine });
		expectHonestLine(`${RESOURCE_PROBES.deepParens(40)}.`, { engine });
		expectHonestLine(`${"?".repeat(10_000)}`, { engine });
	});

	test("CRLF and trailing spaces after the mark", () => {
		expect(show("5 + 5?\r")).toBe("10");
		expect(show("5 + 5?   ")).toBe("10");
	});
});
