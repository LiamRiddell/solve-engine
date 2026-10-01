/**
 * The rules the dates batch (#704) added or widened turn a position away with
 * a cheap test before an expensive one.
 *
 * The benchmark gate measured the normaliser suite at 1.56 times its merge
 * base on the batch, the lines where no rule fires included (`12 + 34 * (56 -
 * 7) / 8` at about three times). Profiled, the step was three helpers tried at
 * almost every token:
 *
 * - the nth-weekday rule, whose first slot gained IDENT and UNIT for the word
 *   ordinals (`first Monday of`), lower-cased every word of a line and then
 *   asked `Object.prototype.hasOwnProperty.call`, which reads the global
 *   `Object` (slow inside a `vm` context), even at a number before an operator;
 * - `monthOf`, read by the month-name date rule at every number and word, gained
 *   the same own-key guard;
 * - the `ago` rule lower-cased the token after every number and unit pair.
 *
 * Each now asks the cheap question first: the nth-weekday rule declares a
 * second slot (the weekday, or an ordinal's suffix) and tests for the weekday
 * before it reads the word, the tables are `Map`s, and `ago` is tested by
 * length first. The answers are the ones the rules gave before; this spec
 * proves the parts directly, the index's new filter, and the engine's answers
 * through the hostile corpora.
 */

import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { RuleIndex, isEmptyMask } from "@solve-js/normalizer/RuleIndex";
import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import { nthWeekdayNormalizerRule } from "@solve-js/packages/datetime/normalizer/NthWeekdayNormalizerRule";
import { monthOf } from "@solve-js/packages/datetime/normalizer/MonthNameDateNormalizerRule";
import { agoNormalizerRule, periodOf } from "@solve-js/packages/datetime/normalizer/SpokenDateRules";

const SRC = path.resolve(__dirname, "../../src/packages/datetime/normalizer");

/** The tokens the engine's lexer makes for a line, comments dropped, as `prepareExpression` does. */
function lex(line: string): Token[] {
	const lexer = newTrackedEngine().getLexer();
	lexer.resetExpression(line);
	const tokens: Token[] = [];
	for (const t of lexer) if (t.type !== "COMMENT") tokens.push(t);
	return tokens;
}

/** What a rule answers at `pos`, through its own shape index as the normaliser offers it. */
function attempt(rule: NormalizerRule, tokens: Token[], pos: number): string | null {
	if (isEmptyMask(new RuleIndex([rule]).candidates(tokens, pos))) return null;
	const match = rule.match(tokens, pos);
	return match === null ? null : match.replacement.map((t) => `${t.type}:${t.value}`).join(" ");
}

/** The calendar date a line reads as, as a local Y-M-D triple. */
function ymd(source: string): [number, number, number] {
	const d = new Date(newTrackedEngine().evaluateExpression(source).toNumber());
	return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

describe("the hot helpers read no global", () => {
	test.each(["NthWeekdayNormalizerRule.ts", "MonthNameDateNormalizerRule.ts", "SpokenDateRules.ts"])("%s has no hasOwnProperty guard", (file) => {
		// A Map guards own keys without reading `Object`; the guard this replaces
		// cost the whole normaliser suite half its speed in the benchmark harness.
		expect(fs.readFileSync(path.join(SRC, file), "utf8")).not.toMatch(/Object\.prototype\.hasOwnProperty\.call\(/);
	});
});

describe("nthWeekdayNormalizerRule", () => {
	const rule = nthWeekdayNormalizerRule();

	test("declares a second slot, so a number before an operator is never offered", () => {
		expect(rule.shape).toHaveLength(2);
		const tokens = lex("12 + 34 * (56 - 7) / 8");
		for (let pos = 0; pos < tokens.length; pos++) {
			expect(isEmptyMask(new RuleIndex([rule]).candidates(tokens, pos))).toBe(true);
		}
	});

	test.each([
		["first Monday of March 2026", "NTH_WEEKDAY:1:1"],
		["FIRST Monday of March 2026", "NTH_WEEKDAY:1:1"],
		["Fifth friday of next month", "NTH_WEEKDAY:5:5"],
		["third SUNDAY of May", "NTH_WEEKDAY:3:0"],
		["second Tuesday of March", "NTH_WEEKDAY:2:2"],
		["last Friday of November 2026", "NTH_WEEKDAY:last:5"],
		["2nd Tuesday of March 2026", "NTH_WEEKDAY:2:2"],
		["1st Monday of March", "NTH_WEEKDAY:1:1"],
		["3RD wednesday of June", "NTH_WEEKDAY:3:3"],
		["4th Thursday of November", "NTH_WEEKDAY:4:4"],
	])("%s fuses at its first token", (line, fused) => {
		expect(attempt(rule, lex(line), 0)).toBe(fused);
	});

	test.each([
		"first Monday",
		"first of March",
		"sixth Monday of March",
		"first month of March",
		"2 nd Tuesday of March",
		"2nd of March",
		"first",
		"",
		"The quarterly report covers revenue and cost",
	])("%s does not fuse at any position", (line) => {
		const tokens = lex(line);
		for (let pos = 0; pos < tokens.length; pos++) expect(attempt(rule, tokens, pos)).toBeNull();
	});

	test.each(PROTOTYPE_WORDS)("%s before a weekday is no ordinal", (word) => {
		expectPrototypeUntouched(() => {
			expect(attempt(rule, lex(`${word} Monday of March`), 0)).toBeNull();
		});
	});
});

describe("monthOf", () => {
	test.each([
		["March", 3], ["march", 3], ["MARCH", 3], ["sept", 9], ["Dec", 12], ["may", 5],
	])("%s is month %d", (word, month) => {
		expect(monthOf(lex(`5 ${word}`)[1])).toBe(month);
	});

	test.each([...PROTOTYPE_WORDS, "marc", "marchh", "word"])("%s is no month", (word) => {
		expectPrototypeUntouched(() => {
			const tokens = lex(`5 ${word}`);
			expect(monthOf(tokens[1], tokens[0])).toBe(0);
		});
	});

	test("a missing token or a number is no month", () => {
		expect(monthOf(undefined)).toBe(0);
		expect(monthOf(lex("12")[0])).toBe(0);
	});
});

describe("periodOf", () => {
	test.each([["week", "week"], ["Month", "month"], ["YEAR", "year"]])("%s is the current %s", (word, kind) => {
		expect(periodOf(lex(`end of ${word}`)[2])).toEqual({ kind, offset: 0 });
	});

	test.each(PROTOTYPE_WORDS)("%s is no period", (word) => {
		expectPrototypeUntouched(() => {
			expect(periodOf(lex(`end of ${word}`)[2])).toBeNull();
		});
	});

	test("a missing token is no period", () => {
		expect(periodOf(undefined)).toBeNull();
	});
});

describe("agoNormalizerRule", () => {
	const rule = agoNormalizerRule();

	test.each(["3 days ago", "3 days AGO", "2 hours Ago", "10 minutes agO"])("%s reads as a length before now", (line) => {
		expect(attempt(rule, lex(line), 0)).toMatch(/^NUMBER:\d+ DATE_OFFSET_BEFORE:\S+ NOW:now$/);
	});

	test.each(["3 days agoo", "3 days ag", "5 kg ago", "3 days", "3 days before", "120 km/h to m/s", "3 days ÄGO"])("%s is not `ago`", (line) => {
		expect(attempt(rule, lex(line), 0)).toBeNull();
	});
});

describe("through the engine", () => {
	test("a word ordinal in any case is the same date", () => {
		expect(ymd("FIRST Monday of March 2026")).toEqual([2026, 3, 2]);
		expect(ymd("first Monday of March 2026")).toEqual([2026, 3, 2]);
		expect(ymd("2nd Tuesday of March 2026")).toEqual([2026, 3, 10]);
	});

	test.each([
		...fill("X Monday of March 2026", PROTOTYPE_WORDS),
		...fill("5 X 2026", PROTOTYPE_WORDS),
		...fill("start of X", PROTOTYPE_WORDS),
		...fill("3 days X", PROTOTYPE_WORDS),
		...fill("X Monday of March 2026", TEXT_EDGES),
	])("%s answers honestly", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});
});
