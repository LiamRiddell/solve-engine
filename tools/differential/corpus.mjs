/**
 * Assembles the differential corpus: every expression we can find, from
 * sources that were not written by one person imagining what to test.
 *
 * The point of a differential run is to catch a behaviour change nobody
 * thought to assert. That only works if the input set is wider than the
 * assertions, so this pulls from four independent places:
 *
 * - the documented examples, which are what a reader is promised,
 * - every string literal in the test suite, prose and all, because a literal
 *   somebody wrote down is a shape somebody cared about,
 * - the recorded fuzz corpus, which is the set of inputs that once broke
 *   something,
 * - fresh grammar-aware fuzz output, seeded, which is the only source here
 *   that nobody curated.
 *
 * Everything is deduplicated by exact source text and tagged with where it
 * came from, so a difference can be traced back to a file.
 *
 * @module differential/corpus
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { collectExamples } from "../docExampleCorpus.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const ENGINE = path.join(ROOT, "packages", "engine");

/** Longest source we will feed either engine. The length gate is 2000; a little past it exercises the refusal. */
const MAX_SOURCE = 2400;

/**
 * Whether a string literal lifted out of a test file is worth running.
 *
 * Deliberately permissive. Prose like "should add two numbers" is kept,
 * because the two engines disagreeing about how to fail on prose is exactly
 * the kind of unintended change this run exists to find. Only things that
 * are obviously a module path or a filename are dropped, since those add
 * thousands of near-identical inputs and no signal.
 */
function looksRunnable(text) {
	if (text.length === 0 || text.length > MAX_SOURCE) return false;
	if (/[\r\n]/.test(text)) return false;
	if (/^\s*$/.test(text)) return false;
	if (/^(@solve-js|@tools|@jest)\//.test(text)) return false;
	if (/^\.{1,2}\//.test(text)) return false;
	if (/\.(ts|tsx|js|mjs|cjs|json|md|mdx|snap)$/.test(text)) return false;
	return true;
}

/** Walks a directory, yielding every file whose name matches. */
function walk(dir, test, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, test, out);
		else if (test(entry.name)) out.push(full);
	}
	return out;
}

/**
 * Every single-line string literal in a TypeScript source file.
 *
 * A real parse would be more correct, and would also mean carrying a parser
 * around for a job where a false positive costs one wasted evaluation. The
 * regex reads the three quote forms with their escapes, and template literals
 * carrying a substitution are skipped because the text between the braces is
 * not what any engine would ever see.
 */
function stringLiterals(source) {
	const out = [];
	const pattern = /"((?:[^"\\\r\n]|\\.)*)"|'((?:[^'\\\r\n]|\\.)*)'|`((?:[^`\\\r\n]|\\.)*)`/g;
	let match;
	while ((match = pattern.exec(source)) !== null) {
		const raw = match[1] ?? match[2] ?? match[3];
		if (raw === undefined) continue;
		if (raw.includes("${")) continue;
		let decoded;
		try {
			// The literal is re-read as JSON so `\n`, `é` and `\\` mean here
			// what they meant in the file. A literal that will not round-trip
			// (an odd escape) is skipped rather than guessed at.
			decoded = JSON.parse(`"${raw.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"')}"`);
		} catch {
			continue;
		}
		out.push(decoded);
	}
	return out;
}

/** The documented examples, which are the promises a reader reads. */
function fromDocs() {
	const examples = collectExamples(path.join(ROOT, "docs", "src", "content", "docs"), [
		path.join(ROOT, "README.md"),
	]);
	const out = [];
	for (const example of examples) {
		if (example.expression === "") continue;
		if (!looksRunnable(example.expression)) continue;
		out.push({ source: example.expression, origin: `docs:${path.relative(ROOT, example.file)}:${example.line}` });
	}
	return out;
}

/** Every literal in the test suite, including the Soulver parity rows. */
function fromTests() {
	const out = [];
	for (const file of walk(path.join(ENGINE, "__tests__"), (name) => /\.tsx?$/.test(name))) {
		const relative = path.relative(ROOT, file);
		const text = fs.readFileSync(file, "utf8");
		for (const literal of stringLiterals(text)) {
			if (!looksRunnable(literal)) continue;
			out.push({ source: literal, origin: `test:${relative}` });
		}
	}
	return out;
}

/** The recorded fuzz reproducers, which are the inputs that already broke something once. */
function fromFuzzCorpus() {
	const out = [];
	for (const file of walk(path.join(ENGINE, "__tests__", "fuzz", "corpus"), (name) => name.endsWith(".json"))) {
		let entry;
		try {
			entry = JSON.parse(fs.readFileSync(file, "utf8"));
		} catch {
			continue;
		}
		const candidates = [entry?.input?.source, entry?.input?.origin, entry?.source];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && looksRunnable(candidate)) {
				out.push({ source: candidate, origin: `fuzz-corpus:${path.basename(file)}` });
			}
		}
	}
	return out;
}

/** The generated expressions, produced by a separate bundled process and read back here. */
function fromGenerated(generatedFile) {
	if (generatedFile === null || !fs.existsSync(generatedFile)) return [];
	const lines = fs.readFileSync(generatedFile, "utf8").split(/\r?\n/);
	const out = [];
	for (const line of lines) {
		if (line === "") continue;
		const parsed = JSON.parse(line);
		if (!looksRunnable(parsed.source)) continue;
		out.push({ source: parsed.source, origin: `fuzz-seed:${parsed.seed}` });
	}
	return out;
}

/**
 * The whole corpus, deduplicated, in a stable order.
 *
 * Order is stable because both sides index into the same array and the runner
 * resumes by index after a crash, so a corpus that shuffled between processes
 * would silently compare different expressions to each other.
 *
 * @param {string | null} generatedFile - JSONL of generated expressions, or null.
 * @returns {{ source: string, origin: string }[]}
 */
export function buildCorpus(generatedFile = null) {
	const seen = new Map();
	const add = (entries) => {
		for (const entry of entries) {
			if (seen.has(entry.source)) continue;
			seen.set(entry.source, entry);
		}
	};
	add(fromDocs());
	add(fromTests());
	add(fromFuzzCorpus());
	add(fromGenerated(generatedFile));
	return [...seen.values()];
}
