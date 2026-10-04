/**
 * Type-checks the spec files and the test tools, against a baseline that is
 * only allowed to fall.
 *
 * `npm run typecheck` covers `packages/engine/src` and nothing else, and ts-jest
 * runs the specs with `isolatedModules`, which transpiles each file without
 * checking it. So a type error in a test or a test helper was never reported:
 * 248 had built up when this was first run, 151 of them Jest globals used with
 * no import, two of them calls to a `fail` that Jest 30 no longer defines (#777).
 *
 * The check runs TypeScript 7's `tsc` (the `typescript7` alias, the compiler
 * `npm run typecheck` uses) over `packages/engine/tsconfig.tests.json`, counts
 * the errors per file, and compares them with the committed baseline:
 *
 *   - a file with more errors than the baseline allows fails the run, and its
 *     errors are printed;
 *   - fewer errors pass, and the baseline is rewritten with the lower counts, so
 *     the fix is kept by committing the file;
 *   - the same count passes and writes nothing.
 *
 * Counting per file rather than in total stops a new error in one file hiding
 * behind a fix in another.
 *
 * Usage:
 *   node scripts/check-type-baseline.mjs
 *   node scripts/check-type-baseline.mjs --update       write the current counts
 *   node scripts/check-type-baseline.mjs --project=<tsconfig> --baseline=<json>
 *
 * @module check-type-baseline
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** One compiler diagnostic, keyed by the file it names ("(project)" when it names none). */
const DIAGNOSTIC = /^(?:(.+?)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/;

/**
 * Parse `tsc --pretty false` output into errors.
 *
 * @param output - The compiler's stdout.
 * @returns One entry per error line, continuation lines folded into the one above.
 */
export function parseDiagnostics(output) {
	const errors = [];
	for (const line of output.split(/\r?\n/)) {
		const match = DIAGNOSTIC.exec(line);
		if (match) {
			errors.push({ file: (match[1] ?? "(project)").split(path.sep).join("/"), line: match[2] ? Number(match[2]) : null, code: match[4], text: line });
		} else if (line.startsWith(" ") && errors.length > 0) {
			errors[errors.length - 1].text += `\n${line}`;
		}
	}
	return errors;
}

/**
 * Count errors per file.
 *
 * @param errors - What {@link parseDiagnostics} returned.
 * @returns File to count, with keys sorted so the written baseline is stable.
 */
export function countByFile(errors) {
	// A Map, not an object: a file named `constructor` or `__proto__` would
	// otherwise read an inherited property, or set the prototype.
	const counts = new Map();
	for (const e of errors) counts.set(e.file, (counts.get(e.file) ?? 0) + 1);
	return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Compare the current counts with the baseline's.
 *
 * @param baseline - File to count, as committed.
 * @param current - File to count, as measured.
 * @returns The files over their allowance, and whether any file fell.
 */
export function compareCounts(baseline, current) {
	const over = [];
	let fell = false;
	for (const [file, count] of Object.entries(current)) {
		const allowed = Object.hasOwn(baseline, file) ? baseline[file] : 0;
		if (count > allowed) over.push({ file, allowed, count });
	}
	for (const [file, allowed] of Object.entries(baseline)) {
		const count = Object.hasOwn(current, file) ? current[file] : 0;
		if (count < allowed) fell = true;
	}
	return { over, fell };
}

/** The TypeScript 7 compiler's entry script, resolved from the workspace root. */
function compilerPath() {
	const require = createRequire(path.join(REPO, "package.json"));
	try {
		return path.join(path.dirname(require.resolve("typescript7/package.json")), "bin", "tsc");
	} catch {
		return null;
	}
}

function main() {
	const args = process.argv.slice(2);
	const option = (name, fallback) => {
		const found = args.find((a) => a.startsWith(`--${name}=`));
		return found ? path.resolve(found.slice(name.length + 3)) : fallback;
	};
	const project = option("project", path.join(REPO, "packages/engine/tsconfig.tests.json"));
	const baselinePath = option("baseline", path.join(REPO, "packages/engine/__tests__/typecheck-baseline.json"));
	const update = args.includes("--update");

	const tsc = compilerPath();
	if (tsc === null) {
		console.error('The "typescript7" package is not installed. Run `npm ci` at the repository root.');
		process.exit(1);
	}

	const run = spawnSync(process.execPath, [tsc, "--noEmit", "--pretty", "false", "-p", project], {
		cwd: path.dirname(project),
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	const errors = parseDiagnostics(`${run.stdout ?? ""}`);
	// A compiler that exits non-zero having reported nothing crashed, and a crash
	// counted as zero errors would lower the baseline to nothing.
	if (run.status !== 0 && errors.length === 0) {
		console.error(`The compiler exited ${run.status} without reporting an error:\n${run.stderr ?? ""}${run.stdout ?? ""}`);
		process.exit(1);
	}
	const current = countByFile(errors);
	const total = errors.length;

	const write = () => {
		fs.writeFileSync(baselinePath, `${JSON.stringify({ total, files: current }, null, "\t")}\n`);
	};

	if (update) {
		write();
		console.log(`Wrote ${path.relative(REPO, baselinePath)}: ${total} error(s) in ${Object.keys(current).length} file(s).`);
		return;
	}

	let baseline;
	try {
		baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")).files;
	} catch {
		console.error(`No readable baseline at ${path.relative(REPO, baselinePath)}. Create it with --update and commit it.`);
		process.exit(1);
	}

	const { over, fell } = compareCounts(baseline, current);
	if (over.length > 0) {
		for (const { file, allowed, count } of over) {
			console.error(`${file}: ${count} type error(s), the baseline allows ${allowed}.`);
			for (const e of errors.filter((x) => x.file === file)) console.error(`  ${e.text}`);
		}
		console.error(`\n${over.length} file(s) gained type errors. Fix them; the baseline only falls.`);
		process.exit(1);
	}
	if (fell) {
		write();
		console.log(`Type errors fell to ${total}. The baseline is rewritten with the lower counts: commit ${path.relative(REPO, baselinePath)}.`);
		return;
	}
	console.log(`Tests and tools type-check at the baseline: ${total} error(s) in ${Object.keys(current).length} file(s), none new.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
