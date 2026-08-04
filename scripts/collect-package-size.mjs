/**
 * Records what the published package actually weighs, for the site to quote.
 *
 * Same contract as `collect-test-stats.mjs`, and for the same reason: a size on
 * a landing page is worth what the reader's confidence in it is worth, and a
 * number typed in by hand is wrong by the next release.
 *
 * There is no size budget. `size-limit` is used here as a measuring instrument
 * rather than a gate: it does a real bundle, which is the only honest way to
 * answer "what does importing this cost", and it reports rather than fails. The
 * `--check` mode below is still a gate, but on **staleness**, not on size, so a
 * jump in the figure has to be committed and shows up as a reviewable diff.
 *
 * Two different questions get two different answers here, because conflating
 * them is how size claims become misleading:
 *
 *   · what reaches a browser, which is the bundled, minified, gzipped cost of
 *     importing the engine. This is the number that matters to somebody
 *     shipping it, and it comes from size-limit, which does a real bundle.
 *   · what npm downloads and puts on disk, which is much larger and almost
 *     entirely type declarations and the second module format. Quoting only
 *     this would be alarming and useless; quoting only the first would be
 *     hiding something a reader will notice in their node_modules.
 *
 * Usage:
 *   node scripts/collect-package-size.mjs           write, after a build
 *   node scripts/collect-package-size.mjs --check   fail if the file is stale
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.join(ROOT, "docs/src/data/packageSize.json");
const DIST = path.join(ROOT, "packages/engine/dist");

/** Runs a command from the repository root and returns its stdout. */
function run(command, args) {
	return execFileSync(command, args, {
		cwd: ROOT,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		shell: process.platform === "win32",
	});
}

/**
 * The bundled cost of importing the engine, from size-limit.
 *
 * Both of its entries are recorded rather than just the smaller one. They are
 * within a few bytes of each other, and that fact is the interesting one: every
 * subpath reaches the engine core, so importing one name costs what importing
 * everything costs. Saying so is more useful than quoting the smaller number
 * and letting a reader assume tree-shaking is doing something.
 */
function bundled() {
	if (!fs.existsSync(DIST)) {
		console.error("packages/engine/dist is missing. Run `npm run build` first.");
		process.exit(1);
	}

	const report = JSON.parse(run("npx", ["size-limit", "--json"]));
	const named = (needle) => report.find((entry) => entry.name.includes(needle));
	const single = named("ExpressionEngine");
	const whole = named("whole root entry");

	if (!single || !whole) {
		console.error("size-limit did not report the two expected entries.");
		process.exit(1);
	}

	return {
		importOneGzip: single.size,
		importEverythingGzip: whole.size,
	};
}

/** What npm ships and unpacks, straight from `npm pack`. */
function published() {
	const raw = run("npm", ["pack", "--dry-run", "--json", "--workspace=packages/engine"]);
	// npm prints the tarball name on stderr and the JSON on stdout, but a
	// warning can still land in front of the array, so start at the bracket.
	const parsed = JSON.parse(raw.slice(raw.indexOf("[")));
	const entry = parsed[0];
	return {
		tarballBytes: entry.size,
		unpackedBytes: entry.unpackedSize,
		fileCount: entry.entryCount,
	};
}

const sizes = { ...bundled(), ...published() };
const next = `${JSON.stringify(sizes, null, 2)}\n`;

/** The committed copy, or "" when there is not one yet. */
function readCommitted() {
	try {
		return fs.readFileSync(TARGET, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return "";
		throw error;
	}
}

if (process.argv.includes("--check")) {
	if (readCommitted() !== next) {
		console.error(
			"docs/src/data/packageSize.json is out of date.\n" +
				`  committed: ${readCommitted().trim() || "(missing)"}\n` +
				`  actual:    ${next.trim()}\n` +
				"Run `npm run stats:size` and commit the result.",
		);
		process.exit(1);
	}
	console.log(`Package size is current: ${sizes.importOneGzip} bytes gzipped.`);
} else {
	fs.writeFileSync(TARGET, next);
	console.log(`Wrote ${path.relative(ROOT, TARGET)}: ${sizes.importOneGzip} bytes gzipped.`);
}
