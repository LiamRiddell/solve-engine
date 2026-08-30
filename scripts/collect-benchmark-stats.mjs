/**
 * Records the engine's document throughput, for the site to quote.
 *
 * Same intent as `collect-test-stats.mjs` and `collect-package-size.mjs`: a
 * number a reader is asked to trust should come from a measurement in the
 * repository, not from a figure typed into a page by hand and never checked
 * again.
 *
 * Unlike those two, this is NOT gated by a `--check` in CI, and deliberately so.
 * The test and size figures reproduce to the byte on any clean checkout; a
 * throughput figure does not. It moves with the machine, the Node version and
 * whatever else the CPU is doing at the time, so an exact-match gate would fail
 * on nothing but noise. This is a committed snapshot, refreshed when the
 * benchmark baseline is, the same way the baseline itself is a snapshot rather
 * than a reproduced constant.
 *
 * The source is the committed benchmark baseline
 * (`packages/engine/benchmarks/baselines/full-pipeline-throughput-baseline.json`),
 * which the benchmark suite writes under `bench:baseline` and which the
 * comparator already trusts as the reference. Reading it here means the site
 * quotes the same measurement the project measures against, rather than a second
 * run that would disagree with the first for no reason a reader could see.
 *
 * Usage:
 *   node scripts/collect-benchmark-stats.mjs   read the baseline, write the site figure
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(
	ROOT,
	"packages/engine/benchmarks/baselines/full-pipeline-throughput-baseline.json",
);
const TARGET = path.join(ROOT, "docs/src/data/benchmarkStats.json");

/**
 * The document size each tier stands for, matched to the benchmark suite's own
 * TIERS table. The baseline records a tier by name, not by size, so the sizes
 * live here; if the suite's tiers change, this changes with them.
 */
const TIER_LINES = [
	{ name: "small", lines: 100 },
	{ name: "medium", lines: 1000 },
	{ name: "large", lines: 10000 },
	{ name: "massive", lines: 50000 },
];

/** Lines per second from a mean time in milliseconds for a document of `lines`. */
function linesPerSecond(lines, meanMs) {
	return Math.round((lines / meanMs) * 1000);
}

if (!fs.existsSync(SOURCE)) {
	console.error(
		`Missing ${path.relative(ROOT, SOURCE)}.\n` +
			"Run `npm run bench:baseline` to produce it first.",
	);
	process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(SOURCE, "utf8"));

const tiers = TIER_LINES.map(({ name, lines }) => {
	const tier = baseline.tiers?.[name];
	if (!tier) {
		console.error(`The baseline has no "${name}" tier. Its shape has changed.`);
		process.exit(1);
	}
	return {
		name,
		lines,
		coldLinesPerSec: linesPerSecond(lines, tier.cold.meanMs),
		warmLinesPerSec: linesPerSecond(lines, tier.warm.meanMs),
	};
});

const s = baseline.stageBreakdown ?? {};
const round1 = (n) => Math.round((n ?? 0) * 10) / 10;

// The CPU is read from the baseline where a run of the current suite recorded
// it, and falls back to this machine's own for a baseline written before that
// field existed. The baseline's platform and Node version already pin the rest
// of the environment, so the fallback only ever fills in the model name for a
// run on the same class of machine.
const measuredOn = {
	cpu: (baseline.metadata?.cpu ?? os.cpus()[0]?.model ?? "unknown").trim(),
	node: baseline.metadata?.nodeVersion ?? process.version,
	platform: baseline.metadata?.platform ?? process.platform,
	arch: baseline.metadata?.arch ?? process.arch,
};

const stats = {
	measuredOn,
	stages: {
		lex: round1(s.lexPercent),
		normalize: round1(s.normalizePercent),
		parseCompile: round1(s.parseCompilePercent),
		execute: round1(s.executePercent),
	},
	tiers,
};

fs.writeFileSync(TARGET, `${JSON.stringify(stats, null, 2)}\n`, "utf8");

const large = tiers.find((t) => t.name === "large");
console.log(
	`Wrote ${path.relative(ROOT, TARGET)}: ` +
		`${large.coldLinesPerSec.toLocaleString("en-GB")} lines/sec on a 10,000-line document (cold).`,
);
