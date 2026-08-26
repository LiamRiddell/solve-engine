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

/**
 * One whole-document example: a ```solve-doc block, evaluated together rather
 * than a line at a time, which is what the cross-line forms (line references,
 * category tags, table columns, goal seek) need. `rows` keeps every line in
 * order, blanks and table rows included, so a result read back by position lines
 * up with the source.
 *
 * @typedef {{ file: string, line: number, rows: { line: number, expression: string, expected: string | null }[] }} DocBlock
 */

/** Split a line on its LAST `//`, the expected-result marker. */
function splitExpectation(text) {
	// A line may carry a comment of its own, as in `2 + 2 // note // 4`, where
	// the expression is everything up to the final marker.
	const marker = text.lastIndexOf("//");
	if (marker === -1) return { expression: text, expected: null };
	return { expression: text.slice(0, marker).trim(), expected: text.slice(marker + 2).trim() };
}

/**
 * Parses one markdown file, appending per-line ```solve examples to `examples`
 * and whole-document ```solve-doc blocks to `docBlocks`. The two kinds are kept
 * apart because they are run through different engine entry points: a ```solve
 * line through the single-expression path, a ```solve-doc block as one document.
 */
function parseFile(full, examples, docBlocks) {
	const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
	// "none" outside a block, "line" inside ```solve, or a DocBlock being built.
	let mode = "none";
	let doc = null;

	lines.forEach((raw, i) => {
		const text = raw.trim();
		const fence = text.match(/^```(\S*)/);

		if (mode === "none") {
			if (fence && fence[1] === "solve") mode = "line";
			else if (fence && fence[1] === "solve-doc") {
				mode = "doc";
				doc = { file: full, line: i + 1, rows: [] };
			}
			return;
		}

		// A closing fence ends whichever block is open.
		if (fence && fence[1] === "") {
			if (mode === "line") {
				// Closing a block ends the group. Without this, separate blocks share
				// one engine and a variable assigned in one example leaks into the
				// next, which has silently resolved an intended-unknown before.
				examples.push({ file: full, line: i + 1, expression: "", expected: null });
			} else if (doc) {
				docBlocks.push(doc);
				doc = null;
			}
			mode = "none";
			return;
		}

		if (mode === "doc") {
			// Keep every line in order, blanks and table rows included: a blank is a
			// boundary the aggregates read, not a break between examples.
			const { expression, expected } = splitExpectation(text);
			doc.rows.push({ line: i + 1, expression, expected });
			return;
		}

		// mode === "line". A blank line inside a block separates independent examples.
		if (text === "") {
			examples.push({ file: full, line: i + 1, expression: "", expected: null });
			return;
		}
		const { expression, expected } = splitExpectation(text);
		examples.push({ file: full, line: i + 1, expression, expected });
	});
}

function walkDocs(dir, extraFiles, examples, docBlocks) {
	const walk = (current) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (!/\.mdx?$/.test(entry.name)) continue;
			parseFile(full, examples, docBlocks);
		}
	};

	if (fs.existsSync(dir)) walk(dir);
	for (const file of extraFiles) {
		if (fs.existsSync(file)) parseFile(file, examples, docBlocks);
	}
}

/**
 * Every per-line ```solve example under a directory, plus any extra files.
 *
 * Whole-document ```solve-doc blocks are deliberately NOT included here, since a
 * caller running these through the single-expression path would only get a
 * "needs a document" refusal for the cross-line forms. Use {@link collectDocBlocks}
 * for those.
 *
 * @param {string} dir - Documentation root to walk.
 * @param {string[]} extraFiles - Markdown outside that tree, such as the README.
 * @returns {DocExample[]} Per-line examples in document order, with separators.
 */
export function collectExamples(dir, extraFiles = []) {
	const examples = [];
	walkDocs(dir, extraFiles, examples, []);
	return examples;
}

/**
 * Every whole-document ```solve-doc block under a directory, plus any extra files.
 *
 * @param {string} dir - Documentation root to walk.
 * @param {string[]} extraFiles - Markdown outside that tree, such as the README.
 * @returns {DocBlock[]} Blocks in document order.
 */
export function collectDocBlocks(dir, extraFiles = []) {
	const docBlocks = [];
	walkDocs(dir, extraFiles, [], docBlocks);
	return docBlocks;
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
