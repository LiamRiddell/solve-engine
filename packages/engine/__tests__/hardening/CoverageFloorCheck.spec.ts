import { afterAll, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The sharded coverage run (#890): `scripts/run-coverage.mjs` runs the
 * coverage suite in shards side by side and checks the floor once on their
 * merged counts, through `scripts/lib/coverage-floor.mjs`. Both are ES modules
 * the jest transform does not load, so the helpers are called through a child
 * `node` and the runner's `--check-only` mode is run over fixture files. The
 * suite is never started here: a real run takes the better part of an hour.
 */

const SCRIPTS = path.resolve(__dirname, "../../../../scripts");
const RUNNER = path.join(SCRIPTS, "run-coverage.mjs");
const LIB = path.join(SCRIPTS, "lib", "coverage-floor.mjs");

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

interface FileCov {
	path: string;
	statementMap: Record<string, unknown>;
	s: Record<string, number>;
	fnMap: Record<string, unknown>;
	f: Record<string, number>;
	branchMap: Record<string, unknown>;
	b: Record<string, number[]>;
}

const loc = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 10 } });

/** One source file's coverage: a statement per line with the hit counts given, one function, one two-way branch. */
function fileCoverage(file: string, statementHits: number[], fnHits = 1, branchHits: [number, number] = [1, 1]): FileCov {
	const statementMap: Record<string, unknown> = {};
	const s: Record<string, number> = {};
	statementHits.forEach((hits, i) => {
		statementMap[String(i)] = loc(i + 1);
		s[String(i)] = hits;
	});
	return {
		path: file,
		statementMap,
		s,
		fnMap: { "0": { name: "f", decl: loc(1), loc: loc(1), line: 1 } },
		f: { "0": fnHits },
		branchMap: { "0": { type: "if", loc: loc(1), locations: [loc(1), loc(1)], line: 1 } },
		b: { "0": branchHits },
	};
}

/** Calls one export of the library in a child node with JSON arguments, returning its JSON result or its error message. */
function callLib(expression: string, input: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
	const script = `
		import * as lib from ${JSON.stringify(pathToFileURL(LIB).href)};
		const input = JSON.parse(process.argv[1]);
		try {
			const value = (${expression});
			const before = Object.getOwnPropertyNames(Object.prototype).length;
			console.log(JSON.stringify({ ok: true, value, prototypeKeys: before }));
		} catch (error) {
			console.log(JSON.stringify({ ok: false, message: error.message, prototypeKeys: Object.getOwnPropertyNames(Object.prototype).length }));
		}
	`;
	const run = spawnSync(process.execPath, ["--input-type=module", "-e", script, JSON.stringify(input)], { encoding: "utf8" });
	if (run.status !== 0) throw new Error(run.stderr);
	const out = JSON.parse(run.stdout.trim().split("\n").pop()!);
	// The library must never add to Object.prototype, whatever the input.
	expect(out.prototypeKeys).toBe(PROTOTYPE_KEYS);
	return out;
}

const PROTOTYPE_KEYS = (() => {
	const run = spawnSync(process.execPath, ["-e", "console.log(Object.getOwnPropertyNames(Object.prototype).length)"], { encoding: "utf8" });
	return Number(run.stdout.trim());
})();

/** Writes coverage files to a scratch directory and returns their paths. */
function writeShards(shards: unknown[]): string[] {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-floor-"));
	dirs.push(dir);
	return shards.map((shard, i) => {
		const file = path.join(dir, `shard-${i + 1}.json`);
		fs.writeFileSync(file, typeof shard === "string" ? shard : JSON.stringify(shard));
		return file;
	});
}

function checkOnly(files: string[], env: Record<string, string> = {}) {
	return spawnSync(process.execPath, [RUNNER, "--check-only", ...files], { encoding: "utf8", env: { ...process.env, ...env } });
}

const SUMMARY = "lib.summarise(lib.mergeCoverage(input))";

describe("mergeCoverage and summarise", () => {
	test("two shards that each run half a file add up to the whole file", () => {
		const a = { "/src/a.ts": fileCoverage("/src/a.ts", [1, 1, 0, 0]) };
		const b = { "/src/a.ts": fileCoverage("/src/a.ts", [0, 0, 1, 1]) };
		const result = callLib(SUMMARY, [{ name: "a", data: a }, { name: "b", data: b }]);
		expect(result).toMatchObject({ ok: true, value: { statements: { covered: 4, total: 4, pct: 100 }, lines: { covered: 4, total: 4, pct: 100 } } });
	});

	test("hit counts are summed, not replaced, so a line run in both shards stays covered", () => {
		const a = { "/src/a.ts": fileCoverage("/src/a.ts", [3, 0]) };
		const b = { "/src/a.ts": fileCoverage("/src/a.ts", [0, 0]) };
		const result = callLib("lib.mergeCoverage(input).fileCoverageFor('/src/a.ts').toJSON().s", [{ name: "a", data: a }, { name: "b", data: b }]);
		expect(result).toEqual(expect.objectContaining({ ok: true, value: { "0": 3, "1": 0 } }));
	});

	test("files measured by different shards are all counted", () => {
		const a = { "/src/a.ts": fileCoverage("/src/a.ts", [1, 1]) };
		const b = { "/src/b.ts": fileCoverage("/src/b.ts", [0, 0]) };
		const result = callLib(SUMMARY, [{ name: "a", data: a }, { name: "b", data: b }]);
		expect(result).toMatchObject({ ok: true, value: { statements: { covered: 2, total: 4, pct: 50 } } });
	});

	test("a single shard is a valid merge of one", () => {
		const a = { "/src/a.ts": fileCoverage("/src/a.ts", [1, 0, 0, 0]) };
		expect(callLib(SUMMARY, [{ name: "a", data: a }])).toMatchObject({ ok: true, value: { statements: { pct: 25 } } });
	});

	test("no files at all is refused rather than passing", () => {
		expect(callLib(SUMMARY, [])).toEqual(expect.objectContaining({ ok: false, message: "No coverage files were given, so there is nothing to measure." }));
	});

	test("shards that measured nothing are refused, since an empty map's percentages are Unknown", () => {
		expect(callLib(SUMMARY, [{ name: "empty.json", data: {} }])).toEqual(
			expect.objectContaining({ ok: false, message: expect.stringContaining("holds no statements") }),
		);
	});

	test("a file with no branches counts as fully branch-covered", () => {
		const cov = fileCoverage("/src/a.ts", [1]);
		cov.branchMap = {};
		cov.b = {};
		expect(callLib(SUMMARY, [{ name: "a", data: { "/src/a.ts": cov } }])).toMatchObject({ ok: true, value: { branches: { total: 0, pct: 100 } } });
	});

	test.each([
		["null", null],
		["an array", []],
		["a string", "coverage"],
		["a number", 7],
	])("a file holding %s is refused by name", (_label, data) => {
		expect(callLib(SUMMARY, [{ name: "shard-2.json", data }])).toEqual(
			expect.objectContaining({ ok: false, message: "shard-2.json is not a coverage map: expected an object keyed by source path." }),
		);
	});

	test.each(["__proto__", "constructor", "prototype"])("a source path named %s is refused, and Object.prototype is untouched", (key) => {
		// JSON.parse makes "__proto__" an own key, which is how it would arrive from a file.
		const data = JSON.parse(`{${JSON.stringify(key)}: ${JSON.stringify(fileCoverage("/x", [1]))}}`);
		expect(callLib(SUMMARY, [{ name: "evil.json", data }])).toEqual(
			expect.objectContaining({ ok: false, message: expect.stringContaining(`names "${key}" as a source path`) }),
		);
	});

	test.each(["statementMap", "s", "fnMap", "f", "branchMap", "b"])("an entry missing %s is refused, naming the entry", (field) => {
		const cov: Record<string, unknown> = { ...fileCoverage("/src/a.ts", [1]) };
		delete cov[field];
		expect(callLib(SUMMARY, [{ name: "shard-1.json", data: { "/src/a.ts": cov } }])).toEqual(
			expect.objectContaining({ ok: false, message: expect.stringContaining("has an entry for /src/a.ts that is not file coverage") }),
		);
	});
});

describe("belowFloor", () => {
	const summary = { statements: { pct: 93 }, branches: { pct: 82.99 }, functions: { pct: 100 }, lines: { pct: 0 } };

	test("a figure equal to its floor passes, and one a hair under fails", () => {
		const result = callLib("lib.belowFloor(input.summary, input.floors)", { summary, floors: { statements: 93, branches: 83 } });
		expect(result).toEqual(expect.objectContaining({ ok: true, value: [{ metric: "branches", pct: 82.99, floor: 83 }] }));
	});

	test("a metric with no floor is not checked", () => {
		expect(callLib("lib.belowFloor(input.summary, input.floors)", { summary, floors: {} })).toEqual(expect.objectContaining({ ok: true, value: [] }));
	});

	test("floors of 0 and 100 are the ends of the range", () => {
		const result = callLib("lib.belowFloor(input.summary, input.floors)", { summary, floors: { functions: 100, lines: 0 } });
		expect(result).toEqual(expect.objectContaining({ ok: true, value: [] }));
	});

	test.each([
		["a string", "93"],
		["negative", -1],
		["over 100", 101],
		["null", null],
	])("a floor that is %s is refused rather than switching the check off", (_label, floor) => {
		const result = callLib("lib.belowFloor(input.summary, input.floors)", { summary, floors: { statements: floor } });
		expect(result).toEqual(expect.objectContaining({ ok: false, message: expect.stringContaining("not a percentage between 0 and 100") }));
	});

	test("a floor object that is not an object is refused", () => {
		expect(callLib("lib.belowFloor(input.summary, input.floors)", { summary, floors: null })).toEqual(
			expect.objectContaining({ ok: false, message: "The coverage floor is not an object of percentages." }),
		);
	});

	test("an inherited name in the floors is not read as a floor", () => {
		const floors = JSON.parse('{"__proto__": {"statements": 99}}');
		expect(callLib("lib.belowFloor(input.summary, input.floors)", { summary, floors })).toEqual(expect.objectContaining({ ok: true, value: [] }));
	});
});

describe("run-coverage.mjs --check-only, against the real floor in jest.coverage.config.cjs", () => {
	test("fully covered shards pass and print the whole-suite figures", () => {
		const files = writeShards([{ "/src/a.ts": fileCoverage("/src/a.ts", [1, 0]) }, { "/src/a.ts": fileCoverage("/src/a.ts", [0, 1]) }]);
		const run = checkOnly(files);
		expect(run.status).toBe(0);
		expect(run.stdout).toContain("Coverage over 2 shards:");
		expect(run.stdout).toMatch(/statements\s+100\.00% \(2\/2\), floor 93%/);
	});

	test("a drop under the floor fails and names each metric under it", () => {
		const files = writeShards([{ "/src/a.ts": fileCoverage("/src/a.ts", [1, 0, 0, 0], 0, [0, 0]) }]);
		const run = checkOnly(files);
		expect(run.status).toBe(1);
		expect(run.stderr).toContain("The statements coverage, 25.00%, is under its floor of 93%.");
		expect(run.stderr).toContain("The functions coverage, 0.00%, is under its floor of 88%.");
		expect(run.stderr).toContain("The branches coverage, 0.00%, is under its floor of 83%.");
	});

	test("a shard file that is not JSON fails with a sentence, not a stack trace", () => {
		const files = writeShards(["{ not json"]);
		const run = checkOnly(files);
		expect(run.status).toBe(1);
		expect(run.stderr).toMatch(/^Coverage could not be checked: /);
		expect(run.stderr).not.toMatch(/\n\s+at /);
	});

	test("a missing shard file fails rather than being skipped", () => {
		const run = checkOnly([path.join(os.tmpdir(), "no-such-coverage-shard.json")]);
		expect(run.status).toBe(1);
		expect(run.stderr).toMatch(/^Coverage could not be checked: .*no-such-coverage-shard\.json/);
	});

	test("no files at all fails", () => {
		const run = checkOnly([]);
		expect(run.status).toBe(1);
		expect(run.stderr).toContain("No coverage files were given");
	});
});

describe("run-coverage.mjs shard count", () => {
	test.each(["0", "17", "2.5", "three", "-1", " "])("SOLVE_COVERAGE_SHARDS=%j is refused before any shard starts", (value) => {
		const run = spawnSync(process.execPath, [RUNNER], { encoding: "utf8", env: { ...process.env, SOLVE_COVERAGE_SHARDS: value }, timeout: 20_000 });
		expect(run.status).toBe(2);
		expect(run.stderr).toContain("SOLVE_COVERAGE_SHARDS is");
		expect(run.stderr).toContain("give a whole number from 1 to 16");
	});
});
