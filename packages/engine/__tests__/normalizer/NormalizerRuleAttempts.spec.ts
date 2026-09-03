/**
 * Counts the `match()` calls the normalizer makes over a mixed document.
 *
 * The shape index and the first-call type buckets exist to make this number
 * small, and a number is the only honest way to say whether they do. This is
 * a measurement, not a benchmark: it prints the totals and the busiest rules
 * and asserts no exact figure, because an exact count would fail on every rule
 * any package adds. What it does assert is the containment the design
 * promises, which holds however many rules there are: a filtered walk can only
 * ever try a subset of what the exhaustive walk tries.
 *
 * Four walks are counted over the same lines:
 *
 * - `document`: one engine parsing the whole document, which is what a
 *   notepad costs. The first line goes through the cold type buckets and the
 *   rest through the index.
 * - `warm`: one engine normalising each line in turn, the same paths without
 *   the parser or the compiled front-half cache in the way.
 * - `cold`: each line as the first thing a fresh engine ever normalises, the
 *   path a process that evaluates one expression and exits takes.
 * - `exhaustive`: every registered rule at every position, the reference the
 *   other three are filters over.
 */

import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { TokenNormalizer } from "@solve-js/normalizer/TokenNormalizer";
import type { NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import type { Token } from "@solve-js/lexer/Token";
import { newTrackedEngine } from "@tools/trackedEngine";
import { mixedDocument } from "@tools/normalizerCorpus";

const LINES = 200;

/** The engine's registered rules, the objects every walk shares. */
function rulesOf(engine: ExpressionEngine): NormalizerRule[] {
	return (engine.getNormalizer() as unknown as { rules: NormalizerRule[] }).rules;
}

/**
 * Wrap every rule's `match()` so each call is counted against the rule's
 * name. The rule objects are shared with the package descriptors, so the
 * wrapper is removed again by `restore()` once a walk has been measured.
 */
function instrument(rules: NormalizerRule[]): { counts: Map<string, number>; restore(): void } {
	const counts = new Map<string, number>();
	const originals: Array<[NormalizerRule, NormalizerRule["match"]]> = [];
	for (const rule of rules) {
		const original = rule.match;
		originals.push([rule, original]);
		rule.match = function counted(tokens: Token[], pos: number) {
			counts.set(rule.name, (counts.get(rule.name) ?? 0) + 1);
			return original.call(rule, tokens, pos);
		};
	}
	return {
		counts,
		restore() {
			for (const [rule, original] of originals) rule.match = original;
		},
	};
}

/** Lex a line the way `prepareExpression` does, without the comments. */
function lexAll(engine: ExpressionEngine, text: string): Token[] {
	const lexer = engine.getLexer();
	lexer.resetExpression(text);
	const out: Token[] = [];
	for (const t of lexer) if (t.type !== "COMMENT") out.push(t);
	return out;
}

function total(counts: Map<string, number>): number {
	let n = 0;
	for (const c of counts.values()) n += c;
	return n;
}

function busiest(counts: Map<string, number>, top: number): string {
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, top)
		.map(([name, n]) => `${String(n).padStart(7)}  ${name}`)
		.join("\n");
}

describe("normalizer rule attempt counts over a mixed document", () => {
	const lines = mixedDocument(LINES);

	test("every line of the document is distinct", () => {
		expect(new Set(lines).size).toBe(lines.length);
	});

	test("filtered walks attempt a subset of the exhaustive walk", () => {
		const engine = newTrackedEngine();
		const rules = rulesOf(engine);
		let positions = 0;
		for (const line of lines) positions += lexAll(engine, line).length;

		// ── document: parseDocument on a fresh engine ──
		const document = instrument(rules);
		engine.parseDocument(lines.join("\n"));
		document.restore();

		// ── warm: each line normalised in turn on one engine ──
		const warmEngine = newTrackedEngine();
		const warm = instrument(rulesOf(warmEngine));
		for (const line of lines) warmEngine.tokenizeForClassification(line);
		warm.restore();

		// ── cold: each line as a fresh engine's first normalisation ──
		let coldTotal = 0;
		const coldCounts = new Map<string, number>();
		for (const line of lines) {
			const fresh = newTrackedEngine();
			const cold = instrument(rulesOf(fresh));
			fresh.tokenizeForClassification(line);
			cold.restore();
			coldTotal += total(cold.counts);
			for (const [name, n] of cold.counts) coldCounts.set(name, (coldCounts.get(name) ?? 0) + n);
		}

		// ── exhaustive: every rule at every position, the reference ──
		const plain = new TokenNormalizer({ ignoreRuleIndex: true });
		for (const rule of rules) plain.register(rule);
		for (const [phrase, type] of Object.entries(engine.getNormalizer().getPhrases())) plain.addPhrase(phrase, type);
		const exhaustive = instrument(rules);
		for (const line of lines) plain.normalize(lexAll(engine, line));
		exhaustive.restore();

		const documentTotal = total(document.counts);
		const warmTotal = total(warm.counts);
		const exhaustiveTotal = total(exhaustive.counts);

		console.log(
			[
				`RULES=${rules.length} LINES=${lines.length} TOKENS=${positions}`,
				`match() attempts:`,
				`  document   ${String(documentTotal).padStart(8)}  (${(documentTotal / positions).toFixed(2)} per token)`,
				`  warm       ${String(warmTotal).padStart(8)}  (${(warmTotal / positions).toFixed(2)} per token)`,
				`  cold       ${String(coldTotal).padStart(8)}  (${(coldTotal / positions).toFixed(2)} per token)`,
				`  exhaustive ${String(exhaustiveTotal).padStart(8)}  (${(exhaustiveTotal / positions).toFixed(2)} per token)`,
				`busiest rules, warm:`,
				busiest(warm.counts, 10),
				`busiest rules, cold:`,
				busiest(coldCounts, 10),
			].join("\n"),
		);

		expect(positions).toBeGreaterThan(0);
		expect(warmTotal).toBeGreaterThan(0);
		expect(coldTotal).toBeGreaterThan(0);
		expect(warmTotal).toBeLessThanOrEqual(exhaustiveTotal);
		expect(coldTotal).toBeLessThanOrEqual(exhaustiveTotal);
	});
});
