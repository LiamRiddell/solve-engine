/**
 * Shared persistence for the benchmark suites.
 *
 * Every suite used to carry its own copy of the same `afterAll`: build a
 * console table, then write a baseline JSON file. Two problems came with that.
 * The write was unconditional, so an ordinary local run silently overwrote the
 * committed reference it was supposed to be compared against. And each suite
 * persisted a single mean per case, which is the least stable statistic
 * available from a timing loop: one garbage collection pause during ten
 * thousand iterations moves a mean and leaves a median untouched.
 *
 * Both are fixed here rather than twelve times over.
 */

import * as fs from "fs";
import * as path from "path";

/**
 * One case's timing, as persisted.
 *
 * `medianMs` and `minMs` are optional because a few cases derive a mean from a
 * total elapsed time and never see the per-iteration distribution. The
 * comparator prefers the median and falls back to the mean, reporting which it
 * used, rather than pretending a mean is a median.
 */
export interface BenchmarkSample {
	meanMs: number;
	medianMs?: number;
	minMs?: number;
}

/** Everything one suite measured, keyed by case name. */
export type BenchmarkResults = Record<string, BenchmarkSample>;

/** The shape {@link benchmarkFn} returns, accepted directly by {@link recordSample}. */
interface TimingStats {
	meanMs: number;
	medianMs: number;
	minMs: number;
}

/**
 * Record a case measured by `benchmarkFn`, keeping the full distribution.
 *
 * @param results - The suite's accumulating result map, mutated in place.
 * @param name - Case name. Must be stable across runs, since it is the key the
 * comparator matches a baseline against.
 * @param stats - What `benchmarkFn` returned.
 */
export function recordSample(results: BenchmarkResults, name: string, stats: TimingStats): void {
	results[name] = { meanMs: stats.meanMs, medianMs: stats.medianMs, minMs: stats.minMs };
}

/**
 * Record a case for which only a mean is available.
 *
 * Use this where the timing came from a single elapsed span divided by an
 * iteration count, so there is no per-iteration distribution to summarise.
 *
 * @param results - The suite's accumulating result map, mutated in place.
 * @param name - Case name, stable across runs.
 * @param meanMs - Mean milliseconds per iteration.
 */
export function recordScalar(results: BenchmarkResults, name: string, meanMs: number): void {
	results[name] = { meanMs };
}

/**
 * Convert a suite's own scalar map into the persisted shape.
 *
 * For suites that keep a plain `Record<string, number>` because they read their
 * own numbers back mid-run for assertions, or because the figure is derived
 * rather than measured by `benchmarkFn`. No median is recorded, since there is
 * no distribution behind the number, and the comparator falls back to the mean
 * accordingly.
 *
 * @param scalars - Case name to timing, in `unit`.
 * @param unit - Unit those numbers are in. Everything is persisted in
 * milliseconds, so microseconds are divided down here rather than at each of
 * the call sites.
 * @returns The same cases in persisted form.
 */
export function fromScalarMap(
	scalars: Record<string, number>,
	unit: "us" | "ms",
): BenchmarkResults {
	const divisor = unit === "us" ? 1000 : 1;
	const out: BenchmarkResults = {};
	for (const [name, value] of Object.entries(scalars)) {
		out[name] = { meanMs: value / divisor };
	}
	return out;
}

/**
 * Whether this run is allowed to overwrite the committed baselines.
 *
 * Only `npm run bench:baseline` sets the variable. Continuous integration never
 * does, and neither does an ordinary local run, which is what makes an
 * accidental clobber structurally impossible rather than merely discouraged.
 */
function isBaselineRun(): boolean {
	return process.env.SOLVE_BENCH_BASELINE === "1";
}

/** Directory that a given run writes into. */
function outputDir(): string {
	const root = path.join(__dirname, "..", "benchmarks");
	return isBaselineRun() ? path.join(root, "baselines") : path.join(root, "current");
}

/**
 * Resolve a path under the correct output directory, creating it if needed.
 *
 * For the suites that persist their own richer structure rather than plain
 * timings: the pool comparisons carry percentage improvements and allocation
 * deltas, and the parse-compile suite carries opcode counts. Flattening those
 * into a timing map would discard the thing they exist to measure, so they keep
 * their own shape and use this only to inherit the baseline gate.
 *
 * @param filename - File name including extension.
 * @returns Absolute path to write to.
 */
export function benchmarkOutputPath(filename: string): string {
	const dir = outputDir();
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, filename);
}

/**
 * Print a suite's results and persist them.
 *
 * @param suite - Suite identifier, used as the file name and as the suite key
 * the comparator groups by. Kebab-case, no extension.
 * @param results - Everything the suite measured.
 * @param unit - Display unit for the console table. Timings are stored in
 * milliseconds regardless; this only affects what is printed.
 */
export function writeBenchmarkResults(
	suite: string,
	results: BenchmarkResults,
	unit: "us" | "ms" = "us",
): void {
	const scale = unit === "us" ? 1000 : 1;
	const label = unit === "us" ? "µs" : "ms";
	const names = Object.keys(results);

	const width = Math.max(26, ...names.map((n) => n.length + 2));
	console.log(`\n${suite} (${label})`);
	console.log(
		`${"Case".padEnd(width)} ${`Median (${label})`.padStart(14)} ${`Mean (${label})`.padStart(14)} ${"Ops/sec".padStart(12)}`,
	);
	console.log("-".repeat(width + 44));

	for (const name of names) {
		const s = results[name];
		const median = s.medianMs ?? s.meanMs;
		const ops = s.meanMs > 0 ? 1000 / s.meanMs : 0;
		console.log(
			`${name.padEnd(width)} ${(median * scale).toFixed(3).padStart(14)} ${(s.meanMs * scale).toFixed(3).padStart(14)} ${ops.toFixed(0).padStart(12)}`,
		);
	}

	const dir = outputDir();
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${suite}.json`);

	// `timestamp` is deliberately absent from the persisted object. Baselines
	// are committed, and a timestamp would make every regeneration a diff even
	// when no measurement changed.
	fs.writeFileSync(
		file,
		`${JSON.stringify({ suite, results }, null, 2)}\n`,
		"utf8",
	);

	console.log(
		isBaselineRun()
			? `  baseline updated: ${path.relative(process.cwd(), file)}`
			: `  written to ${path.relative(process.cwd(), file)} (set SOLVE_BENCH_BASELINE=1 to update the committed baseline)`,
	);
}
