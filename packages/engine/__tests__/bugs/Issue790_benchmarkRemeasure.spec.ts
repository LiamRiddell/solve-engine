import { afterEach, describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { callExport, readWorkflow, removeTempTrees, runScript, stepScript, tempTree, workflowJob } from "@tools/scriptHarness";

/**
 * Issue #790: the benchmark job failed a pull request on one measurement, and
 * the spread on identical code reaches 1.95x per case. Now the cases and suites
 * over their limit are measured again (scripts/remeasure-benchmarks.mjs), base
 * and head interleaved for three rounds, and the job fails only if the median is
 * still over. Both measurements are in the report. The thresholds and the
 * reference are unchanged, and a real regression still fails.
 *
 * The timing runs are stood in for by a runner script that writes the next
 * result from a queue, so each case here is the real script judging real result
 * files.
 */

afterEach(removeTempTrees);

const HARNESS = "mitata-1";

/** A suite result file. */
const suiteFile = (suite: string, results: Record<string, number>) =>
	JSON.stringify({ suite, harness: HARNESS, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { meanMs: v, medianMs: v }])) });

/** A stand-in for `npm run bench -- <spec>`: writes the next queued result and logs the call. */
const RUNNER = `import fs from "node:fs"; import path from "node:path";
const [tree, spec] = process.argv.slice(2);
const queueFile = path.join(tree, "queue.json");
const queue = JSON.parse(fs.readFileSync(queueFile, "utf8"));
const next = queue.shift();
fs.writeFileSync(queueFile, JSON.stringify(queue));
fs.appendFileSync(path.join(path.dirname(tree), "order.log"), path.basename(tree) + " " + spec + "\\n");
const dir = path.join(tree, "packages/engine/benchmarks/current");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, next.suite + ".json"), JSON.stringify({ suite: next.suite, harness: "${HARNESS}", results: Object.fromEntries(Object.entries(next.results).map(([k, v]) => [k, { meanMs: v, medianMs: v }])) }));
`;

const SPEC = (suite: string) => `afterAll(() => writeBenchmarkResults("${suite}", results, "ms"));\n`;

interface Setup {
	first: { reference: Record<string, Record<string, number>>; current: Record<string, Record<string, number>> };
	base: Record<string, number>[];
	head: Record<string, number>[];
	suite?: string;
	baseHasSpec?: boolean;
}

/** Fixture trees and result folders for one scenario; returns the script's arguments and the root. */
function scenario({ first, base, head, suite = "foo", baseHasSpec = true }: Setup): { args: string[]; root: string } {
	const files: Record<string, string> = { "runner.mjs": RUNNER };
	for (const [s, r] of Object.entries(first.reference)) files[`reference/${s}.json`] = suiteFile(s, r);
	for (const [s, r] of Object.entries(first.current)) files[`current/${s}.json`] = suiteFile(s, r);
	if (baseHasSpec) files[`trees/base/packages/engine/__tests__/benchmarks/${suite}Benchmarks.spec.ts`] = SPEC(suite);
	files[`trees/head/packages/engine/__tests__/benchmarks/${suite}Benchmarks.spec.ts`] = SPEC(suite);
	files["trees/base/queue.json"] = JSON.stringify(base.map((results) => ({ suite, results })));
	files["trees/head/queue.json"] = JSON.stringify(head.map((results) => ({ suite, results })));
	const root = tempTree(files);
	return {
		root,
		args: [
			`--reference=${path.join(root, "reference")}`,
			`--current=${path.join(root, "current")}`,
			`--base-tree=${path.join(root, "trees/base")}`,
			`--head-tree=${path.join(root, "trees/head")}`,
			`--runner=${path.join(root, "runner.mjs")}`,
		],
	};
}

const threeTimesSlower = { reference: { foo: { a: 1, b: 1 } }, current: { foo: { a: 3, b: 1 } } };

describe("an over-limit case is measured again", () => {
	test("noise on the first measurement clears, and the job passes", () => {
		const { args } = scenario({ first: threeTimesSlower, base: [{ a: 1, b: 1 }, { a: 1, b: 1 }, { a: 1, b: 1 }], head: [{ a: 1.1, b: 1 }, { a: 0.9, b: 1 }, { a: 1.2, b: 1 }] });
		const result = runScript("remeasure-benchmarks.mjs", [...args, "--rounds=3"]);
		expect(result.out).toContain("| foo / a | 3.00x | 1.10x, 0.90x, 1.20x | 1.10x | 2.5x | cleared: noise on the first measurement |");
		expect(result.out).toContain("All 2 item(s) cleared when measured again");
		expect(result.status).toBe(0);
	});

	test("a real regression is confirmed, and the job still fails", () => {
		const { args } = scenario({ first: threeTimesSlower, base: [{ a: 1, b: 1 }, { a: 1, b: 1 }, { a: 1, b: 1 }], head: [{ a: 3, b: 1 }, { a: 1, b: 1 }, { a: 2.8, b: 1 }] });
		const result = runScript("remeasure-benchmarks.mjs", [...args, "--rounds=3"]);
		expect(result.out).toContain("| foo / a | 3.00x | 3.00x, 1.00x, 2.80x | 2.80x | 2.5x | **confirmed regression** |");
		expect(result.status).toBe(1);
	});

	test("a suite over its geometric-mean limit is judged on its re-measured mean", () => {
		const first = { reference: { foo: { a: 1, b: 1, c: 1 } }, current: { foo: { a: 1.3, b: 1.3, c: 1.3 } } };
		const cleared = scenario({ first, base: [{ a: 1, b: 1, c: 1 }], head: [{ a: 1.05, b: 1, c: 1 }] });
		const ok = runScript("remeasure-benchmarks.mjs", [...cleared.args, "--rounds=1"]);
		expect(ok.out).toContain("| foo (geometric mean) | 1.30x | 1.02x | 1.02x | 1.25x | cleared: noise on the first measurement |");
		expect(ok.status).toBe(0);

		const confirmed = scenario({ first, base: [{ a: 1, b: 1, c: 1 }], head: [{ a: 1.4, b: 1.4, c: 1.4 }] });
		expect(runScript("remeasure-benchmarks.mjs", [...confirmed.args, "--rounds=1"]).status).toBe(1);
	});

	test("the rounds alternate which side runs first", () => {
		const { args, root } = scenario({ first: threeTimesSlower, base: [{ a: 1, b: 1 }, { a: 1, b: 1 }], head: [{ a: 1, b: 1 }, { a: 1, b: 1 }] });
		runScript("remeasure-benchmarks.mjs", [...args, "--rounds=2"]);
		const order = fs.readFileSync(path.join(root, "trees/order.log"), "utf8").trim().split("\n").map((l) => l.split(" ")[0]);
		expect(order).toEqual(["base", "head", "head", "base"]);
	});

	test("only the suite holding an over-limit case is run again", () => {
		const first = { reference: { foo: { a: 1 }, bar: { x: 1 } }, current: { foo: { a: 3 }, bar: { x: 1 } } };
		const { args, root } = scenario({ first, base: [{ a: 1 }], head: [{ a: 1 }] });
		runScript("remeasure-benchmarks.mjs", [...args, "--rounds=1"]);
		const specs = fs.readFileSync(path.join(root, "trees/order.log"), "utf8").trim().split("\n").map((l) => l.split(" ")[1]);
		expect(specs).toEqual(["packages/engine/__tests__/benchmarks/fooBenchmarks.spec.ts", "packages/engine/__tests__/benchmarks/fooBenchmarks.spec.ts"]);
	});

	test("nothing over the limit re-measures nothing", () => {
		const { args, root } = scenario({ first: { reference: { foo: { a: 1 } }, current: { foo: { a: 1.1 } } }, base: [], head: [] });
		const result = runScript("remeasure-benchmarks.mjs", args);
		expect(result.status).toBe(0);
		expect(result.out).toContain("nothing to re-measure");
		expect(fs.existsSync(path.join(root, "trees/order.log"))).toBe(false);
	});
});

describe("the first comparison still reports and fails on its own", () => {
	test("a regression exits 1 and says it is the first measurement", () => {
		const root = tempTree({ "r/foo.json": suiteFile("foo", { a: 1 }), "c/foo.json": suiteFile("foo", { a: 3 }) });
		const result = runScript("compare-benchmarks.mjs", [path.join(root, "r"), path.join(root, "c")]);
		expect(result.status).toBe(1);
		expect(result.out).toContain("### Over the limit on the first measurement");
	});

	test("no regression exits 0, a harness change exits 0, and a missing argument exits 2", () => {
		const root = tempTree({
			"r/foo.json": suiteFile("foo", { a: 1 }),
			"c/foo.json": suiteFile("foo", { a: 1.1 }),
			"old/foo.json": JSON.stringify({ suite: "foo", harness: "older", results: { a: { meanMs: 1 } } }),
		});
		expect(runScript("compare-benchmarks.mjs", [path.join(root, "r"), path.join(root, "c")]).status).toBe(0);
		expect(runScript("compare-benchmarks.mjs", [path.join(root, "old"), path.join(root, "c")]).status).toBe(0);
		expect(runScript("compare-benchmarks.mjs", []).status).toBe(2);
	});
});

describe("the workflow", () => {
	const job = workflowJob(readWorkflow("benchmarks.yml"), "compare") ?? "";

	test("benchmarks the base in a worktree with its own install, never a link to the head's", () => {
		const script = stepScript(job, "Benchmark the merge base") ?? "";
		expect(script).toContain('git worktree add --detach "$RUNNER_TEMP/base" "$base"');
		expect(script).toContain("npm ci");
		expect(script).not.toMatch(/ln -s|cp -al/);
	});

	test("re-measures only when the first comparison found a regression, and the thresholds file is untouched", () => {
		const script = stepScript(job, "Compare") ?? "";
		expect(script).toMatch(/if \[ "\$status" -eq 1 \]; then[\s\S]*remeasure-benchmarks\.mjs[\s\S]*--rounds=3/);
		expect(script).toContain("tee -a benchmark-comparison.md");
		const thresholds = JSON.parse(fs.readFileSync(path.join(__dirname, "../../benchmarks/thresholds.json"), "utf8"));
		expect([thresholds.failRatio, thresholds.suiteGeomeanFailRatio]).toEqual([2.5, 1.25]);
	});
});

describe("the parts", () => {
	test("median: odd, even, one and none", () => {
		expect(callExport("remeasure-benchmarks.mjs", "median", [[3, 1, 2]])).toBe(2);
		expect(callExport("remeasure-benchmarks.mjs", "median", [[4, 1, 2, 3]])).toBe(2.5);
		expect(callExport("remeasure-benchmarks.mjs", "median", [[7]])).toBe(7);
		expect(callExport("remeasure-benchmarks.mjs", "median", [[]])).toBeNull();
	});

	test("median sorts numerically, the largest and smallest doubles included", () => {
		expect(callExport("remeasure-benchmarks.mjs", "median", [[1e308, 5e-324, 1]])).toBe(1);
	});

	test("suiteFiles maps a suite to the spec that writes it, and ignores other files", () => {
		const root = tempTree({
			"packages/engine/__tests__/benchmarks/lexerBenchmarks.spec.ts": 'writeBenchmarkResults("lexer", r, "ms");',
			"packages/engine/__tests__/benchmarks/notes.md": 'writeBenchmarkResults("notes")',
		});
		expect(callExport("remeasure-benchmarks.mjs", "suiteFiles", [root])).toEqual({ lexer: "packages/engine/__tests__/benchmarks/lexerBenchmarks.spec.ts" });
		expect(callExport("remeasure-benchmarks.mjs", "suiteFiles", [tempTree()])).toEqual({});
	});

	test("judge: a case the second measurement could not read stays confirmed", () => {
		const first = { failingCases: [{ suite: "foo", name: "a", ratio: 3 }], failingSuites: [] };
		const [verdict] = callExport<{ confirmed: boolean; median: number | null }[]>("remeasure-benchmarks.mjs", "judge", [first, [{ base: {}, head: {} }]]);
		expect(verdict).toMatchObject({ confirmed: true, median: null });
	});

	test("judge: a ratio exactly at the limit is not over it", () => {
		const first = { failingCases: [{ suite: "foo", name: "a", ratio: 3 }], failingSuites: [] };
		const rounds = [{ base: { foo: { a: { medianMs: 1 } } }, head: { foo: { a: { medianMs: 2.5 } } } }];
		expect(callExport<{ confirmed: boolean }[]>("remeasure-benchmarks.mjs", "judge", [first, rounds])[0].confirmed).toBe(false);
	});

	test("judge: zero, negative and non-finite timings are not comparable, so they do not clear a case", () => {
		const first = { failingCases: [{ suite: "foo", name: "a", ratio: 3 }], failingSuites: [] };
		for (const bad of [0, -1, null, "fast"]) {
			const rounds = [{ base: { foo: { a: { medianMs: 1 } } }, head: { foo: { a: { medianMs: bad } } } }];
			expect(callExport<{ confirmed: boolean }[]>("remeasure-benchmarks.mjs", "judge", [first, rounds])[0].confirmed).toBe(true);
		}
	});

	test("renderVerdicts names both measurements, and a confirmed and a cleared item read differently", () => {
		const text = callExport<string>("remeasure-benchmarks.mjs", "renderVerdicts", [
			[
				{ kind: "case", suite: "s", name: "a", first: 3, rounds: [3], median: 3, limit: 2.5, confirmed: true },
				{ kind: "case", suite: "s", name: "b", first: 3, rounds: [1], median: 1, limit: 2.5, confirmed: false },
			],
			1,
		]);
		expect(text).toContain("**confirmed regression**");
		expect(text).toContain("cleared: noise on the first measurement");
		expect(text).toContain("1 of 2 item(s) are still over the limit");
	});

	test("own reads only what an object holds itself", () => {
		expect(callExport("compare-benchmarks.mjs", "own", [{ a: 1 }, "a"])).toBe(1);
		expect(callExport("compare-benchmarks.mjs", "own", [{ a: 1 }, "constructor"])).toBeNull();
		expect(callExport("compare-benchmarks.mjs", "own", [null, "a"])).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: suites and cases named for inherited properties are ordinary names", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const first = { reference: { [word]: { [word]: 1 } }, current: { [word]: { [word]: 3 } } };
				const { args } = scenario({ first, suite: word, base: [{ [word]: 1 }], head: [{ [word]: 1 }] });
				const result = runScript("remeasure-benchmarks.mjs", [...args, "--rounds=1"]);
				expect({ word, status: result.status, raw: /TypeError|RangeError/.test(result.out) }).toEqual({ word, status: 0, raw: false });
			}
		});
	});

	test("realistic: a suite new in this pull request has no base spec, so the first measurement stands", () => {
		const { args } = scenario({ first: threeTimesSlower, baseHasSpec: false, base: [], head: [{ a: 1, b: 1 }] });
		const result = runScript("remeasure-benchmarks.mjs", [...args, "--rounds=1"]);
		expect(result.out).toContain("not measured");
		expect(result.status).toBe(1);
	});

	test("edge: a bad rounds count is a usage error, not a pass", () => {
		const { args } = scenario({ first: threeTimesSlower, base: [], head: [] });
		for (const rounds of ["0", "-1", "1.5", "many"]) expect(runScript("remeasure-benchmarks.mjs", [...args, `--rounds=${rounds}`]).status).toBe(2);
	});

	test("edge: a timing under the noise floor is never over its limit", () => {
		const { args } = scenario({ first: { reference: { foo: { a: 1e-6 } }, current: { foo: { a: 1 } } }, base: [], head: [] });
		expect(runScript("remeasure-benchmarks.mjs", args).out).toContain("nothing to re-measure");
	});
});
