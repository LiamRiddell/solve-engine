import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { extractReadsAndWrites } from "@solve-js/engine/ExpressionEngineSafety";
import {
	NO_HIDDEN_DIRECTIONS,
	describeDirectionControl,
	directionControlRefusal,
	findHiddenDirections,
	hasDirectionControl,
	hiddenDirectionToRefuse,
	isDirectionControl,
} from "@solve-js/engine/DirectionControls";
import { LanguageService } from "@solve-js/language/LanguageService";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { safeText } from "@solve-js/parser/ParseMessages";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Found bug: an invisible direction control became part of a name. `<RLO>rent
 * = 5` (U+202E, the right-to-left override, before `rent`) defined a variable
 * stored as "‮rent" in both document passes, and a later `<RLO>rent`
 * read it back: a name shown as one thing and stored as another, the "Trojan
 * Source" shape. The lexer reads every character past ASCII as part of a word,
 * and nothing between it and the variable store asked what the character was.
 *
 * A word that holds one of the twelve direction controls (U+202A to U+202E,
 * U+2066 to U+2069, U+200E, U+200F, U+061C) is now refused by name
 * (`DIRECTION_CONTROL_IN_NAME`), whether it is a name being defined or read,
 * the digits of a number or a unit, with the character written as its code
 * point. Text keeps them: a string literal, a comment, a heading, a label and a
 * prose line that fails before reaching the character are read as before.
 */

const RLO = "‮";

/** The twelve direction controls, by code unit. */
const CONTROLS = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];

/** The refusal message for a word, as the reader sees it. */
function refusal(word: string, character: string): string {
	return `"${word}" holds ${character}, an invisible character that changes the direction text is shown in, so it would not read as what it is. A name, a number or a unit cannot hold one: delete it and type the word again.`;
}

/** One line through evaluateLine, as the reader sees it: the answer, or the code and message it was refused with. */
function line(source: string): string {
	const outcome = evaluateLine(source);
	if (outcome.kind === "value") return outcome.text.replace(/^=\s*/, "");
	if (outcome.kind === "crashed") return `CRASHED ${outcome.name}: ${outcome.message}`;
	return `${outcome.code}: ${outcome.message}`;
}

/** A document through both passes, each line as the reader sees it. */
function both(text: string): { batch: string[]; incremental: string[] } {
	const shown = (result: ReturnType<ReturnType<typeof newTrackedEngine>["parseDocument"]>): string[] =>
		result.lines.map((l) => {
			if (l.result == null) return l.error ? `ERROR ${l.error}` : "";
			if (l.result.isError()) return `ERROR ${String(l.result.errorMessage)}`;
			return formatValue(l.result).replace(/^=\s*/, "");
		});
	return { batch: shown(newTrackedEngine().parseDocument(text)), incremental: shown(evaluateDocument(newTrackedEngine(), text)) };
}

/** The lexer's tokens for a line, without spaces. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
}

/** A live evaluator's answers after editing one line, the way an editor does on a keystroke. */
function afterEdit(lines: string[], lineNumber: number, text: string): string[] {
	const model = new DocumentModel();
	model.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(model, newTrackedEngine());
	try {
		evaluator.evaluate({ startLine: 1, endLine: model.lineCount });
		model.editLine(lineNumber, text);
		const pass = evaluator.evaluate({ startLine: 1, endLine: model.lineCount });
		return pass.lines.map((l) => {
			if (l.error) return `ERROR ${l.error}`;
			if (!l.result) return "";
			const answer = formatValue(l.result).replace(/^=\s*/, "");
			return l.result.type === ValueType.Error ? `ERROR ${answer}` : answer;
		});
	} finally {
		evaluator.terminateWorker();
	}
}

describe("the lines that exposed it", () => {
	test("a name holding the override is refused where it is defined, by its code point", () => {
		expect(line(`${RLO}rent = 5`)).toBe(`DIRECTION_CONTROL_IN_NAME: ${refusal("<U+202E>rent", "U+202E (right-to-left override)")}`);
	});

	test("both document passes refuse the definition and the read, and the real name is untouched", () => {
		const text = `rent = 5\n${RLO}rent = 7\n${RLO}rent * 2\nrent`;
		const { batch, incremental } = both(text);
		const refused = `ERROR ${refusal("<U+202E>rent", "U+202E (right-to-left override)")}`;
		expect(batch).toEqual(["5", refused, refused, "5"]);
		expect(incremental).toEqual(batch);
	});

	test("nothing is stored under the hidden spelling, so no suggestion names it", () => {
		const { batch, incremental } = both(`${RLO}rent = 5\nrent`);
		expect(batch[1]).toBe("ERROR Undefined variable: rent");
		expect(incremental).toEqual(batch);
	});
});

describe("every place a word can hold one", () => {
	test.each(CONTROLS.map((c) => [c]))("U+%s in a name being defined or read is refused, through every entry point", (code) => {
		const ch = String.fromCharCode(code);
		const named = describeDirectionControl(code);
		for (const source of [`${ch}x = 5`, `x${ch} = 5`, `x = 5\nx${ch} + 1`]) {
			const last = source.split("\n").pop()!;
			const word = last.startsWith(ch) ? `<${named.slice(0, 6)}>x` : `x<${named.slice(0, 6)}>`;
			const { batch, incremental } = both(source);
			expect(batch[batch.length - 1]).toBe(`ERROR ${refusal(word, named)}`);
			expect(incremental).toEqual(batch);
			if (!source.includes("\n")) expect(line(source)).toBe(`DIRECTION_CONTROL_IN_NAME: ${refusal(word, named)}`);
		}
	});

	test("inside a number, a unit and a function name, refused at the word that holds it", () => {
		expect(line(`5${RLO}0`)).toBe(`DIRECTION_CONTROL_IN_NAME: ${refusal("<U+202E>0", "U+202E (right-to-left override)")}`);
		expect(line(`5 k${RLO}m`)).toBe(`DIRECTION_CONTROL_IN_NAME: ${refusal("k<U+202E>m", "U+202E (right-to-left override)")}`);
		expect(line(`f${RLO}(x) = x * 2`)).toMatch(/^DIRECTION_CONTROL_IN_NAME: "f<U\+202E>"/);
		expect(line(`${RLO}5 + 1`)).toMatch(/^DIRECTION_CONTROL_IN_NAME: "<U\+202E>5"/);
	});

	test("every way of defining a name refuses it: colon, bare, running total, unit, several words, frozen, tag", () => {
		for (const source of [`:${RLO}x = 5`, `${RLO}x = 5`, `${RLO}x += 5`, `1 spr${RLO}int = 2 weeks`, `my${RLO} rent = 5`, `${RLO}x frozen`, `5 #tag${RLO}`, `${RLO} rent = 5`]) {
			expect(evaluateLine(source)).toEqual(expect.objectContaining({ kind: "thrown", code: "DIRECTION_CONTROL_IN_NAME" }));
		}
	});

	test("text keeps them: a string literal, a comment, a heading and a label", () => {
		expect(line(`"a${RLO}b"`)).toBe(`a${RLO}b`);
		expect(line(`5 // note ${RLO} here`)).toBe("5");
		const { batch, incremental } = both(`# Head ${RLO} ing\nx = "a${RLO}b"\nRent${RLO}: $5\n5 // ${RLO}`);
		expect(batch).toEqual(["", `a${RLO}b`, "$5.00", "5"]);
		expect(incremental).toEqual(batch);
	});

	test("a prose line that fails before the character keeps its own error, so prose gains none", () => {
		expect(line(`Prose about ${RLO} things`)).toBe('UNEXPECTED_TRAILING_TOKEN: Expected an operator or the end of the line, but found "about"');
		const { batch, incremental } = both(`Prose about ${RLO} things\nrent = 5`);
		expect(batch).toEqual(['ERROR Expected an operator or the end of the line, but found "about"', "5"]);
		expect(incremental).toEqual(batch);
	});

	test("a name in a right-to-left script, with no control in it, is still a name", () => {
		expect(both("إيجار = 5\nإيجار * 2").batch).toEqual(["5", "10"]);
		expect(both("שכר = 5\nשכר * 2").batch).toEqual(["5", "10"]);
	});
});

describe("the language service", () => {
	test("completions never offer the hidden name, and the real one still is", () => {
		const engine = newTrackedEngine();
		evaluateDocument(engine, `${RLO}rent = 5\nrental = 7`);
		const ls = new LanguageService(engine);
		const labels = ls.getCompletions("ren", 3).map((c) => c.label);
		expect(labels).toContain("rental");
		expect(labels.some((l) => hasDirectionControl(l))).toBe(false);
		expect(ls.getCompletions(RLO, 1).some((c) => hasDirectionControl(c.label))).toBe(false);
	});

	test("the line is not painted as a recognised expression", () => {
		const ls = new LanguageService(newTrackedEngine());
		expect(ls.getSemanticTokens(`${RLO}rent = 5`, 1)).toEqual([]);
		expect(ls.getSemanticTokens("rent = 5", 2).length).toBeGreaterThan(0);
	});

	test("readExpressionTokens agrees with compiling: the refused line is not code, a label or a string keeps it", () => {
		const engine = newTrackedEngine();
		for (const source of [`${RLO}rent = 5`, `${RLO}rent`, `${RLO}x += 1`, `1 spr${RLO}int = 2 weeks`, `5${RLO}0`]) {
			expect(engine.readExpressionTokens(source)).toBeNull();
			expect(engine.tryCompileExpression(source)).toBe(false);
		}
		const labelled = engine.readExpressionTokens(`Rent${RLO}: 1200`);
		expect(labelled?.start).toBe(2);
		expect(engine.tryCompileExpression(`Rent${RLO}: 1200`)).toBe(true);
		expect(engine.readExpressionTokens(`x = "a${RLO}b"`)).not.toBeNull();
		expect(engine.readExpressionTokens("rent = 5")).not.toBeNull();
	});

	test("the incremental evaluator's graph never holds the name", () => {
		const engine = newTrackedEngine();
		evaluateDocument(engine, `${RLO}rent = 5\n${RLO}rent + 1\nrent = 2`);
		const ls = new LanguageService(engine);
		const offered = [...ls.getCompletions("r", 1), ...ls.getCompletions(RLO, 1)].map((c) => c.label);
		expect(offered).toContain("rent");
		expect(offered.some((k) => hasDirectionControl(k))).toBe(false);
	});
});

// ── The parts ─────────────────────────────────────────────────────────────

describe("isDirectionControl and hasDirectionControl", () => {
	test("all twelve, and nothing either side of their ranges", () => {
		for (const code of CONTROLS) expect(isDirectionControl(code)).toBe(true);
		for (const code of [0x061b, 0x061d, 0x200b, 0x200d, 0x2010, 0x2029, 0x202f, 0x2065, 0x206a, 0xfeff, 0x41, 0, -1, NaN, 0x1202e]) {
			expect(isDirectionControl(code)).toBe(false);
		}
	});

	test("finds one anywhere in text, and nothing in text without one", () => {
		expect(hasDirectionControl("")).toBe(false);
		expect(hasDirectionControl("rent = 5")).toBe(false);
		expect(hasDirectionControl("​zero﻿width‍")).toBe(false);
		for (const code of CONTROLS) expect(hasDirectionControl(`a${String.fromCharCode(code)}`)).toBe(true);
		expect(hasDirectionControl("x".repeat(100_000) + RLO)).toBe(true);
	});
});

describe("describeDirectionControl", () => {
	test("the code point and its Unicode name", () => {
		expect(describeDirectionControl(0x202e)).toBe("U+202E (right-to-left override)");
		expect(describeDirectionControl(0x061c)).toBe("U+061C (arabic letter mark)");
		expect(describeDirectionControl(0x2069)).toBe("U+2069 (pop directional isolate)");
	});

	test("any other code unit is its bare code point, never a guessed name", () => {
		expect(describeDirectionControl(0x41)).toBe("U+0041");
		expect(describeDirectionControl(0)).toBe("U+0000");
	});
});

describe("findHiddenDirections", () => {
	test("each word holding a control, with its first control, in order", () => {
		const found = findHiddenDirections(lex(`a${RLO}⁦ + b‏`));
		expect(found.map((h) => [h.text, h.code])).toEqual([[`a${RLO}⁦`, 0x202e], ["b‏", 0x200f]]);
		expect(found[0].offset).toBe(0);
		expect(found[1].offset).toBe(6);
	});

	test("text in quotes is skipped, and a line with none finds none", () => {
		expect(findHiddenDirections(lex(`"a${RLO}b" + 1`))).toEqual([]);
		expect(findHiddenDirections(lex("rent * 2"))).toEqual([]);
		expect(findHiddenDirections([])).toEqual([]);
		expect(NO_HIDDEN_DIRECTIONS).toEqual([]);
		expect(Object.isFrozen(NO_HIDDEN_DIRECTIONS)).toBe(true);
	});

	test("a comment token is skipped too, whoever lexed it", () => {
		const comment = { type: "COMMENT", typeId: 0, value: `// ${RLO}`, text: `// ${RLO}`, offset: 0, lineBreaks: 0, line: 1, col: 1 } as Token;
		expect(findHiddenDirections([comment])).toEqual([]);
	});
});

describe("directionControlRefusal", () => {
	test("a parse error with the code, the reader's message and a span on the word", () => {
		const error = directionControlRefusal({ offset: 4, text: `${RLO}rent`, code: 0x202e, line: 1, col: 5 });
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe("DIRECTION_CONTROL_IN_NAME");
		expect(error.message).toBe(refusal("<U+202E>rent", "U+202E (right-to-left override)"));
		expect(error.span).toEqual({ start: 4, end: 9, line: 1, col: 5 });
		expect(error.recoverable).toBe(true);
	});

	test("a hostile word is quoted safely and cut short", () => {
		const error = directionControlRefusal({ offset: 0, text: `${RLO}<script>${"x".repeat(200)}`, code: 0x202e });
		expect(error.message.startsWith('"<U+202E><script>')).toBe(true);
		expect(error.message).toContain('..."');
		expect(error.message.length).toBeLessThan(300);
	});
});

describe("hiddenDirectionToRefuse", () => {
	const at = (offset: number) => ({ offset, text: RLO, code: 0x202e });

	test("after a parse: the first word in the code part, past any label", () => {
		expect(hiddenDirectionToRefuse([at(0), at(10)], 5)).toEqual(at(10));
		expect(hiddenDirectionToRefuse([at(0)], 5)).toBeNull();
		expect(hiddenDirectionToRefuse([at(5)], 5)).toEqual(at(5));
	});

	test("after a failure: a word at or before the place it failed, and none after it", () => {
		expect(hiddenDirectionToRefuse([at(3)], null, 3)).toEqual(at(3));
		expect(hiddenDirectionToRefuse([at(2)], null, 7)).toEqual(at(2));
		expect(hiddenDirectionToRefuse([at(12)], null, 6)).toBeNull();
		expect(hiddenDirectionToRefuse([at(12)], null, undefined)).toEqual(at(12));
	});

	test("no words, no refusal", () => {
		expect(hiddenDirectionToRefuse([], 0)).toBeNull();
		expect(hiddenDirectionToRefuse(NO_HIDDEN_DIRECTIONS, null, 0)).toBeNull();
	});
});

describe("safeText names the Arabic letter mark by its code point too", () => {
	test("U+061C is written as its code point, as the other direction controls are", () => {
		expect(safeText("؜x")).toBe("<U+061C>x");
		expect(safeText(`${RLO}x⁦`)).toBe("<U+202E>x<U+2066>");
		expect(safeText("x")).toBe("x");
	});
});

describe("extractReadsAndWrites", () => {
	test("a word holding a control is neither read nor written", () => {
		const engine = newTrackedEngine();
		const normalized = engine.getNormalizer().normalize(lex(`${RLO}rent = rent + y${RLO}`));
		expect(extractReadsAndWrites(normalized)).toEqual({ reads: ["rent"], writes: [] });
		expect(extractReadsAndWrites(engine.getNormalizer().normalize(lex("rent = 5")))).toEqual({ reads: ["rent"], writes: ["rent"] });
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: a prototype word holding a control is refused, and the prototype is untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				for (const source of [`${RLO}${word} = 5`, `${word}${RLO} = 5`, `:${word}${RLO} = 1`]) {
					expect(expectHonestLine(source)).toEqual(expect.objectContaining({ code: "DIRECTION_CONTROL_IN_NAME" }));
				}
				expectHonestDocument(`${RLO}${word} = 5\n${RLO}${word}\n${word}${RLO} += 1`);
			}
		});
	});

	test("security: sized input stays inside its budget", () => {
		expectHonestLine(`${RESOURCE_PROBES.longIdentifier()}${RLO} = 5`);
		expectHonestLine(`${RLO.repeat(10_000)}x = 5`);
		expectHonestLine(`"${RLO.repeat(50_000)}"`);
		expectHonestLine(`${RESOURCE_PROBES.longSum(2_000)} + x${RLO}`);
		expectHonestDocument(RESOURCE_PROBES.manyLines(1_000, `prev + 1 + ${RLO}x`), { budgetMs: 15_000 });
	});

	test("security: look-alike and markup-shaped text, with a control beside it", () => {
		for (const source of fill(`${RLO}X`, TEXT_EDGES)) expectHonestLine(source);
		for (const source of fill("X", TEXT_EDGES)) expectHonestLine(source);
		expect(line(`<script>${RLO}alert(1)</script>`)).toMatch(/^[A-Z_]+: /);
		// The other invisibles keep their own reading: a zero-width space still
		// separates, and a zero-width joiner is still part of a word.
		expect(line("1​+​1")).toBe("2");
		expect(line(`"‭latin‬"`)).toBe("‭latin‬");
	});

	test("realistic: the value from the line above, a check, a what-if, a tag, a section and a trace", () => {
		const text = [`rent = 1200`, `check ${RLO}rent == 1200`, `rent * 12`, `${RLO}rent #housing`, `total of #housing`, `## Bills`, `${RLO}bill = 5`, `what if rent = 1000: line 3`].join("\n");
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch[1]).toMatch(/^ERROR "<U\+202E>rent" holds U\+202E/);
		expect(batch[2]).toBe("= 14,400");
		expect(batch[3]).toMatch(/^ERROR "<U\+202E>rent" holds/);
		expect(batch[6]).toMatch(/^ERROR "<U\+202E>bill" holds/);
		expect(incremental).toEqual(batch);
		let traced: string;
		try {
			traced = JSON.stringify(newTrackedEngine().explainLine(`${RLO}rent * 2`));
		} catch (e) {
			expect(e).toBeInstanceOf(EngineError);
			traced = (e as EngineError).code;
		}
		expect(traced).toContain("DIRECTION_CONTROL_IN_NAME");
	});

	test("realistic: deleting the character in an edit makes the line a name again", () => {
		expect(afterEdit([`${RLO}rent = 5`, "rent * 2"], 1, "rent = 5")).toEqual(["5", "10"]);
		const before = afterEdit(["rent = 5", "rent * 2"], 1, `${RLO}rent = 5`);
		expect(before[0]).toMatch(/^ERROR "<U\+202E>rent" holds/);
		expect(before[1]).toMatch(/^ERROR Undefined variable: rent/);
	});

	test("realistic: the same text a second time is answered the same way (the cached failure)", () => {
		const engine = newTrackedEngine();
		const first = evaluateLine(`${RLO}rent = 5`, engine);
		const second = evaluateLine(`${RLO}rent = 5`, engine);
		expect(second).toEqual(first);
		expect(evaluateLine("rent", engine)).toEqual(expect.objectContaining({ code: "UNDEFINED_VARIABLE" }));
	});

	test("edge: a lone control, one at either end, CRLF, a trailing newline and an emoji neighbour", () => {
		expect(line(RLO)).toMatch(/^DIRECTION_CONTROL_IN_NAME: "<U\+202E>"/);
		expect(line(`x = 5${RLO}`)).toMatch(/^DIRECTION_CONTROL_IN_NAME: "<U\+202E>"/);
		const { batch, incremental } = both(`${RLO}x = 1\r\nx = 2\r\nx\n`);
		expect(batch.slice(0, 3)).toEqual([expect.stringMatching(/^ERROR "<U\+202E>x" holds/), "2", "2"]);
		expect(incremental).toEqual(batch);
		expect(line(`🙂${RLO} = 1`)).toMatch(/^DIRECTION_CONTROL_IN_NAME: "🙂<U\+202E>"/);
	});

	test("edge: numbers at the limits, with a control after them", () => {
		for (const n of ["0", "-0", "2^53", "1e308", "12345678901234567890123456789012345"]) {
			expect(evaluateLine(`${n} + x${RLO}`)).toEqual(expect.objectContaining({ code: "DIRECTION_CONTROL_IN_NAME" }));
			expect(evaluateLine(`${n} + 1 // ${RLO}`).kind).toBe("value");
		}
	});
});
