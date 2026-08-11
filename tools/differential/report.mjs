/**
 * Turns a differential run into something a person can actually read.
 *
 * Tens of thousands of expressions produce thousands of differences, and a flat
 * list of them is unreviewable, which in practice means unreviewed. So every
 * difference gets a signature describing the *shape* of the change (what the
 * result was on each side, and in what way it moved) and the report is a list
 * of signatures with counts and a handful of examples each. A reviewer then
 * makes one judgement per shape rather than one per row, and the long tail of
 * near-identical differences collapses into a line.
 *
 * Two things are filtered out before anything is counted, both for the same
 * reason: they are differences that are not about the release.
 *
 * - Expressions that disagree with themselves across two runs of the same
 *   build. Something unpinned is reaching them and neither answer is the
 *   build's fault.
 * - Nothing else. In particular, formatting-only changes are kept, because
 *   "the output looks different" is exactly the kind of unintended change a
 *   test suite misses.
 *
 * Usage:
 *   node tools/differential/report.mjs                 summary to stdout
 *   node tools/differential/report.mjs --signature=X   every row of one shape
 *   node tools/differential/report.mjs --examples=8    more examples per shape
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const WORK = path.join(ROOT, "node_modules", ".cache", "solve-differential");

const args = new Map();
for (const arg of process.argv.slice(2)) {
	const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
	if (match) args.set(match[1], match[2] ?? "true");
}

const run = JSON.parse(fs.readFileSync(args.get("run") ?? path.join(WORK, "run.json"), "utf8"));
const examplesWanted = Number(args.get("examples") ?? 4);
const wantedSignature = args.get("signature") ?? null;

/** A result, reduced to the string a comparison is done on. */
function fingerprint(record) {
	if (record === null || record === undefined) return "MISSING";
	if (record.fatal !== undefined) return `FATAL(${record.fatal})`;
	if (record.ok === false) return `ERR(${record.error.code ?? record.error.name}|${record.error.message})`;
	const parts = record.values.map((value) =>
		value.present === false ? "-" : `${value.typeName}|${value.unit ?? ""}|${value.formatted}`,
	);
	return `OK[${record.count}](${parts.join(" ;; ")})`;
}

/** The coarse kind of a result, which is what a signature is built from. */
function kindOf(record) {
	if (record === null || record === undefined) return "missing";
	if (record.fatal !== undefined) return `fatal:${record.fatal.split(" ")[0]}`;
	if (record.ok === false) return `error:${record.error.code ?? record.error.name}`;
	const first = record.values[0];
	if (first === undefined || first.present === false) return "ok:none";
	return `ok:${first.typeName}`;
}

/**
 * A formatted result with its presentation normalised away.
 *
 * Two results that differ only in grouping separators or trailing decimal
 * zeros are the same number printed differently, and calling that a value
 * change would bury the real ones. Everything else in the string is kept,
 * including words, so `true` becoming `false` is a value change rather than a
 * cosmetic one.
 *
 * The normalisation is textual rather than a round trip through `Number`.
 * Exact-integer results run to hundreds of digits, and parsing one as a double
 * makes `24691357802469134336` and `24691357802469135780` compare equal, which
 * is exactly the bug class this release fixed.
 */
function normalisedText(text) {
	if (typeof text !== "string") return "";
	return (
		text
			// Grouping separators, only between digits, so a comma-separated list
			// of results is left alone.
			.replace(/(\d),(?=\d\d\d(\D|$))/g, "$1")
			// Trailing zeros after a decimal point, and a bare trailing point.
			.replace(/(\d+\.\d*?)0+(?=\D|$)/g, "$1")
			.replace(/(\d)\.(?=\D|$)/g, "$1")
			.replace(/\s+/g, " ")
			.trim()
	);
}

/** How an ok-to-ok difference moved, so presentation separates from arithmetic. */
function movement(before, after) {
	const a = before.values[0];
	const b = after.values[0];
	if (a === undefined || b === undefined || a.present === false || b.present === false) return "shape";
	if (before.count !== after.count) return "result-count";
	if (a.typeName !== b.typeName) return "type";
	if ((a.unit ?? "") !== (b.unit ?? "")) return "unit";
	if (normalisedText(a.formatted) !== normalisedText(b.formatted)) return "value";
	return "formatting";
}

const differences = [];
let compared = 0;
let unstable = 0;
let identical = 0;

for (let i = 0; i < run.corpus.length; i++) {
	const before = run.baseline[i];
	const after = run.candidate[i];

	if (run.baselineRepeat !== null && fingerprint(before) !== fingerprint(run.baselineRepeat[i])) {
		unstable += 1;
		continue;
	}
	if (run.candidateRepeat !== null && fingerprint(after) !== fingerprint(run.candidateRepeat[i])) {
		unstable += 1;
		continue;
	}

	compared += 1;
	const beforePrint = fingerprint(before);
	const afterPrint = fingerprint(after);
	if (beforePrint === afterPrint) {
		identical += 1;
		continue;
	}

	const beforeKind = kindOf(before);
	const afterKind = kindOf(after);
	const move =
		beforeKind.startsWith("ok:") && afterKind.startsWith("ok:") ? `/${movement(before, after)}` : "";
	differences.push({
		index: i,
		source: run.corpus[i].source,
		origin: run.corpus[i].origin,
		signature: `${beforeKind} -> ${afterKind}${move}`,
		before: beforePrint,
		after: afterPrint,
	});
}

const bySignature = new Map();
for (const difference of differences) {
	if (!bySignature.has(difference.signature)) bySignature.set(difference.signature, []);
	bySignature.get(difference.signature).push(difference);
}

const ordered = [...bySignature.entries()].sort((a, b) => b[1].length - a[1].length);

if (wantedSignature !== null) {
	const rows = bySignature.get(wantedSignature) ?? [];
	console.log(`${wantedSignature}: ${rows.length} row(s)\n`);
	for (const row of rows) {
		console.log(`  #${row.index} [${row.origin}]`);
		console.log(`    src   ${JSON.stringify(row.source)}`);
		console.log(`    base  ${row.before}`);
		console.log(`    cand  ${row.after}`);
	}
} else {
	console.log(`corpus      ${run.corpus.length}`);
	console.log(`compared    ${compared}`);
	console.log(`unstable    ${unstable} (dropped: disagreed with itself across two runs of the same build)`);
	console.log(`identical   ${identical}`);
	console.log(`different   ${differences.length}`);
	console.log(`signatures  ${ordered.length}\n`);

	for (const [signature, rows] of ordered) {
		console.log(`── ${signature}  (${rows.length})`);
		for (const row of rows.slice(0, examplesWanted)) {
			console.log(`   ${JSON.stringify(row.source).slice(0, 160)}   [${row.origin}]`);
			console.log(`     base ${row.before.slice(0, 200)}`);
			console.log(`     cand ${row.after.slice(0, 200)}`);
		}
		console.log("");
	}
}

fs.writeFileSync(path.join(WORK, "differences.json"), JSON.stringify(differences, null, 1));
