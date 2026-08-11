/**
 * Runs one slice of the corpus through one build of the engine.
 *
 * This process is expected to die. A fuzz-generated expression can exhaust the
 * heap or wedge a loop, and neither is observable from inside the process
 * suffering it, so the runner supervises: results are appended a line at a
 * time, and the index currently in flight is written to a progress file before
 * the evaluation starts. A child that vanishes therefore still says which
 * expression it vanished on, and the runner resumes at the next one.
 *
 * Determinism is enforced here rather than by filtering the corpus, because a
 * filter only excludes the nondeterminism somebody remembered. The clock, the
 * timezone, `Math.random` and `fetch` are all pinned before the engine is
 * imported, so `today` and `now` answer the same thing in both builds and
 * nothing reaches the network. Whatever leaks past that is caught by the
 * runner's repeat pass, which discards any expression that disagrees with
 * itself.
 *
 * Usage:
 *   node probe.mjs --root=<dist dir> --corpus=<json> --out=<jsonl> --progress=<file> --start=0
 */

import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "node:path";

const args = new Map();
for (const arg of process.argv.slice(2)) {
	const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
	if (match) args.set(match[1], match[2] ?? "true");
}

const root = args.get("root");
const corpusFile = args.get("corpus");
const outFile = args.get("out");
const progressFile = args.get("progress");
const start = Number(args.get("start") ?? 0);
const limit = Number(args.get("limit") ?? Infinity);
/**
 * Distance between the indices this child takes.
 *
 * Shards interleave rather than taking contiguous blocks. The corpus is sorted
 * by where an expression came from, so the expensive inputs arrive in clumps:
 * one contiguous block held every denial-of-service literal and took longer on
 * its own than the other six shards put together. A stride spreads a clump
 * evenly across all of them.
 */
const stride = Number(args.get("stride") ?? 1);

// ── Determinism ───────────────────────────────────────────────────────────
// Everything below runs before the engine module is imported, so module-level
// initialisation sees the pinned versions too.

/** Fixed instant both builds believe it is. A Thursday, mid-month, mid-day, to avoid month and week edges. */
const FIXED_NOW = Date.UTC(2026, 4, 14, 12, 30, 0);

const RealDate = Date;
class FrozenDate extends RealDate {
	constructor(...values) {
		if (values.length === 0) super(FIXED_NOW);
		else super(...values);
	}
	static now() {
		return FIXED_NOW;
	}
}
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
globalThis.Date = FrozenDate;

// A seeded replacement, not a constant, because a constant makes `random`
// degenerate in a way that could hide a real difference in how the value is
// used. Both builds draw the same sequence in the same order.
let randomState = 0x2545f491;
Math.random = () => {
	randomState ^= randomState << 13;
	randomState ^= randomState >>> 17;
	randomState ^= randomState << 5;
	randomState |= 0;
	return ((randomState >>> 0) % 0x100000000) / 0x100000000;
};

// Never resolving rather than rejecting. A rejection would race the evaluation
// and produce an unhandled rejection whose timing differs run to run; a promise
// that never settles leaves every async value Pending, identically, in both.
globalThis.fetch = () => new Promise(() => {});

process.on("unhandledRejection", () => {});

// ── Load the build under test ─────────────────────────────────────────────

const { ExpressionEngine } = await import(pathToFileURL(path.join(root, "index.js")).href);
const { formatValue } = await import(pathToFileURL(path.join(root, "format.js")).href);

const corpus = JSON.parse(fs.readFileSync(corpusFile, "utf8"));

/** Names for `ValueType`, so a diff reads as `Uom` rather than `6`. */
const TYPE_NAMES = [
	"Number", "Hex", "BigInt", "String", "Datetime", "Percentage", "Uom",
	"Matrix", "Range", "Symbolic", "Boolean", "Unit", "Pending", "Error",
];

/** A unit, reduced to something comparable. Units are objects in some builds and strings in others. */
function describeUnit(unit) {
	if (unit === undefined || unit === null) return null;
	if (typeof unit === "string") return unit;
	if (typeof unit === "object") {
		try {
			return JSON.stringify(unit, (key, inner) => (typeof inner === "bigint" ? `${inner}n` : inner));
		} catch {
			return "<unserialisable>";
		}
	}
	return String(unit);
}

/** One value, reduced to the four things a consumer can actually observe. */
function describeValue(value) {
	if (value === undefined || value === null) return { present: false };
	let formatted;
	try {
		formatted = formatValue(value);
	} catch (error) {
		formatted = `<format threw: ${error?.message ?? error}>`;
	}
	const type = typeof value.type === "number" ? value.type : null;
	return {
		present: true,
		formatted,
		type,
		typeName: type === null ? null : (TYPE_NAMES[type] ?? `#${type}`),
		unit: describeUnit(value.unit),
	};
}

/** An error, reduced to what a caller can branch on. */
function describeError(error) {
	if (error === null || typeof error !== "object") {
		return { name: "non-error", code: null, message: String(error) };
	}
	return {
		name: error.constructor?.name ?? error.name ?? "Error",
		code: error.code ?? error.errorCode ?? null,
		message: typeof error.message === "string" ? error.message : String(error),
	};
}

const handle = fs.openSync(outFile, "a");
const end = Math.min(corpus.length, start + limit * stride);

for (let i = start; i < end; i += stride) {
	// Written before the evaluation, so a process that dies mid-expression is
	// still attributable. Synchronous on purpose: a buffered write is lost
	// exactly when it matters.
	fs.writeFileSync(progressFile, String(i));

	const source = corpus[i].source;
	let record;
	// A fresh engine per expression. Reusing one and calling `clear()` is
	// faster, but a variable or a cache entry surviving into the next
	// expression would make a result depend on its neighbour, and the two
	// builds do not have to agree about what survives.
	let engine = null;
	try {
		engine = new ExpressionEngine("en");
		const results = engine.evaluateLine(1, source);
		record = {
			ok: true,
			count: Array.isArray(results) ? results.length : 0,
			values: (Array.isArray(results) ? results : []).slice(0, 3).map(describeValue),
		};
	} catch (error) {
		record = { ok: false, error: describeError(error) };
	} finally {
		try {
			engine?.clear();
		} catch {
			// A clear() that throws is itself worth knowing about, but not at
			// the cost of losing the result that preceded it.
		}
	}

	fs.writeSync(handle, `${JSON.stringify({ i, record })}\n`);
}

fs.closeSync(handle);
fs.writeFileSync(progressFile, String(end));
process.stdout.write(`probed ${start}..${end}\n`);

// Explicit, because the process will not end on its own. An expression that
// starts an async lookup leaves a query in flight against a `fetch` that never
// settles, and its cache carries a garbage-collection timer that holds the loop
// open for minutes. Everything this process had to say is already on disk.
process.exit(0);
