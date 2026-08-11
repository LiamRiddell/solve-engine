/**
 * Emits a deterministic batch of grammar-aware expressions.
 *
 * Bundled by `run.mjs` with esbuild, because it reaches into the engine's
 * TypeScript through the same `@solve-js/*` and `@tools/*` aliases Jest maps.
 * It is a separate process for the ordinary reason: it builds a live engine to
 * read the vocabulary off, and that engine has no business being in the process
 * that later compares two different builds of the same engine.
 *
 * The output is JSONL, one `{ seed, source }` per line, so a difference found
 * months from now still names the seed that produced it.
 */

import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { buildVocabulary } from "@tools/fuzz/Vocabulary";
import { generateExpressionCase } from "@tools/fuzz/ExpressionFuzzer";
import * as fs from "node:fs";

const args = new Map();
for (const arg of process.argv.slice(2)) {
	const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
	if (match) args.set(match[1], match[2] ?? "true");
}

const seed = Number(args.get("seed") ?? 20260811);
const count = Number(args.get("count") ?? 30000);
const out = args.get("out");

const engine = new ExpressionEngine("en");
const vocabulary = buildVocabulary(engine);
engine.clear();

const lines = [];
for (let i = 0; i < count; i++) {
	// Three shapes per cycle: short and shallow, the generator's own defaults,
	// and deep. One profile would explore one corner of the grammar well and
	// the rest not at all.
	const profile = i % 3;
	const options =
		profile === 0
			? { maxDepth: 4, maxLength: 60 }
			: profile === 1
				? { maxDepth: 8, maxLength: 400 }
				: { maxDepth: 12, maxLength: 200 };
	const caseSeed = seed + i * 7919;
	const generated = generateExpressionCase(caseSeed, vocabulary, options);
	lines.push(JSON.stringify({ seed: caseSeed, source: generated.source }));
}

fs.writeFileSync(out, `${lines.join("\n")}\n`);
process.stdout.write(`generated ${lines.length}\n`);
