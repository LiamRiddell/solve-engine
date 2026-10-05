/**
 * Runs the coverage suite in shards side by side, then checks the floor once
 * on the merged result.
 *
 * Measured whole and single-threaded, the run had grown to between 80 and 90
 * minutes on the runner, using one of its four cores, against the workflow's 90-minute
 * limit, and about half the daily runs were cancelled with the floor unmeasured
 * (#890). The time is the v8 provider converting coverage for every loaded
 * source file once per spec file, which no setting makes cheaper; what helps is
 * doing it in several processes at once. Each shard is the same
 * `jest.coverage.config.cjs` run with `--shard=i/n`, single-threaded within
 * itself as before, writing Istanbul's `coverage-final.json` to its own
 * directory with the config's threshold switched off, since one shard alone
 * covers only part of the code. The floor is then checked on the merged map by
 * `scripts/lib/coverage-floor.mjs`, against the same `coverageThreshold` the
 * config declares, so the figure and the floor are the whole suite's as before.
 *
 * A failing test in any shard fails the run, after every shard has finished,
 * so one log shows all of them. `SOLVE_COVERAGE_SHARDS` sets the count
 * (default 2). Three were tried first and the runner, with 16 GB, was shut down
 * 43 minutes in: three 4 GB heaps plus the coverage each holds leave too little
 * room, so two run side by side, and the workflow's limit is raised to match.
 *
 * Usage:
 *   node scripts/run-coverage.mjs
 *   node scripts/run-coverage.mjs --check-only coverage/shard-1/coverage-final.json ...
 *
 * `--check-only` merges and checks files already written, without running the
 * suite; the tests of this script use it.
 *
 * @module run-coverage
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { belowFloor, mergeCoverage, METRICS, summarise } from "./lib/coverage-floor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** The shard count from the environment, refusing anything but a small whole number. */
function shardCount() {
	const raw = process.env.SOLVE_COVERAGE_SHARDS;
	if (raw === undefined || raw === "") return 2;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1 || n > 16) {
		console.error(`SOLVE_COVERAGE_SHARDS is ${JSON.stringify(raw)}: give a whole number from 1 to 16.`);
		process.exit(2);
	}
	return n;
}

/** Runs one shard, prefixing each line it writes so the interleaved log stays readable. */
function runShard(index, count, dir) {
	const args = [
		"--expose-gc",
		"--max-old-space-size=4096",
		path.join(root, "node_modules", "jest", "bin", "jest.js"),
		"--config",
		"jest.coverage.config.cjs",
		"--runInBand",
		"--forceExit",
		`--shard=${index}/${count}`,
		"--coverageReporters=json",
		"--coverageReporters=text-summary",
		`--coverageDirectory=${dir}`,
		"--coverageThreshold={}",
	];
	return new Promise((resolve) => {
		const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
		const label = `[shard ${index}/${count}] `;
		for (const stream of [child.stdout, child.stderr]) {
			let rest = "";
			stream.on("data", (chunk) => {
				const lines = (rest + chunk.toString()).split("\n");
				rest = lines.pop();
				for (const line of lines) process.stdout.write(label + line + "\n");
			});
			stream.on("end", () => {
				if (rest) process.stdout.write(label + rest + "\n");
			});
		}
		child.on("close", (code, signal) => resolve({ index, code: code ?? 1, signal }));
	});
}

/** Merges the files given, prints the whole-suite figures and returns the exit code. */
function check(files) {
	const floors = require(path.join(root, "jest.coverage.config.cjs")).coverageThreshold?.global;
	let summary;
	let misses;
	try {
		const parts = files.map((file) => ({ name: path.relative(root, file) || file, data: JSON.parse(readFileSync(file, "utf8")) }));
		summary = summarise(mergeCoverage(parts));
		misses = belowFloor(summary, floors);
	} catch (error) {
		console.error(`Coverage could not be checked: ${error.message}`);
		return 1;
	}
	console.log(`Coverage over ${files.length} shard${files.length === 1 ? "" : "s"}:`);
	for (const metric of METRICS) {
		const { covered, total, pct } = summary[metric];
		const floor = floors?.[metric];
		console.log(`  ${metric.padEnd(10)} ${pct.toFixed(2)}% (${covered}/${total})${floor === undefined ? "" : `, floor ${floor}%`}`);
	}
	if (misses.length === 0) return 0;
	for (const { metric, pct, floor } of misses) console.error(`The ${metric} coverage, ${pct.toFixed(2)}%, is under its floor of ${floor}%.`);
	return 1;
}

const argv = process.argv.slice(2);
if (argv[0] === "--check-only") {
	process.exit(check(argv.slice(1).map((file) => path.resolve(file))));
}

const count = shardCount();
const base = path.join(root, "coverage");
rmSync(base, { recursive: true, force: true });
const dirs = Array.from({ length: count }, (_, i) => path.join(base, `shard-${i + 1}`));
for (const dir of dirs) mkdirSync(dir, { recursive: true });

const results = await Promise.all(dirs.map((dir, i) => runShard(i + 1, count, dir)));
const failed = results.filter((result) => result.code !== 0);
for (const { index, code, signal } of failed) {
	console.error(`Shard ${index} of ${count} failed (${signal ? `signal ${signal}` : `exit code ${code}`}).`);
}
if (failed.length > 0) process.exit(1);
process.exit(check(dirs.map((dir) => path.join(dir, "coverage-final.json"))));
