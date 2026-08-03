/**
 * Checks source comments against the house style.
 *
 * Node rather than grep, because the grep version of this check was silently
 * broken. `grep -P '\xe2\x80\x94'` exits 2 on a locale it cannot handle, and
 * `if grep ...` reads exit 2 the same as "no match", so the gate passed on
 * every file including ones with hundreds of violations. A style gate that
 * cannot fail is worse than no gate: it produces confidence rather than
 * information.
 *
 * Usage:
 *   node scripts/check-comment-style.mjs <path...>     check these files
 *   node scripts/check-comment-style.mjs --all         check all engine source
 *   node scripts/check-comment-style.mjs --count       report, do not fail
 */

import * as fs from "node:fs";
import * as path from "node:path";

const RULES = [
	{
		name: "em-dash",
		pattern: /—/g,
		message: "Em-dash. Use a comma, a colon, parentheses, or a second sentence.",
	},
	{
		name: "emoji",
		// The pictographic blocks. Deliberately not matching every symbol range:
		// arrows and box-drawing characters are used in comment diagrams here and
		// are not what the rule is about.
		pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
		message: "Emoji in source. Say it in words.",
	},
];

const args = process.argv.slice(2);
const countOnly = args.includes("--count");
const all = args.includes("--all");
const explicit = args.filter((a) => !a.startsWith("--"));

/** Every .ts file under a directory. */
function walk(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (full.endsWith(".ts")) out.push(full);
	}
	return out;
}

const files = all
	? walk("packages/engine/src")
	: explicit.filter((f) => fs.existsSync(f) && /\.(ts|tsx|mjs|cjs|js)$/.test(f));

let violations = 0;
const perFile = [];

for (const file of files) {
	const source = fs.readFileSync(file, "utf8");
	const lines = source.split(/\r?\n/);
	let fileCount = 0;

	// Track block-comment state so the rules apply to comments rather than to
	// string literals. The diagnostic panel passes emoji icons as data, and
	// those are rendered in the playground. A rule that demanded removing
	// working UI would be ignored, correctly.
	let inBlockComment = false;

	lines.forEach((line, i) => {
		const trimmed = line.trim();
		const opensBlock = line.includes("/*");
		const closesBlock = line.includes("*/");
		const isComment =
			inBlockComment || trimmed.startsWith("//") || trimmed.startsWith("*") || opensBlock;
		if (opensBlock && !closesBlock) inBlockComment = true;
		if (closesBlock) inBlockComment = false;

		if (!isComment) return;

		// A comment documenting a field whose value is an emoji has to show one.
		// `DiagnosticPipelineResult`'s icon field is the real case. Quoted text
		// inside a comment is an example rather than prose, so it is exempt for
		// the same reason string literals are.
		const prose = line.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "");

		for (const rule of RULES) {
			rule.pattern.lastIndex = 0;
			const found = (rule.name === "emoji" ? prose : line).match(rule.pattern);
			if (!found) continue;
			fileCount += found.length;
			violations += found.length;
			if (!countOnly) {
				console.log(`${file}:${i + 1}: ${rule.message}`);
				console.log(`  ${line.trim()}`);
			}
		}
	});

	if (fileCount > 0) perFile.push([file, fileCount]);
}

if (countOnly) {
	perFile.sort((a, b) => b[1] - a[1]);
	for (const [file, n] of perFile) console.log(`${String(n).padStart(5)}  ${file}`);
	console.log(`\n${violations} violation(s) across ${perFile.length} of ${files.length} file(s).`);
	process.exit(0);
}

if (violations > 0) {
	console.error(`\n${violations} comment-style violation(s) in ${perFile.length} file(s).`);
	process.exit(1);
}
console.log(`Comment style clean across ${files.length} file(s).`);
