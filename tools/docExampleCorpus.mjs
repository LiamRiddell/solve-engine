/**
 * Collects the documented examples as data, so they can be run somewhere other
 * than the jest suite.
 *
 * `__tests__/docs/DocExamples.spec.ts` executes these against `src` through
 * path aliases, which proves the logic and says nothing about the package a
 * consumer installs. Pulling the corpus out into plain data lets the same
 * examples, with the same expected results, run against an installed copy.
 *
 * The parsing rules are `DocExamples.spec.ts`'s, deliberately, and the two
 * agreeing matters more than either being clever. `scripts/consumer-e2e.mjs`
 * cross-checks the count against `docs/src/data/testStats.json`, which is
 * produced by a third implementation of the same rule, so a drift in any one of
 * them fails a run rather than quietly shrinking what gets tested.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * One line of a documented example.
 *
 * `expected` is `null` for a line with no `//` marker, which is run for its
 * side effects (assigning a variable the next line uses) but not asserted, and
 * for the separators that end a group.
 *
 * @typedef {{ file: string, line: number, expression: string, expected: string | null }} DocExample
 */

/** Parses one markdown file into examples and separators. */
function parseFile(full, out) {
	const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
	let inBlock = false;

	lines.forEach((raw, i) => {
		const text = raw.trim();
		if (text.startsWith("```solve")) {
			inBlock = true;
			return;
		}
		if (inBlock && text.startsWith("```")) {
			inBlock = false;
			// Closing a block ends the group. Without this, separate blocks share
			// one engine and a variable assigned in one example leaks into the
			// next, which has silently resolved an intended-unknown before.
			out.push({ file: full, line: i + 1, expression: "", expected: null });
			return;
		}
		if (!inBlock) return;

		// A blank line inside a block separates independent examples.
		if (text === "") {
			out.push({ file: full, line: i + 1, expression: "", expected: null });
			return;
		}

		// Split on the LAST marker. A line may carry a comment of its own, as in
		// `2 + 2 // note // 4`, where the expression is everything up to the final
		// marker.
		const marker = text.lastIndexOf("//");
		if (marker === -1) {
			out.push({ file: full, line: i + 1, expression: text, expected: null });
			return;
		}
		out.push({
			file: full,
			line: i + 1,
			expression: text.slice(0, marker).trim(),
			expected: text.slice(marker + 2).trim(),
		});
	});
}

/**
 * Every documented example under a directory, plus any extra files.
 *
 * @param {string} dir - Documentation root to walk.
 * @param {string[]} extraFiles - Markdown outside that tree, such as the README.
 * @returns {DocExample[]} Examples in document order, with separators.
 */
export function collectExamples(dir, extraFiles = []) {
	const out = [];

	const walk = (current) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (!/\.mdx?$/.test(entry.name)) continue;
			parseFile(full, out);
		}
	};

	if (fs.existsSync(dir)) walk(dir);
	for (const file of extraFiles) {
		if (fs.existsSync(file)) parseFile(file, out);
	}
	return out;
}

/**
 * Splits a corpus into the runs that must share one engine.
 *
 * Consecutive examples belong together, because a later line may use a variable
 * an earlier one assigned. A separator ends the run, and each group gets a
 * fresh engine.
 *
 * @param {DocExample[]} examples - The collected corpus.
 * @returns {DocExample[][]} Groups, none of them empty.
 */
export function groupExamples(examples) {
	const groups = [];
	let current = [];

	for (const example of examples) {
		if (example.expression === "") {
			if (current.length > 0) groups.push(current);
			current = [];
			continue;
		}
		current.push(example);
	}
	if (current.length > 0) groups.push(current);
	return groups;
}
