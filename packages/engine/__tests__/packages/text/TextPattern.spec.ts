/**
 * The text package's own regular-expression matcher (issue #520).
 *
 * Three things are pinned here. It agrees with JavaScript's `RegExp` on the
 * syntax it accepts, found by a seeded differential run against the native
 * engine, captures included. It refuses the syntax it does not run, by name.
 * And its work is bounded: the patterns that make a backtracking matcher take
 * exponential time finish here in time proportional to the text, and a step
 * budget stops everything else.
 */

import { describe, expect, test } from "@jest/globals";
import {
	compilePattern, isPatternFault, PatternRunner, PatternBudget, PatternBudgetExceeded,
	MAX_PATTERN_STEPS, type CompiledPattern,
} from "@solve-js/packages/text/TextPattern";

function compiled(source: string, keepGroups = true): CompiledPattern {
	const result = compilePattern(source, keepGroups);
	if (isPatternFault(result)) throw new Error(`${source}: ${result.message}`);
	return result;
}

/** The first match as JavaScript reports it: index, text, and each group (undefined when unset). */
function first(source: string, text: string): { index: number; groups: (string | undefined)[] } | null {
	const pattern = compiled(source);
	const slots = new PatternRunner(pattern, text, new PatternBudget()).search(0);
	if (slots === null) return null;
	const groups: (string | undefined)[] = [];
	for (let g = 0; g <= pattern.groupCount; g++) {
		groups.push(slots[2 * g] === -1 || slots[2 * g + 1] === -1 ? undefined : text.slice(slots[2 * g], slots[2 * g + 1]));
	}
	return { index: slots[0], groups };
}

function count(source: string, text: string): number {
	let n = 0;
	new PatternRunner(compiled(source, false), text, new PatternBudget()).each(() => {
		n++;
		return true;
	});
	return n;
}

function fault(source: string): { code: string; message: string } {
	const result = compilePattern(source, true);
	if (!isPatternFault(result)) throw new Error(`${source} compiled`);
	return result;
}

describe("matching", () => {
	test("literals, the leftmost match, and the first group", () => {
		expect(first("#(\\d+)", "Order #4471 shipped")).toEqual({ index: 6, groups: ["#4471", "4471"] });
		expect(first("an", "banana")).toEqual({ index: 1, groups: ["an"] });
		expect(first("x", "banana")).toBeNull();
	});

	test("alternation prefers the option written first, as JavaScript does", () => {
		expect(first("a|ab", "abc")?.groups[0]).toBe("a");
		expect(first("ab|a", "abc")?.groups[0]).toBe("ab");
	});

	test("greedy and lazy quantifiers", () => {
		expect(first("<.+>", "<a><b>")?.groups[0]).toBe("<a><b>");
		expect(first("<.+?>", "<a><b>")?.groups[0]).toBe("<a>");
		expect(first("a{2,3}", "aaaa")?.groups[0]).toBe("aaa");
		expect(first("a{2,3}?", "aaaa")?.groups[0]).toBe("aa");
		expect(first("a{2,}", "aaaaa")?.groups[0]).toBe("aaaaa");
		expect(first("ba??", "baa")?.groups[0]).toBe("b");
	});

	test("anchors and word boundaries", () => {
		expect(first("^b", "ab")).toBeNull();
		expect(first("b$", "ab")?.index).toBe(1);
		expect(first("\\bcat\\b", "concat cat")?.index).toBe(7);
		expect(first("\\Bcat", "concat cat")?.index).toBe(3);
	});

	test("classes, ranges, negation and the shorthand sets", () => {
		expect(first("[a-c]+", "xxbcay")?.groups[0]).toBe("bca");
		expect(first("[^a-c]+", "abxyc")?.groups[0]).toBe("xy");
		expect(first("\\d+\\.\\d+", "total 12.50 due")?.groups[0]).toBe("12.50");
		expect(first("\\w+", "  hello_1 ")?.groups[0]).toBe("hello_1");
		expect(first("\\s+", "a \t b")?.groups[0]).toBe(" \t ");
		expect(first("[\\d-]+", "tel 555-1234")?.groups[0]).toBe("555-1234");
		expect(first("[]", "abc")).toBeNull();
		expect(first("[^]", "\n")?.groups[0]).toBe("\n");
	});

	test("(?i) at the start matches letters regardless of case", () => {
		expect(first("(?i)total: (\\d+)", "TOTAL: 42")?.groups[1]).toBe("42");
		expect(first("(?i)[a-z]+", "ABC")?.groups[0]).toBe("ABC");
		expect(first("(?i)[^a]", "A")).toBeNull();
		expect(first("total", "TOTAL")).toBeNull();
	});

	test("(?i) folds case by JavaScript's rule beyond ASCII too", () => {
		// The micro sign folds to Greek capital mu, a title-case digraph to its
		// capital, and the long s does not meet an ASCII s.
		for (const [source, text] of [["[µ]", "Μ"], ["[ǅ]", "ǆ"], ["s", "ſ"], ["[a-z]", "ſ"], ["é", "É"], ["[α-ω]+", "ΑΒΓ"]] as const) {
			const native = new RegExp(source, "i").exec(text);
			expect(first(`(?i)${source}`, text)?.groups[0]).toBe(native?.[0]);
		}
		expect(first("(?i)[µ]", "Μ")).not.toBeNull();
		expect(first("(?i)s", "ſ")).toBeNull();
	});

	test("a group that took no part is unset, and a loop resets its groups each pass", () => {
		expect(first("a(x)?b", "ab")?.groups).toEqual(["ab", undefined]);
		expect(first("(x)|(b)", "b")?.groups).toEqual(["b", undefined, "b"]);
		// JavaScript forgets a group's capture at the start of each iteration.
		expect(first("(?:(a)|b)+", "ab")?.groups).toEqual(["ab", undefined]);
		expect(/(?:(a)|b)+/.exec("ab")?.[1]).toBeUndefined();
	});

	test("non-capturing and named groups", () => {
		expect(first("(?:ab)+", "ababx")?.groups).toEqual(["abab"]);
		expect(first("(?<year>\\d{4})-(\\d{2})", "on 2026-09")?.groups).toEqual(["2026-09", "2026", "09"]);
	});

	test("a character is a code point, so an emoji is one character to . and to a class", () => {
		expect(first("^.", "😀a")?.groups[0]).toBe("😀");
		expect(first("[😀]", "a😀")?.index).toBe(1);
		expect(first("w.rld", "héllo wörld")?.groups[0]).toBe("wörld");
	});

	test("escapes: hexadecimal, Unicode, and punctuation read as itself", () => {
		expect(first("\\x41", "zA")?.index).toBe(1);
		expect(first("\\u00e9", "café")?.index).toBe(3);
		expect(first("\\$\\d+", "cost $12")?.groups[0]).toBe("$12");
		expect(first('\\"(\\w+)\\"', 'say "hi"')?.groups[1]).toBe("hi");
		expect(first("a{", "a{")?.groups[0]).toBe("a{");
		expect(first("a{,2}", "a{,2}")?.groups[0]).toBe("a{,2}");
	});

	test("counting matches: non-overlapping, and an empty match moves on one character", () => {
		expect(count("an", "banana")).toBe(2);
		expect(count("ana", "banana")).toBe(1);
		expect(count("", "banana")).toBe(7);
		expect(count("x*", "banana")).toBe(7);
		expect(count("\\d+", "a1 b22 c333")).toBe(3);
		expect(count("", "😀")).toBe(2);
	});
});

describe("refusals", () => {
	test.each([
		["(a", "TEXT_PATTERN_INVALID", "never closed"],
		["a)", "TEXT_PATTERN_INVALID", "no \"(\""],
		["[ab", "TEXT_PATTERN_INVALID", "never closed"],
		["*a", "TEXT_PATTERN_INVALID", "nothing to repeat"],
		["a**", "TEXT_PATTERN_INVALID", "nothing to repeat"],
		["^*", "TEXT_PATTERN_INVALID", "nothing to repeat"],
		["{2}", "TEXT_PATTERN_INVALID", "nothing to repeat"],
		["a{3,2}", "TEXT_PATTERN_INVALID", "out of order"],
		["[z-a]", "TEXT_PATTERN_INVALID", "runs backwards"],
		["a\\", "TEXT_PATTERN_INVALID", "ends with a backslash"],
		["\\q", "TEXT_PATTERN_INVALID", "not an escape"],
		["\\x4", "TEXT_PATTERN_INVALID", "hexadecimal"],
		["(?<>a)", "TEXT_PATTERN_INVALID", "needs a name"],
		["(a)\\1", "TEXT_PATTERN_UNSUPPORTED", "backreference"],
		["(?<n>a)\\k<n>", "TEXT_PATTERN_UNSUPPORTED", "backreference"],
		["a(?=b)", "TEXT_PATTERN_UNSUPPORTED", "lookahead"],
		["a(?!b)", "TEXT_PATTERN_UNSUPPORTED", "lookahead"],
		["(?<=a)b", "TEXT_PATTERN_UNSUPPORTED", "lookbehind"],
		["(?<!a)b", "TEXT_PATTERN_UNSUPPORTED", "lookbehind"],
		["\\p{L}", "TEXT_PATTERN_UNSUPPORTED", "property"],
		["a(?i)b", "TEXT_PATTERN_UNSUPPORTED", "(?i)"],
		["\\012", "TEXT_PATTERN_UNSUPPORTED", "octal"],
		["a{1001}", "TEXT_PATTERN_TOO_LARGE", "1000"],
		["((a{1000}){1000}){1000}", "TEXT_PATTERN_TOO_LARGE", "10,000 steps"],
		["(?:".repeat(101) + ")".repeat(101), "TEXT_PATTERN_TOO_LARGE", "nest"],
		["(a)".repeat(33), "TEXT_PATTERN_TOO_LARGE", "32 capturing groups"],
		["a".repeat(501), "TEXT_PATTERN_TOO_LARGE", "500"],
	])("%s is refused as %s", (source, code, words) => {
		const result = fault(source);
		expect(result.code).toBe(code);
		expect(result.message).toContain(words);
	});

	test("a pattern at every limit still compiles", () => {
		expect(isPatternFault(compilePattern("a".repeat(500), true))).toBe(false);
		expect(isPatternFault(compilePattern("(a)".repeat(32), true))).toBe(false);
		expect(isPatternFault(compilePattern("a{1000}", true))).toBe(false);
	});
});

describe("the work is bounded", () => {
	// Each of these takes a backtracking matcher exponential time in the length
	// of the text. Here each finishes in one pass, and says no.
	test.each([
		["(a+)+$", "a".repeat(5000) + "!"],
		["(a|aa)*b", "a".repeat(5000)],
		["(a|a)*b", "a".repeat(5000)],
		["(x+x+)+y", "x".repeat(3000)],
		["^(\\w+\\s?)*$", "an ordinary sentence that ends badly!".repeat(40)],
	])("%s on a long text answers without backtracking", (source, text) => {
		const started = Date.now();
		const slots = new PatternRunner(compiled(source), text, new PatternBudget()).search(0);
		expect(slots).toBeNull();
		expect(Date.now() - started).toBeLessThan(3000);
	});

	test("the native engine is not asked: the same pattern on a short text answers as it does", () => {
		// JavaScript's RegExp finds no match here either. Its answer is written
		// out rather than computed, since this is the pattern shape that makes
		// a backtracking engine exponential.
		expect(first("(a+)+$", "aaaa!")).toBeNull();
	});

	test("a search past its budget stops with PatternBudgetExceeded", () => {
		const runner = new PatternRunner(compiled("(a|aa)*b"), "a".repeat(10000), new PatternBudget(10_000));
		expect(() => runner.search(0)).toThrow(PatternBudgetExceeded);
	});

	test("a budget carries what earlier calls spent", () => {
		const budget = new PatternBudget(MAX_PATTERN_STEPS, MAX_PATTERN_STEPS);
		expect(() => new PatternRunner(compiled("a"), "a", budget).search(0)).toThrow(PatternBudgetExceeded);
	});
});

// ── Differential run against RegExp ───────────────────────────────────────

/** A small seeded generator, so a failing case is reproducible from its seed. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Patterns from the accepted syntax: literals, the shorthand sets, classes,
 * groups of both kinds, alternation, every quantifier greedy and lazy,
 * anchors, word boundaries, and `(?i)`.
 *
 * With `emptyLoops` false, a quantified group's body always consumes a
 * character. With it true, a body may match nothing, which is where
 * JavaScript's rule that an optional iteration must consume something decides
 * the answer. Those patterns are run on shorter texts, since nested loops over
 * bodies that can match nothing are exactly what makes the native engine
 * backtrack exponentially, and the native engine is the reference here.
 */
function patternGenerator(random: () => number, emptyLoops: boolean) {
	const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
	const LEAVES = ["a", "b", "c", "A", "1", " ", "-", ".", "[ab]", "[^a]", "[a-c1]", "[A-Za-z]", "\\d", "\\w", "\\s", "\\W", "\\D"];
	const ANY_QUANTIFIER = ["", "", "", "*", "+", "?", "*?", "+?", "??", "{1,2}", "{2}", "{0,2}", "{1,}", "{0,2}?"];
	const CONSUMING_QUANTIFIER = emptyLoops ? ANY_QUANTIFIER : ["", "", "+", "+?", "{1,2}", "{2}", "{1,}"];

	const atom = (depth: number, consuming: boolean): string => {
		if (depth < 3 && random() < 0.25) {
			const open = pick(["(", "(", "(?:"]);
			return `${open}${alternation(depth + 1, consuming)})`;
		}
		return pick(LEAVES);
	};
	const piece = (depth: number, consuming: boolean): string => {
		const quantifier = pick(consuming ? CONSUMING_QUANTIFIER : ANY_QUANTIFIER);
		return atom(depth, consuming || quantifier !== "") + quantifier;
	};
	const sequence = (depth: number, consuming: boolean): string => {
		const parts: string[] = [];
		const assertions = !consuming || emptyLoops;
		if (assertions && random() < 0.1) parts.push(pick(["^", "\\b"]));
		const n = 1 + Math.floor(random() * 3);
		for (let i = 0; i < n; i++) parts.push(piece(depth, consuming));
		if (assertions && random() < 0.1) parts.push(pick(["$", "\\b", "\\B"]));
		return parts.join("");
	};
	const alternation = (depth: number, consuming: boolean): string => {
		const n = random() < 0.25 ? 2 : 1;
		const options: string[] = [];
		for (let i = 0; i < n; i++) options.push(sequence(depth, consuming));
		return options.join("|");
	};
	return () => (random() < 0.15 ? "(?i)" : "") + alternation(0, false);
}

function textGenerator(random: () => number, longest: number): () => string {
	const CHARS = ["a", "b", "c", "A", "B", "1", "2", " ", "-", "x"];
	return () => {
		const n = Math.floor(random() * (longest + 1));
		let out = "";
		for (let i = 0; i < n; i++) out += CHARS[Math.floor(random() * CHARS.length)];
		return out;
	};
}

/** Run `cases` generated patterns against RegExp and return every disagreement, up to five. */
function disagreementsWithRegExp(seed: number, cases: number, emptyLoops: boolean, longestText: number): string[] {
	const random = mulberry32(seed);
	const nextPattern = patternGenerator(random, emptyLoops);
	const nextText = textGenerator(random, longestText);
	const disagreements: string[] = [];
	for (let i = 0; i < cases && disagreements.length < 5; i++) {
		const source = nextPattern();
		const text = nextText();
		const ignoreCase = source.startsWith("(?i)");
		const native = new RegExp(ignoreCase ? source.slice(4) : source, ignoreCase ? "i" : "");
		const expected = native.exec(text);
		const actual = first(source, text);
		const expectedShape = expected === null ? null : { index: expected.index, groups: Array.from(expected) };
		if (JSON.stringify(actual) !== JSON.stringify(expectedShape)) {
			disagreements.push(`${JSON.stringify(source)} on ${JSON.stringify(text)}: RegExp ${JSON.stringify(expectedShape)}, here ${JSON.stringify(actual)}`);
			continue;
		}
		const nativeCount = Array.from(text.matchAll(new RegExp(native.source, native.flags + "g"))).length;
		const ourCount = count(source, text);
		if (nativeCount !== ourCount) {
			disagreements.push(`${JSON.stringify(source)} on ${JSON.stringify(text)}: RegExp counts ${nativeCount}, here ${ourCount}`);
		}
	}
	return disagreements;
}

describe("agreement with RegExp", () => {
	test("an optional loop pass that matches nothing is refused, as JavaScript refuses it", () => {
		// Each is a pattern where a loop's body can match nothing; JavaScript then
		// tries the body's next way of matching rather than stopping. The
		// expected answers are JavaScript's own, taken from RegExp once and
		// written out, since several of these are backtracking-exponential
		// shapes that should not be run through a native engine in a test.
		const cases: ReadonlyArray<readonly [string, string, (string | undefined)[]]> = [
			["(a|)*b", "aab", ["aab", "a"]],
			["(a*)*", "b", ["", undefined]],
			["(a*)?", "b", ["", undefined]],
			["(a{0,2}?\\w*?)+", "xAA B1", ["xAA", "A"]],
			["(\\w*?)+", "abc", ["abc", "c"]],
			["(?:x*)*y", "xxy", ["xxy"]],
			["(a*)+b", "aab", ["aab", "aa"]],
			["(a*){2,3}", "aaa", ["aaa", ""]],
		];
		for (const [source, text, groups] of cases) {
			expect(first(source, text)).toEqual({ index: 0, groups });
		}
	});

	test("first match, groups and match count agree on 4,000 generated patterns whose loops consume", () => {
		expect(disagreementsWithRegExp(520, 4000, false, 12)).toEqual([]);
	});

	test("and on 4,000 more whose loops may match nothing", () => {
		expect(disagreementsWithRegExp(5200, 4000, true, 7)).toEqual([]);
	});
});
