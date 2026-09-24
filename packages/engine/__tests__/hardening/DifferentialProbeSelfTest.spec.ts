/**
 * The differential harness's probe, checked against a difference it must find
 * (#572).
 *
 * `tools/differential/probe.mjs` built each engine with `new
 * ExpressionEngine("en")`, which since 2.0 registers no package, and read the
 * single Value `evaluateLine` answers as an array of them. Every answer that was
 * not an error recorded as no values at all, so two builds that disagreed about a
 * number compared as identical and the run reported nothing. A harness that
 * cannot see a change looks exactly like a release with none, which is why this
 * runs the real probe and the real report over two stand-in builds that differ
 * by one known value, and asserts the report names it.
 *
 * The builds are stand-ins rather than `packages/engine/dist`, because the suite
 * runs before the build and a stale dist would test the wrong thing.
 */

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PROBE = path.join(ROOT, "tools", "differential", "probe.mjs");
const REPORT = path.join(ROOT, "tools", "differential", "report.mjs");

/** A stand-in build: `createEngine()` whose `evaluateLine` answers from a table. */
function modernBuild(answers: Record<string, number>): string {
	return `
		export function createEngine() {
			return {
				evaluateLine(_line, source) {
					const answers = ${JSON.stringify(answers)};
					if (!(source in answers)) { const e = new Error("unknown: " + source); e.code = "UNDEFINED_VARIABLE"; throw e; }
					return { type: 0, value: answers[source], unit: undefined };
				},
				clear() {},
			};
		}
	`;
}

/** A stand-in 1.x build: no `createEngine`, a constructor that registers everything. */
function legacyBuild(answers: Record<string, number>): string {
	return `
		export class ExpressionEngine {
			evaluateLine(_line, source) {
				return { type: 0, value: ${JSON.stringify(answers)}[source], unit: undefined };
			}
			clear() {}
		}
	`;
}

const FORMAT = `export function formatValue(value) { return "= " + value.value; }`;

let scratch = "";

function writeBuild(name: string, index: string): string {
	const dir = path.join(scratch, name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "index.js"), index);
	fs.writeFileSync(path.join(dir, "format.js"), FORMAT);
	return dir;
}

const CORPUS = [
	{ source: "1 + 1", origin: "self-test" },
	{ source: "unchanged", origin: "self-test" },
	{ source: "undefined", origin: "self-test" },
];

/** Runs the real probe over the corpus against one build, and reads its records back in order. */
function probe(root: string, tag: string): unknown[] {
	const corpus = path.join(scratch, "corpus.json");
	const out = path.join(scratch, `${tag}.jsonl`);
	const result = spawnSync(process.execPath, [
		PROBE, `--root=${root}`, `--corpus=${corpus}`, `--out=${out}`, `--progress=${path.join(scratch, `${tag}.progress`)}`,
	], { encoding: "utf8" });
	expect(result.status).toBe(0);
	const records: unknown[] = new Array(CORPUS.length).fill(null);
	for (const line of fs.readFileSync(out, "utf8").split("\n")) {
		if (line === "") continue;
		const parsed = JSON.parse(line) as { i: number; record: unknown };
		records[parsed.i] = parsed.record;
	}
	return records;
}

beforeAll(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "solve-probe-self-test-"));
	// The stand-ins are ES modules, as the real dist is.
	fs.writeFileSync(path.join(scratch, "package.json"), JSON.stringify({ type: "module" }));
	fs.writeFileSync(path.join(scratch, "corpus.json"), JSON.stringify(CORPUS));
});

afterAll(() => {
	fs.rmSync(scratch, { recursive: true, force: true });
});

describe("the differential probe reports a known value change", () => {
	test("the probe records the Value evaluateLine answers, not an empty list", () => {
		const build = writeBuild("records", modernBuild({ "1 + 1": 2, unchanged: 7 }));
		const [sum] = probe(build, "records") as Array<{ ok: boolean; count: number; values: Array<{ formatted: string; typeName: string }> }>;
		expect(sum.ok).toBe(true);
		expect(sum.count).toBe(1);
		expect(sum.values[0].formatted).toBe("= 2");
		expect(sum.values[0].typeName).toBe("Number");
	});

	test("a build without createEngine is probed through its constructor", () => {
		const build = writeBuild("legacy", legacyBuild({ "1 + 1": 2 }));
		const [sum] = probe(build, "legacy") as Array<{ values: Array<{ formatted: string }> }>;
		expect(sum.values[0].formatted).toBe("= 2");
	});

	test("two builds that disagree about one number are reported as exactly that difference", () => {
		const baseline = writeBuild("baseline", modernBuild({ "1 + 1": 2, unchanged: 7 }));
		const candidate = writeBuild("candidate", modernBuild({ "1 + 1": 3, unchanged: 7 }));
		const run = {
			seed: 0,
			count: 0,
			baselineRoot: baseline,
			candidateRoot: candidate,
			corpus: CORPUS,
			baseline: probe(baseline, "baseline"),
			candidate: probe(candidate, "candidate"),
			baselineRepeat: null,
			candidateRepeat: null,
		};
		const runFile = path.join(scratch, "run.json");
		fs.writeFileSync(runFile, JSON.stringify(run));

		const report = spawnSync(process.execPath, [REPORT, `--run=${runFile}`], { encoding: "utf8" });
		expect(report.status).toBe(0);
		expect(report.stdout).toMatch(/identical\s+2/);
		expect(report.stdout).toMatch(/different\s+1/);
		expect(report.stdout).toContain("ok:Number -> ok:Number/value  (1)");
		expect(report.stdout).toContain('"1 + 1"');
		// Written beside the run it read, not over the last real run's file.
		expect(fs.existsSync(path.join(scratch, "differences.json"))).toBe(true);
	});
});
