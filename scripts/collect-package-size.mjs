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

/**
 * The npm that packs the tarball, whichever npm is running this script.
 *
 * `npm pack` output is not byte-stable across npm versions: the tar writer and
 * its gzip settings have moved between majors, and three npms were in use
 * here at once (the one Node 22 ships in CI, the 12 the publish job installs
 * to speak OIDC, and whatever a contributor has). Each produced its own
 * `tarballBytes`, so a figure regenerated locally failed the exact check in
 * CI and had to be copied back out of the job log. Running the pack through
 * one pinned version makes the number the same everywhere it is measured.
 * Pinned rather than `@latest` for the same reason every other `npx` here is.
 */
const PACK_NPM = "npm@10.9.9";

/**
 * The Node line the committed figures are measured on, from `.nvmrc`. The
 * gzipped sizes come from size-limit, which compresses with the running
 * Node's zlib; a different zlib can compress the same bytes to a slightly
 * different count. Reported rather than enforced: a mismatch is the likeliest
 * explanation for a stale check, and the message says so.
 */
function expectedNodeMajor() {
	try {
		return Number.parseInt(fs.readFileSync(path.join(ROOT, ".nvmrc"), "utf8"), 10);
	} catch {
		return null;
	}
}

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

/**
 * The first complete JSON value in a command's output.
 *
 * npm writes the tarball name to stderr and the JSON to stdout, but a warning
 * can still land in front of it, so the value has to be found rather than
 * assumed to start at character zero.
 *
 * This used to do `raw.slice(raw.indexOf("["))`, which found the first opening
 * bracket anywhere in the output. That is only the start of the value while the
 * value happens to be an array, and it stopped being one, at which point the
 * search found a nested `files` array most of the way into the document and
 * parsed that instead. It then failed on the text after it, which pointed at
 * character 25,841 of the output and said nothing about the real cause.
 *
 * Scanning to the matching close brace or bracket makes the extraction say what
 * it means: take one value, ignore whatever surrounds it.
 */
function firstJsonValue(raw) {
	// The ordinary case, and the only one when nothing else wrote to stdout.
	try {
		return JSON.parse(raw);
	} catch {
		// Something is wrapped around it. Fall through and go looking.
	}

	// Every place a value could begin, tried in order. Candidates are tested
	// rather than trusted because a line of prose can contain a bracket too:
	// picking the first one and committing to it is the mistake this function
	// exists to stop making.
	for (let start = 0; start < raw.length; start++) {
		const opener = raw[start];
		if (opener !== "[" && opener !== "{") continue;

		const closer = opener === "[" ? "]" : "}";
		let depth = 0;
		let inString = false;
		let escaped = false;

		for (let i = start; i < raw.length; i++) {
			const c = raw[i];
			if (inString) {
				if (escaped) escaped = false;
				else if (c === "\\") escaped = true;
				else if (c === '"') inString = false;
				continue;
			}
			if (c === '"') inString = true;
			else if (c === opener) depth++;
			else if (c === closer && --depth === 0) {
				try {
					return JSON.parse(raw.slice(start, i + 1));
				} catch {
					break; // Not a value after all. Try the next opener.
				}
			}
		}
	}

	throw new Error(`no JSON value found in:\n${raw.slice(0, 400)}`);
}

/**
 * The one packed package, whichever way the npm in use reports it.
 *
 * npm 12 changed the shape of `npm pack --json` from a list of packages to an
 * object keyed by package name. The pack now runs through {@link PACK_NPM},
 * so only one shape arrives today; both are still read so that moving the
 * pin across that boundary is a one-line change rather than a surprise.
 */
function onlyPackage(parsed) {
	const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];

	// Loud rather than silent. Without this a third shape would write a file
	// with keys missing, because JSON.stringify drops undefined, and the check
	// would then report drift somewhere unrelated.
	for (const field of ["size", "unpackedSize", "entryCount"]) {
		if (typeof entry?.[field] !== "number") {
			throw new Error(
				`npm pack --json reported no numeric "${field}". ` +
					`Its output shape has changed again: ${JSON.stringify(parsed).slice(0, 200)}`,
			);
		}
	}

	return entry;
}

/** What npm ships and unpacks, straight from `npm pack` under the pinned npm (see {@link PACK_NPM}). */
function published() {
	const raw = run("npx", ["--yes", PACK_NPM, "pack", "--dry-run", "--json", "--workspace=packages/engine"]);
	const entry = onlyPackage(firstJsonValue(raw));
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

/**
 * Every field has to match to the byte, because every field reproduces to the
 * byte.
 *
 * An earlier version of this check gave the tarball and unpacked totals a half
 * a percent tolerance, on the belief that they drifted across platforms. They
 * do not. `.gitattributes` pins `eol=lf`, so a Windows working tree checks out
 * the same line endings a Linux runner does, and `npm pack` therefore weighs
 * the same on both. The apparent drift that motivated the tolerance came from a
 * `package.json` that had been hand-edited into CRLF, not from a clean checkout,
 * so it was measuring a mistake rather than a platform.
 *
 * What did drift, later, was the npm doing the packing: three versions were in
 * use across CI, the publish job and contributors' machines, and each wrote a
 * tarball of a different size. That is a toolchain difference rather than a
 * platform one, and it is closed by packing under one pinned npm
 * ({@link PACK_NPM}) rather than by widening the gate.
 *
 * The tolerance was not free. On the release that added the highlighting change
 * it silently absorbed a six kilobyte growth in the tarball, which is exactly
 * the kind of movement a size check exists to surface. Exact match gives the
 * check its teeth back, and if a genuine platform difference ever does appear,
 * failing on it is the right outcome: the fix is to make the packed bytes
 * deterministic, not to widen the gate until the difference fits.
 */
const EXACT = [
	"importOneGzip",
	"importEverythingGzip",
	"tarballBytes",
	"unpackedBytes",
	"fileCount",
];

/** Field names whose committed value no longer describes the package. */
function staleFields(committed) {
	return EXACT.filter((field) => committed[field] !== sizes[field]);
}

if (process.argv.includes("--check")) {
	const raw = readCommitted();
	let committed;
	try {
		committed = JSON.parse(raw);
	} catch {
		committed = null;
	}

	const stale = committed ? staleFields(committed) : ["(the file is missing or unreadable)"];

	if (stale.length > 0) {
		const expected = expectedNodeMajor();
		const running = Number.parseInt(process.versions.node, 10);
		const toolchainNote =
			expected !== null && running !== expected
				? `\nMeasured on Node ${process.versions.node}; the committed figures are produced on Node ${expected} (.nvmrc). ` +
					"A different zlib can gzip the same bytes to a different count, so regenerate on the pinned Node before trusting a gzip difference."
				: "";
		console.error(
			"docs/src/data/packageSize.json is out of date.\n" +
				`  stale:     ${stale.join(", ")}\n` +
				`  committed: ${raw.trim() || "(missing)"}\n` +
				`  actual:    ${next.trim()}\n` +
				"Run `npm run stats:size` and commit the result." +
				toolchainNote,
		);
		process.exit(1);
	}
	console.log(`Package size is current: ${sizes.importOneGzip} bytes gzipped.`);
} else {
	fs.writeFileSync(TARGET, next);
	console.log(`Wrote ${path.relative(ROOT, TARGET)}: ${sizes.importOneGzip} bytes gzipped.`);
}
