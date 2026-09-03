/**
 * Proves every rule hint is at least as wide as the rule it describes, over
 * everything the documentation and the normalizer specs say.
 *
 * A hint (`shape`, or the older `startTokenTypes`) lets the normalizer skip a
 * rule at positions it could not match. The hazard runs one way: a hint that
 * admits more than the rule costs a `match()` returning null, a hint that
 * admits less makes the rule unreachable at the positions left out, and
 * nothing announces that. `NormalizerIndexFidelity.spec` checks the
 * declarations against a hand-kept corpus; this spec checks the three walks
 * the normalizer can take against each other over a far larger one:
 *
 * - every proven example in the docs (the ```solve and ```solve-doc fences),
 * - the shared normalizer corpus,
 * - every string literal in the normalizer specs, which is where a spelling
 *   with no documentation page lives.
 *
 * For each line, the indexed walk (what a warm engine does), the first-call
 * walk (what a fresh engine does for its first expression) and the exhaustive
 * walk (every rule at every position) must produce the same token stream. A
 * second test localises any difference to the rule whose declaration caused
 * it, by running every rule unfiltered at every position and asserting the
 * index admits each position it really matches.
 */

import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { TokenNormalizer } from "@solve-js/normalizer/TokenNormalizer";
import { RuleIndex, effectiveShape } from "@solve-js/normalizer/RuleIndex";
import type { NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import type { Token } from "@solve-js/lexer/Token";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NORMALIZER_CORPUS, mixedDocument } from "@tools/normalizerCorpus";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs/src/content/docs");
const TESTS_ROOT = path.join(REPO_ROOT, "packages/engine/__tests__");
const EXTRA_DOCS = [path.join(REPO_ROOT, "README.md")];

/** Every `.ts`/`.md`/`.mdx` file under a directory, recursively. */
function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, keep, out);
		else if (keep(entry.name)) out.push(full);
	}
	return out;
}

/**
 * Every expression inside a ```solve or ```solve-doc fence.
 *
 * The fence rules mirror `tools/docExampleCorpus.mjs` and
 * `DocExamples.spec.ts`: the expression is everything left of the last `//`,
 * and a blank line is a separator rather than an input. Table rows and
 * headings inside a whole-document block are kept, since the engine sees
 * them too and the normalizer must treat them the same whichever walk it
 * takes.
 */
function collectDocLines(files: string[]): string[] {
	const out: string[] = [];
	for (const file of files) {
		let inBlock = false;
		for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
			const text = raw.trim();
			const fence = text.match(/^```(\S*)/);
			if (fence) {
				if (!inBlock && (fence[1] === "solve" || fence[1] === "solve-doc")) inBlock = true;
				else if (inBlock && fence[1] === "") inBlock = false;
				continue;
			}
			if (!inBlock || text === "") continue;
			const marker = text.lastIndexOf("//");
			const expression = (marker === -1 ? text : text.slice(0, marker)).trim();
			if (expression !== "") out.push(expression);
		}
	}
	return out;
}

/**
 * Every string literal in the normalizer specs.
 *
 * Coarse on purpose: an import path or a rule name harvested alongside the
 * real inputs is a harmless extra line, whereas a spelling missed because the
 * filter was clever is exactly the gap this corpus exists to close.
 */
function harvestSpecLiterals(files: string[]): string[] {
	const out = new Set<string>();
	const literal = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g;
	for (const file of files) {
		const source = fs.readFileSync(file, "utf8");
		for (const m of source.matchAll(literal)) {
			const raw = m[1] ?? m[2];
			if (raw === undefined) continue;
			const text = raw.replace(/\\(["'\\])/g, "$1").trim();
			if (text.length >= 2) out.add(text);
		}
	}
	return [...out];
}

/** Lex a line the way `prepareExpression` does, or null when it cannot lex. */
function lexAll(engine: ExpressionEngine, text: string): Token[] | null {
	const lexer = engine.getLexer();
	try {
		lexer.resetExpression(text);
		const out: Token[] = [];
		for (const t of lexer) if (t.type !== "COMMENT") out.push(t);
		return out;
	} catch {
		return null;
	}
}

/** A stream, or the error normalising it raised, as comparable strings. */
function outcome(normalizer: TokenNormalizer, tokens: Token[]): string[] {
	try {
		return normalizer.normalize(tokens).map((t) => `${t.type}:${t.value}@${t.offset}`);
	} catch (error) {
		return [`throw:${(error as Error).message}`];
	}
}

/** Whether `mask` has the bit for rule index `i` set. */
function admits(mask: Uint32Array, i: number): boolean {
	return (mask[(i / 32) | 0] & (1 << (i % 32))) !== 0;
}

describe("rule hints are never narrower than the rules they describe", () => {
	const engine = newTrackedEngine();
	const rules: NormalizerRule[] = [...(engine.getNormalizer() as unknown as { rules: NormalizerRule[] }).rules]
		.sort((a, b) => b.priority - a.priority);
	const phrases = Object.entries(engine.getNormalizer().getPhrases());

	const build = (options: { ignoreRuleIndex?: boolean } = {}): TokenNormalizer => {
		const normalizer = new TokenNormalizer(options);
		for (const rule of rules) normalizer.register(rule);
		for (const [phrase, type] of phrases) normalizer.addPhrase(phrase, type);
		return normalizer;
	};

	const specFiles = walk(TESTS_ROOT, (name) => /normaliz/i.test(name) && name.endsWith(".spec.ts"))
		.filter((file) => path.basename(file) !== path.basename(__filename));
	const docFiles = [...walk(DOCS_ROOT, (name) => /\.mdx?$/.test(name)), ...EXTRA_DOCS.filter((f) => fs.existsSync(f))];

	const corpus = [
		...new Set([
			...collectDocLines(docFiles),
			...NORMALIZER_CORPUS,
			...mixedDocument(200),
			...harvestSpecLiterals(specFiles),
		]),
	];

	// Lexed once per walk rather than shared: a fusion that re-emits one of
	// its source tokens stamps `sourceEnd` on it, and a rule reads that field
	// to refuse an already-fused run, so a stream handed to a second walk
	// would not be the stream the first one saw.
	const lines = corpus.filter((text) => {
		const tokens = lexAll(engine, text);
		return tokens !== null && tokens.length > 0;
	});

	test("the corpus is large enough to mean something", () => {
		console.log(
			`HINT CORPUS: ${lines.length} lines from ${docFiles.length} doc files, ` +
			`${specFiles.length} spec files, the shared corpus and a 200-line mixed document`,
		);
		expect(docFiles.length).toBeGreaterThan(10);
		expect(specFiles.length).toBeGreaterThan(3);
		expect(lines.length).toBeGreaterThan(500);
	});

	test("the indexed, first-call and exhaustive walks agree token for token", () => {
		const indexed = build();
		// The index is built on the second call, so spend the first on a line
		// that fuses nothing.
		indexed.normalize(lexAll(engine, "1 + 1")!);
		const exhaustive = build({ ignoreRuleIndex: true });

		const differences: Array<{ text: string; walk: string; got: string[]; expected: string[] }> = [];
		for (const text of lines) {
			const expected = outcome(exhaustive, lexAll(engine, text)!);
			const warm = outcome(indexed, lexAll(engine, text)!);
			// A fresh normalizer per line, so every line is somebody's first call.
			const cold = outcome(build(), lexAll(engine, text)!);
			if (warm.join("\n") !== expected.join("\n")) differences.push({ text, walk: "indexed", got: warm, expected });
			if (cold.join("\n") !== expected.join("\n")) differences.push({ text, walk: "first-call", got: cold, expected });
		}
		expect(differences).toEqual([]);
	});

	test("every position a rule really matches is admitted by its declared hint", () => {
		const index = new RuleIndex(rules);
		const violations: string[] = [];

		for (const text of lines) {
			const tokens = lexAll(engine, text)!;
			for (let pos = 0; pos < tokens.length; pos++) {
				// Copy: candidates() reuses one scratch buffer.
				const mask = Uint32Array.from(index.candidates(tokens, pos));
				const firstSlot = tokens[pos].type;

				for (let i = 0; i < rules.length; i++) {
					const rule = rules[i];
					let matched = false;
					try {
						matched = rule.match(tokens, pos) !== null;
					} catch {
						// A rule that throws on a shape it refuses cannot match
						// there either way.
						matched = false;
					}
					if (!matched) continue;

					const shape = effectiveShape(rule);
					const first = shape[0];
					const bucketed = first?.types === undefined || first.types.includes(firstSlot);
					if (!admits(mask, i) || !bucketed) {
						violations.push(
							`${rule.name} matches "${text}" at ${pos} (${firstSlot} "${tokens[pos].value}") ` +
							`but its hint ${JSON.stringify(shape)} excludes that position`,
						);
					}
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
