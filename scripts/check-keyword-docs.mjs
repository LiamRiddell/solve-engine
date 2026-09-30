/**
 * Fails when a word or phrase the engine reads appears on no syntax page.
 *
 * A reader finds a form by reading about it, so a name the engine accepts and
 * no page mentions is a feature nobody can find. About twenty working names
 * (`atan2`, `sinh`, `pow`, `vec3`, `as multiplier`) had drifted into that state
 * (#722), and so had 77 multi-word phrases, whole forms among them (`what day
 * is it on`, `compound interest on`, `how much per month to reach`, #831).
 * Nothing noticed, because a page is only proven for what it shows, never for
 * what it leaves out.
 *
 * It builds the engine the way a host does (`createEngine()` from the built
 * package) and collects the names a reader types:
 *
 * - every lexer keyword: the locale's keyword map, which holds the built-in
 *   functions (`sqrt`, `atan2`) and the `as` converter names (`multiplier`),
 *   merged with each package's `lexerVocabulary` keywords;
 * - every phrase the normaliser fuses, the built-in table and each package's
 *   `phrases`;
 * - each package's `callFusions` (the `name(` call words, `linecount`,
 *   `sha256`), `asConverters` (`as base64`, `as roman`) and the labels of its
 *   `completionItems` (the colour functions, `ln`).
 *
 * A name counts as documented when it appears, as a whole word and in any
 * case, on a page under `syntax/`, in prose or in an example. A phrase counts
 * with any run of spaces between its words. The generated unit reference does
 * not count, since a unit spelling that happens to match a keyword there says
 * nothing about the keyword.
 *
 * An alias is documented by saying so beside the name it stands for (`arcsin`
 * beside `asin`), which is one sentence, so the allowlist is not for aliases.
 * A name that should not be on a page yet is set aside in
 * `keyword-docs-allowlist.json`, each entry with its reason: a spelling an open
 * issue proposes to retire, or a form another open change documents. An entry
 * that has become documented, or whose name the engine no longer reads, fails
 * as stale, so the list cannot outlive its reasons.
 *
 * The boundary: it checks that a name is mentioned, not that it is proven,
 * since `DocExamples.spec.ts` already proves what a page shows. A mention is
 * matched as text, so a name that is also an ordinary word (`float`, in "a
 * single-precision float") counts wherever the word appears. Words a
 * package's own normaliser rule fuses (the `map(` and `sum(` call forms of
 * `solve-mapreduce`) are not enumerable from a package's tables and are not
 * checked; nor are `pluginFunctions` names, which are handler names a parselet
 * emits, not words a reader types.
 *
 * Usage:
 *   node scripts/check-keyword-docs.mjs
 *
 * Needs `npm run build` first, since it reads the built engine. For the spec,
 * `--root=<dir>` reads another tree's docs and allowlist, and
 * `--vocabulary=<file>` reads the names from a JSON file (`{ "name": "where
 * it comes from" }`) instead of the engine.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rootArgument = process.argv.find((arg) => arg.startsWith("--root="));
const vocabularyArgument = process.argv.find((arg) => arg.startsWith("--vocabulary="));
const ROOT = rootArgument ? path.resolve(rootArgument.slice("--root=".length)) : path.resolve(HERE, "..");
const SYNTAX = path.join(ROOT, "docs", "src", "content", "docs", "syntax");
const ALLOWLIST = path.join(ROOT, "scripts", "keyword-docs-allowlist.json");
const ENGINE_DIR = path.join(path.resolve(HERE, ".."), "packages", "engine", "dist");

/** Pages under `syntax/` that do not count as documenting a name, with the reason. */
const NOT_COUNTED = new Map([["unit-reference.md", "generated list of unit spellings; a unit named like a keyword there documents the unit, not the keyword"]]);

/**
 * Every name the engine reads, mapped to where it comes from.
 *
 * A `Map` rather than an object, so a name spelled like an inherited property
 * (`constructor`) is a name like any other.
 *
 * @returns {Promise<Map<string, string>>} Name to source.
 */
async function engineVocabulary() {
	const indexFile = path.join(ENGINE_DIR, "index.js");
	const packagesFile = path.join(ENGINE_DIR, "packages.js");
	if (!fs.existsSync(indexFile) || !fs.existsSync(packagesFile)) {
		console.error("packages/engine/dist is missing. Run `npm run build` first.");
		process.exit(1);
	}
	const { createEngine } = await import(pathToFileURL(indexFile).href);
	const { BUILTIN_PACKAGES } = await import(pathToFileURL(packagesFile).href);
	const engine = createEngine();
	const names = new Map();
	const add = (name, source) => {
		const key = String(name).toLowerCase().replace(/\s+/g, " ").trim();
		if (key !== "" && !names.has(key)) names.set(key, source);
	};

	// Package tables first, so a name is reported under the package that owns it.
	for (const pkg of BUILTIN_PACKAGES) {
		for (const word of Object.keys(pkg.lexerVocabulary?.keywords ?? {})) add(word, `${pkg.name} keyword`);
		for (const phrase of Object.keys(pkg.phrases ?? {})) add(phrase, `${pkg.name} phrase`);
		for (const word of Object.keys(pkg.callFusions ?? {})) add(word, `${pkg.name} call word`);
		for (const word of Object.keys(pkg.asConverters ?? {})) add(word, `${pkg.name} as converter`);
		for (const item of pkg.completionItems ?? []) add(item.label, `${pkg.name} completion`);
	}
	for (const [word, type] of Object.entries(engine.getLexer().getKeywords())) {
		add(word, type === "CONVERTER_NAME" ? "core as converter" : type === "FUNC" ? "core function" : "core keyword");
	}
	for (const phrase of Object.keys(engine.getNormalizer().getPhrases())) add(phrase, "core phrase");

	if (names.size < 300) {
		console.error(`Only ${names.size} names were read from the engine; the way this script reads them has drifted from the engine.`);
		process.exit(1);
	}
	return names;
}

/**
 * The names from a JSON file, for the spec's fixtures.
 *
 * @param {string} file - A JSON object of name to source.
 * @returns {Map<string, string>} Name to source.
 */
function fileVocabulary(file) {
	const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	const names = new Map();
	for (const [name, source] of Object.entries(parsed)) names.set(name.toLowerCase().replace(/\s+/g, " ").trim(), String(source));
	return names;
}

/**
 * The allowlist, name to reason. A missing file is an empty list.
 *
 * @returns {Map<string, string>} Name to reason.
 */
function readAllowlist() {
	if (!fs.existsSync(ALLOWLIST)) return new Map();
	const parsed = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8"));
	const entries = new Map();
	for (const [name, reason] of Object.entries(parsed)) {
		if (name.startsWith("$")) continue;
		entries.set(name.toLowerCase(), String(reason));
	}
	return entries;
}

/**
 * The text of every counted syntax page, lower-cased, frontmatter removed and
 * runs of whitespace collapsed to one space, so a phrase wrapped across a line
 * still matches.
 *
 * @returns {string} The pages, joined by a boundary no name can span.
 */
function syntaxText() {
	if (!fs.existsSync(SYNTAX)) return "";
	const parts = [];
	for (const entry of fs.readdirSync(SYNTAX, { withFileTypes: true })) {
		if (!entry.isFile() || !/\.mdx?$/i.test(entry.name) || NOT_COUNTED.has(entry.name)) continue;
		let text = fs.readFileSync(path.join(SYNTAX, entry.name), "utf8").replace(/\r\n?/g, "\n");
		if (text.startsWith("---\n")) {
			const end = text.indexOf("\n---", 4);
			if (end !== -1) text = text.slice(end + 4);
		}
		parts.push(text.toLowerCase().replace(/\s+/g, " "));
	}
	return parts.join("\n\n");
}

/**
 * Whether a name appears in the text as a whole word: not preceded or followed
 * by a letter, digit or underscore. `indexOf` from each occurrence rather than
 * a pattern built from the name, so a name holding pattern syntax (`≈`) is
 * matched as the text it is.
 *
 * @param {string} text - The pages, lower-cased.
 * @param {string} name - The name, lower-cased.
 * @returns {boolean} True when the name is mentioned.
 */
function mentions(text, name) {
	const wordChar = /[\p{L}\p{N}_]/u;
	for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
		const before = at === 0 ? "" : text[at - 1];
		const after = text[at + name.length] ?? "";
		if (!wordChar.test(before) && !wordChar.test(after)) return true;
	}
	return false;
}

const vocabulary = vocabularyArgument ? fileVocabulary(path.resolve(vocabularyArgument.slice("--vocabulary=".length))) : await engineVocabulary();
const allowlist = readAllowlist();
const text = syntaxText();

const missing = [...vocabulary.entries()].filter(([name]) => !allowlist.has(name) && !mentions(text, name)).sort(([a], [b]) => a.localeCompare(b));
const stale = [...allowlist.keys()]
	.filter((name) => !vocabulary.has(name) || mentions(text, name))
	.map((name) => `${name} (${vocabulary.has(name) ? "a syntax page mentions it" : "the engine no longer reads it"})`)
	.sort();

// The report is written in one call and the exit code set rather than
// `process.exit()` called, since an exit can cut off output still queued for a
// pipe, and a list of several hundred names is long enough to be cut.
const report = [];
if (missing.length > 0) {
	report.push(`These ${missing.length} name(s) the engine reads appear on no syntax page:`);
	for (const [name, source] of missing) report.push(`  ${name}  (${source})`);
	report.push(
		"Document each on its area's page under docs/src/content/docs/syntax/ (an alias in a sentence beside the name it stands for), or, for a name that should not be documented yet, add it to scripts/keyword-docs-allowlist.json with the reason.",
	);
}
if (stale.length > 0) {
	report.push("These entries in scripts/keyword-docs-allowlist.json are stale:");
	for (const entry of stale) report.push(`  ${entry}`);
	report.push("Remove an entry once a page mentions its name, or once the engine no longer reads it.");
}

if (report.length === 0) {
	const words = [...vocabulary.keys()].filter((name) => !name.includes(" ")).length;
	console.log(`Every name the engine reads is on a syntax page: ${words} word(s) and ${vocabulary.size - words} phrase(s), ${allowlist.size} set aside in scripts/keyword-docs-allowlist.json.`);
} else {
	process.stderr.write(`${report.join("\n")}\n`);
	process.exitCode = 1;
}
