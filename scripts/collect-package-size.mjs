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
 * object keyed by package name. Both have to be read, because the two npms are
 * both in use here: the publish workflow pins npm 12 so it can speak OIDC to
 * the registry, while every other job takes whatever the Node version ships.
 * Reading only one shape means the numbers agree everywhere until a release,
 * which is the worst moment to find out.
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

/** What npm ships and unpacks, straight from `npm pack`. */
function published() {
	const raw = run("npm", ["pack", "--dry-run", "--json", "--workspace=packages/engine"]);
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
 * How closely each field has to match for the committed file to count as current.
 *
 * This used to be one string comparison over the whole file, which was wrong,
 * and wrong in the way that only shows up once somebody regenerates the file on
 * a different machine from the one CI uses. Two of these numbers are
 * reproducible to the byte and three are not:
 *
 *   · the gzipped figures come from bundling `dist`, and the bundle is
 *     deterministic. A Windows checkout and a Linux runner agree exactly, which
 *     has been checked rather than assumed.
 *   · `fileCount` is a structural fact about the package. Also exact.
 *   · the tarball and unpacked figures are the sum of what is on disk, and that
 *     drifts by around a kilobyte across platforms. `package.json` alone carries
 *     225 more bytes in a Windows working tree because of its line endings,
 *     while git stores it with LF and CI therefore packs the shorter one.
 *
 * So the byte totals get a tolerance and everything else does not. The tolerance
 * is far tighter than the precision the number is ever shown at: the site
 * renders these to a tenth of a megabyte, which on a two megabyte tarball is
 * a step of about five percent.
 */
const EXACT = ["importOneGzip", "importEverythingGzip", "fileCount"];
const TOLERANT = { tarballBytes: 0.005, unpackedBytes: 0.005 };

/** Field names whose committed value no longer describes the package. */
function staleFields(committed) {
	const stale = [];

	for (const field of EXACT) {
		if (committed[field] !== sizes[field]) stale.push(field);
	}

	for (const [field, tolerance] of Object.entries(TOLERANT)) {
		const was = committed[field];
		if (typeof was !== "number") {
			stale.push(field);
			continue;
		}
		if (Math.abs(sizes[field] - was) / was > tolerance) stale.push(field);
	}

	return stale;
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
		console.error(
			"docs/src/data/packageSize.json is out of date.\n" +
				`  stale:     ${stale.join(", ")}\n` +
				`  committed: ${raw.trim() || "(missing)"}\n` +
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
