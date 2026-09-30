import { describe, expect, test } from "@jest/globals";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import { RuleIndex, effectiveShape } from "@solve-js/normalizer/RuleIndex";
import { checkLineNormalizerRule } from "@solve-js/packages/conditionals/normalizer/CheckNormalizerRules";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";

/**
 * Issue #767: the normaliser tries a rule only at positions its declared shape
 * admits, and `conditionals:check` declared any identifier, although it only
 * ever matches the word `check` at the start of a line. It was tried at every
 * word of prose: 1,484 `match()` calls over one 1,000-line document for 100
 * matches. Its first slot now names the word, and the same document costs 106
 * calls. No line reads differently.
 *
 * The two datetime rules the issue names as optional work (`month-name-date`
 * and `between-unit`) are left as they are: splitting them only helps a cold
 * evaluation, and the same cold `parseDocument` of 1,000 lines measured 35.7
 * ms before and 32.9 ms after this change, inside this machine's noise, with
 * their calls unchanged. See the changeset.
 */

/** Lex a line as the engine does before normalising. */
function lexAll(engine: ExpressionEngine, text: string): Token[] {
	const lexer = engine.getLexer();
	lexer.resetExpression(text);
	const out: Token[] = [];
	for (const t of lexer) if (t.type !== "COMMENT") out.push(t);
	return out;
}

/** The engine's registered rules, highest priority first, as the index is built from them. */
function rulesOf(engine: ExpressionEngine): NormalizerRule[] {
	return [...(engine.getNormalizer() as unknown as { rules: NormalizerRule[] }).rules].sort((a, b) => b.priority - a.priority);
}

/** Whether the index admits rule `i` of `rules` at `pos` of `tokens`. */
function admitted(index: RuleIndex, tokens: Token[], pos: number, i: number): boolean {
	const mask = index.candidates(tokens, pos);
	return (mask[(i / 32) | 0] & (1 << (i % 32))) !== 0;
}

/** Every line's answer, as a reader sees it. */
function answers(text: string): string[] {
	return newTrackedEngine().parseDocument(text).lines.map((l) => (l.result === null ? (l.error === null ? "" : "ERROR") : formatValue(l.result)));
}

describe("the declared shape", () => {
	test("names the word, not only the token type", () => {
		expect(effectiveShape(checkLineNormalizerRule())).toEqual([{ types: ["IDENT"], values: ["check"] }]);
	});

	test("the index offers the rule at `check` in any case, and at no other word", () => {
		const engine = newTrackedEngine();
		const rules = rulesOf(engine);
		const index = new RuleIndex(rules);
		const at = rules.findIndex((r) => r.name === "conditionals:check");
		expect(at).toBeGreaterThanOrEqual(0);
		for (const line of ["check 2 + 2 == 4", "CHECK 2 + 2 == 4", "Check 10 > 5"]) {
			expect({ line, admitted: admitted(index, lexAll(engine, line), 0, at) }).toEqual({ line, admitted: true });
		}
		const prose = lexAll(engine, "Remember to verify these figures against the sheet");
		for (let pos = 0; pos < prose.length; pos++) expect(admitted(index, prose, pos, at)).toBe(false);
	});

	test("over a document of prose and checks, match() is called only where a check stands", () => {
		const engine = newTrackedEngine();
		// The normaliser's first call walks type buckets rather than the shape
		// index (see TokenNormalizer.normalize), so one line warms it first.
		engine.evaluateExpression("1 + 1");
		const rule = (engine.getNormalizer() as unknown as { rules: NormalizerRule[] }).rules.find((r) => r.name === "conditionals:check")!;
		const inner = rule.match.bind(rule);
		let calls = 0;
		(rule as { match: NormalizerRule["match"] }).match = (tokens, pos) => {
			calls++;
			return inner(tokens, pos);
		};
		const lines: string[] = [];
		for (let i = 0; i < 50; i++) lines.push(`Notes on item ${i} from the planning session`, `check ${i} + 1 == ${i + 1}`);
		const result = engine.parseDocument(lines.join("\n"));
		expect(result.checks).toEqual({ passed: 50, failed: 0 });
		// Fifty checks, one call each; the prose words cost nothing. Before the
		// shape named the word, every identifier of every line was a call.
		expect(calls).toBe(50);
	});

	test("a document of prose alone never calls it", () => {
		const engine = newTrackedEngine();
		// The normaliser's first call walks type buckets rather than the shape
		// index (see TokenNormalizer.normalize), so one line warms it first.
		engine.evaluateExpression("1 + 1");
		const rule = (engine.getNormalizer() as unknown as { rules: NormalizerRule[] }).rules.find((r) => r.name === "conditionals:check")!;
		const inner = rule.match.bind(rule);
		let calls = 0;
		(rule as { match: NormalizerRule["match"] }).match = (tokens, pos) => {
			calls++;
			return inner(tokens, pos);
		};
		engine.parseDocument(Array.from({ length: 40 }, (_, i) => `Remember to verify figure number ${i} against the finance sheet`).join("\n"));
		expect(calls).toBe(0);
	});
});

describe("the rule itself (unit)", () => {
	const engine = newTrackedEngine();
	const rule = checkLineNormalizerRule();
	const match = (line: string, pos = 0) => rule.match(lexAll(engine, line), pos);

	test("ordinary: fuses `check` before a comparison, in any case", () => {
		for (const line of ["check 2 + 2 == 4", "CHECK 1 < 2", "Check 3 >= 3", "check x != 4", "check 0.1 + 0.2 ≈ 0.3"]) {
			const m = match(line);
			expect({ line, type: m?.replacement[0].type, consumed: m?.consumed }).toEqual({ line, type: "CHECK", consumed: 1 });
		}
	});

	test("boundary: not past position 0, and not without a comparison", () => {
		expect(match("check 2 + 2 == 4", 1)).toBeNull();
		expect(match("check")).toBeNull();
		expect(match("check = 80")).toBeNull();
		expect(match("check + 1")).toBeNull();
		expect(match("15% of check")).toBeNull();
	});

	test("hostile: other words, prototype words, an empty stream and a position past the end", () => {
		for (const word of ["checks", "checked", "chec", "ch eck", ...PROTOTYPE_WORDS]) {
			expect({ word, m: match(`${word} 2 == 2`) }).toEqual({ word, m: null });
		}
		expect(rule.match([], 0)).toBeNull();
		expect(rule.match(lexAll(engine, "check 1 == 1"), 99)).toBeNull();
	});
});

describe("what a reader sees is unchanged", () => {
	test("`check` stays a variable where it is one, and a check line still passes", () => {
		expect(answers("check = $80\n15% of check")).toEqual(["= $80.00", "= $12.00"]);
		const checked = newTrackedEngine().parseDocument("CHECK 2 + 2 == 4");
		expect(checked.checks).toEqual({ passed: 1, failed: 0 });
	});

	test("both passes agree on a note mixing the two readings", () => {
		const text = "check = 80\ncheck * 2\ncheck 2 + 2 == 4\nCheck check == 80\nRemember to check the total";
		const batch = answers(text);
		const incremental = evaluateDocument(newTrackedEngine(), text).lines.map((l) => (l.result === null ? (l.error === null ? "" : "ERROR") : formatValue(l.result)));
		expect(batch.slice(0, 2)).toEqual(["= 80", "= 160"]);
		expect(batch.slice(0, 4)).toEqual(incremental.slice(0, 4));
		expectHonestDocument(text);
	});
});

describe("adversarial: security", () => {
	test("prototype words beside `check` read as names and leave Object.prototype alone", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("check X == 1", PROTOTYPE_WORDS)) expectHonestLine(line);
			for (const line of fill("X = check", PROTOTYPE_WORDS)) expectHonestLine(line);
		});
	});

	test("look-alike, markup-shaped and oversized lines around the word", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`check ${edge} == 1`);
		// A Cyrillic "с" is not the word, so the line is not a check.
		expect(newTrackedEngine().parseDocument("сheck 2 == 2").checks).toBeUndefined();
		expectHonestLine(`check ${"1 + ".repeat(2_000)}1 == 2001`, { budgetMs: 5_000 });
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo, a check over a value from the line above, and a failing check", () => {
		const result = newTrackedEngine().parseDocument("price = 40\nchekc price == 40\ncheck price * 2 == 80\ncheck price > 100");
		expect(result.checks).toEqual({ passed: 1, failed: 1 });
		expectHonestDocument("price = 40\nchekc price == 40\ncheck price * 2 == 80\ncheck price > 100");
	});
});

describe("adversarial: edge cases", () => {
	test("a check over the numeric edges answers honestly", () => {
		for (const line of fill("check X == X", ["0", "-0", "2^53", "1e308", "1e-320", "0.1 + 0.2"])) expectHonestLine(line);
	});

	test("CRLF, a trailing newline and blank lines around a check", () => {
		expect(newTrackedEngine().parseDocument("\r\ncheck 1 == 1\r\n\n").checks).toEqual({ passed: 1, failed: 0 });
	});
});
