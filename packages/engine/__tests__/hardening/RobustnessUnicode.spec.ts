/**
 * Text that is not ASCII, and where the lexer puts its boundaries in it.
 *
 * Two separate properties. Both hold now; the second did not when this file
 * was written.
 *
 * The first is positional. Every token carries `offset`, `line` and `col`
 * into the source string, and a host underlines an error with them. JavaScript
 * strings are indexed in UTF-16 code units, so an emoji is two positions wide
 * and a family emoji joined by zero-width joiners is eight. The lexer indexes
 * the same way throughout, which makes `source.slice(offset, offset + length)`
 * the exact token text for every input below, astral plane and combining marks
 * included. That is the property the first block asserts, over a corpus rather
 * than a handful of cases, because an off-by-one here would only ever show up
 * as an underline drawn under the wrong character.
 *
 * The second is classification, and it is where the trouble was. The lexer's
 * character-class table is 128 bytes wide, so every code point past ASCII
 * takes one fallback branch: `cc >= 128` inside `tokenizeIdentifier()` read
 * it as part of an identifier. That is right for `café` and `日本語` and even
 * for emoji. It was wrong for the dozen or so code points that are whitespace
 * without being ASCII whitespace, and for the invisible formatting marks that
 * arrive with pasted text. A no-break space between two operands did not
 * separate them, it joined them into one undefined variable, so a sum pasted
 * out of a web page or a PDF did not evaluate.
 *
 * `isUnicodeSpace()` in `lexer/ExpressionLexer.ts` now routes that set to
 * whitespace in the non-ASCII fallback, before the identifier reader sees it,
 * and stops the identifier loop on the same set. The zero-width JOINERS stay
 * identifier characters, which is what keeps the family-emoji case in the
 * first block correct.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { EngineError } from "@solve-js/errors/EngineError";

/**
 * Scripts, widths and joining behaviours that index differently from each
 * other in UTF-16: two-byte CJK, a combining mark that follows its base
 * letter, a surrogate pair, a sequence of surrogate pairs joined by
 * zero-width joiners, an RTL script, and an astral-plane mathematical letter.
 */
const UNICODE_SOURCES: string[] = [
	"1 + 2",
	"café + 2",
	"café + 2",
	"日本語 + 2",
	"Ω + π",
	"🙂 + 2",
	"👨‍👩‍👧 + 2",
	"𝛼 + 𝛽",
	"א + 2",
	"مرحبا + 2",
	"1 + \"🙂\" + 2",
	"наименование * 3",
	"x🙂y + 1",
	"ñ + ü + ö",
];

/** The raw token stream, before normalization fuses anything. */
function lex(engine: ReturnType<typeof newTrackedEngine>, source: string) {
	const lexer = engine.getLexer();
	lexer.resetExpression(source);
	return Array.from(lexer);
}

describe("token positions index the source the way JavaScript does", () => {
	test("every token slices back out of the source at its own offset", () => {
		// The property that makes `offset` usable for an underline at all. It
		// is asserted by slicing rather than by comparing lengths, so a token
		// whose offset drifted by one but whose length is right still fails.
		const engine = newTrackedEngine("en");
		const wrong: string[] = [];
		for (const source of UNICODE_SOURCES) {
			for (const token of lex(engine, source)) {
				const sliced = source.slice(token.offset, token.offset + token.text.length);
				if (sliced !== token.text) {
					wrong.push(`${JSON.stringify(source)}: ${token.type} at ${token.offset} sliced ${JSON.stringify(sliced)}, holds ${JSON.stringify(token.text)}`);
				}
			}
		}
		expect(wrong).toEqual([]);
	});

	test("offsets advance and no token runs past the end of the source", () => {
		const engine = newTrackedEngine("en");
		const wrong: string[] = [];
		for (const source of UNICODE_SOURCES) {
			let previousEnd = -1;
			for (const token of lex(engine, source)) {
				if (token.offset < previousEnd) {
					wrong.push(`${JSON.stringify(source)}: ${token.type} at ${token.offset} starts before ${previousEnd}`);
				}
				if (token.offset + token.text.length > source.length) {
					wrong.push(`${JSON.stringify(source)}: ${token.type} ends past ${source.length}`);
				}
				previousEnd = token.offset + token.text.length;
			}
		}
		expect(wrong).toEqual([]);
	});

	test("the sweep is actually looking at something", () => {
		// Guard on the guard: an empty token stream would pass both loops.
		const engine = newTrackedEngine("en");
		for (const source of UNICODE_SOURCES) {
			expect(lex(engine, source).length).toBeGreaterThan(1);
		}
	});

	test("an emoji is two positions wide and the operator after it knows that", () => {
		// The single case spelled out, so a failure of the sweep above has a
		// worked example to compare against.
		const engine = newTrackedEngine("en");
		const tokens = lex(engine, "🙂 + 2");
		expect(tokens[0].text).toBe("🙂");
		expect(tokens[0].offset).toBe(0);
		expect(tokens[1].text).toBe("+");
		expect(tokens[1].offset).toBe(3);
		expect(tokens[2].offset).toBe(5);
	});
});

describe("non-ASCII identifiers behave like identifiers", () => {
	test("a name in any script can hold a value and be read back", () => {
		for (const name of ["café", "日本語", "Ω", "наименование", "ñ"]) {
			const engine = newTrackedEngine("en");
			engine.evaluateLine(1, `:${name} = 6`);
			expect(engine.evaluateLine(2, `:${name} * 7`)[0].toNumber()).toBe(42);
		}
	});

	test("an undefined one is named back exactly as it was typed", () => {
		// The message is what the reader sees, so a name mangled on the way
		// into the error is a real defect even though the evaluation was going
		// to fail either way.
		const engine = newTrackedEngine("en");
		for (const name of ["café", "日本語", "🙂", "مرحبا", "𝛼"]) {
			try {
				engine.evaluateExpression(`${name} + 1`);
				throw new Error(`expected ${name} to be undefined`);
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(EngineError);
				expect((thrown as EngineError).message).toContain(name);
			}
		}
	});

	test("a lone surrogate neither hangs nor escapes as a JS error", () => {
		// Half of a surrogate pair is not a character at all, and it is what a
		// truncated paste or a byte-sliced string produces. The lexer's
		// identifier loop advances one code unit at a time, so the risk here is
		// a loop that never advances rather than a wrong answer.
		const engine = newTrackedEngine("en");
		for (const source of ["\uD83D", "\uDE00", "\uD83D1+1", "1+1\uDE00", "\uD83D\uD83D\uD83D"]) {
			try {
				engine.evaluateExpression(source);
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(EngineError);
			}
		}
	});
});

/**
 * Code points that Unicode calls whitespace, and that JavaScript's own `\s`
 * matches, but that the lexer's 128-byte character-class table cannot see.
 * These arrive constantly in pasted text: a no-break space from a web page or
 * a word processor, a byte-order mark from a Windows editor or a spreadsheet
 * export, an ideographic space from CJK input.
 */
const UNICODE_SPACES: Array<[string, string]> = [
	[" ", "no-break space"],
	[" ", "figure space"],
	[" ", "thin space"],
	[" ", "narrow no-break space"],
	["　", "ideographic space"],
	["﻿", "byte-order mark"],
];

describe("whitespace that is not ASCII whitespace", () => {
	test("ASCII spacing works, which is what the test below compares against", () => {
		const engine = newTrackedEngine("en");
		expect(engine.evaluateExpression("1 + 1")[0].toNumber()).toBe(2);
		expect(engine.evaluateExpression("1\t+\t1")[0].toNumber()).toBe(2);
		expect(engine.evaluateExpression("1+1")[0].toNumber()).toBe(2);
	});

	test("separates operands the same way an ordinary space does", () => {
		// Every code point above, one assertion.
		//
		// `tokenizeIdentifier()` used to continue an identifier on any
		// `cc >= 128`, and the outer dispatch sent any `cc >= 128` there, so a
		// no-break space was an identifier character: a sum written with them
		// lexed as one identifier and reported "Undefined variable". A
		// byte-order mark at the head of a line did the same to the whole line,
		// which is the case most likely to be met in the wild, since a file
		// saved with a BOM made its first expression stop working.
		//
		// The fix is in the lexer's non-ASCII fallback rather than in the
		// 128-byte table, which cannot hold these code points at all. See
		// `isUnicodeSpace()`.
		const engine = newTrackedEngine("en");
		const broken: string[] = [];
		for (const [space, name] of UNICODE_SPACES) {
			try {
				const answer = engine.evaluateExpression(`1${space}+${space}1`)[0].toNumber();
				if (answer !== 2) broken.push(`${name}: answered ${answer}`);
			} catch (thrown) {
				broken.push(`${name}: ${(thrown as EngineError).code}`);
			}
		}
		expect(broken).toEqual([]);
	});

	test("and a leading byte-order mark does not break the line under it", () => {
		// Stated separately from the sweep because it is the one a user meets
		// without doing anything unusual, and because a fix might reasonably
		// special-case it before handling the general set above.
		const engine = newTrackedEngine("en");
		expect(engine.evaluateExpression("﻿1+1")[0].toNumber()).toBe(2);
	});
});
