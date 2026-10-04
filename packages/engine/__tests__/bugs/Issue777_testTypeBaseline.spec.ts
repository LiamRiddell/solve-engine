import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { PROTOTYPE_WORDS } from "@tools/adversarial";
import { REPO_ROOT, callExport, removeTempTrees, runScript, tempTree } from "@tools/scriptHarness";

/**
 * Issue #777: the spec files and `tools/` were never type-checked. The type
 * check covered `src` only, and ts-jest transpiles each spec without checking
 * it, so 248 errors had built up, 151 of them Jest globals used with no import
 * and two of them calls to `fail`, which Jest 30 does not define.
 *
 * `npm run typecheck:tests` (scripts/check-type-baseline.mjs) now checks them
 * with TypeScript 7's tsc over packages/engine/tsconfig.tests.json, against a
 * per-file baseline that only falls. The globals are imported and the two
 * `fail` calls are gone, so the baseline starts at the 94 errors that remain.
 */

afterEach(removeTempTrees);

const TSC7 = path.join(REPO_ROOT, "node_modules/typescript7/bin/tsc");
const ENGINE = path.join(REPO_ROOT, "packages/engine");

/** The real tests and tools, compiled the way the gate compiles them. */
function compileTests(): string {
	const run = spawnSync(process.execPath, [TSC7, "--noEmit", "--pretty", "false", "-p", "tsconfig.tests.json"], {
		cwd: ENGINE,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return run.stdout;
}

/** A throwaway project: a tsconfig over its own .ts files and a baseline beside it. */
function project(files: Record<string, string>, baseline: object | string | null): { dir: string; args: string[] } {
	const tree: Record<string, string> = {
		"tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], target: "ES2020" }, include: ["*.ts"] }),
		...files,
	};
	if (baseline !== null) tree["baseline.json"] = typeof baseline === "string" ? baseline : JSON.stringify(baseline);
	const dir = tempTree(tree);
	return { dir, args: [`--project=${path.join(dir, "tsconfig.json")}`, `--baseline=${path.join(dir, "baseline.json")}`] };
}

const ONE_ERROR = "export const a: number = 'one';\n";
const TWO_ERRORS = "export const a: number = 'one';\nexport const b: string = 2;\n";
const CLEAN = "export const a: number = 1;\n";

describe("the real tests and tools", () => {
	test("no Jest global is used without its import any more", () => {
		const out = compileTests();
		expect(out).not.toMatch(/Cannot find name '(describe|test|it|expect|jest|beforeEach|afterEach|beforeAll|afterAll|fail)'/);
		expect(out).not.toMatch(/error TS2593/);
	});

	test("no spec calls fail(), which Jest 30 does not define", () => {
		const offenders: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (full.endsWith(".ts") && full !== __filename) {
					const code = fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
					if (/(^|[^.\w])fail\(/.test(code)) offenders.push(path.relative(ENGINE, full));
				}
			}
		};
		walk(path.join(ENGINE, "__tests__"));
		walk(path.join(ENGINE, "tools"));
		expect(offenders).toEqual([]);
	});

	test("the gate passes at the committed baseline", () => {
		const result = runScript("check-type-baseline.mjs");
		expect(result.out).toMatch(/type-check at the baseline: \d+ error\(s\) in \d+ file\(s\), none new/);
		expect(result.status).toBe(0);
	});

	test("the committed baseline is the 94 errors left once the globals are imported, and no more", () => {
		const baseline = JSON.parse(fs.readFileSync(path.join(ENGINE, "__tests__/typecheck-baseline.json"), "utf8"));
		const sum = Object.values(baseline.files as Record<string, number>).reduce((a, b) => a + b, 0);
		expect(baseline.total).toBe(sum);
		expect(baseline.total).toBeLessThanOrEqual(94);
	});

	test("the test tsconfig loads under tsc 5.9 without TS5090", () => {
		const run = spawnSync(process.execPath, [path.join(REPO_ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.test.json", "--listFilesOnly"], {
			cwd: ENGINE,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		expect(run.stdout).not.toMatch(/TS5090/);
	});
});

describe("the ratchet, against fixture projects", () => {
	test("the same count passes and writes nothing", () => {
		const { dir, args } = project({ "a.ts": ONE_ERROR }, { total: 1, files: { "a.ts": 1 } });
		const before = fs.readFileSync(path.join(dir, "baseline.json"), "utf8");
		const result = runScript("check-type-baseline.mjs", args);
		expect(result.status).toBe(0);
		expect(fs.readFileSync(path.join(dir, "baseline.json"), "utf8")).toBe(before);
	});

	test("one more error fails, naming the file and printing its errors", () => {
		const { args } = project({ "a.ts": TWO_ERRORS }, { total: 1, files: { "a.ts": 1 } });
		const result = runScript("check-type-baseline.mjs", args);
		expect(result.status).toBe(1);
		expect(result.out).toContain("a.ts: 2 type error(s), the baseline allows 1.");
		expect(result.out).toContain("error TS2322");
	});

	test("one fewer error passes and lowers the baseline", () => {
		const { dir, args } = project({ "a.ts": CLEAN }, { total: 1, files: { "a.ts": 1 } });
		const result = runScript("check-type-baseline.mjs", args);
		expect(result.status).toBe(0);
		expect(result.out).toMatch(/fell to 0/);
		expect(JSON.parse(fs.readFileSync(path.join(dir, "baseline.json"), "utf8"))).toEqual({ total: 0, files: {} });
	});

	test("a new error in one file cannot hide behind a fix in another", () => {
		const { args } = project({ "a.ts": CLEAN, "b.ts": ONE_ERROR }, { total: 1, files: { "a.ts": 1 } });
		const result = runScript("check-type-baseline.mjs", args);
		expect(result.status).toBe(1);
		expect(result.out).toContain("b.ts: 1 type error(s), the baseline allows 0.");
	});

	test("a missing baseline is refused with the command that creates one", () => {
		const { args } = project({ "a.ts": ONE_ERROR }, null);
		const result = runScript("check-type-baseline.mjs", args);
		expect(result.status).toBe(1);
		expect(result.out).toMatch(/No readable baseline .* --update/);
	});

	test("a malformed baseline is refused rather than read as zero", () => {
		const { args } = project({ "a.ts": ONE_ERROR }, "{ not json");
		expect(runScript("check-type-baseline.mjs", args).status).toBe(1);
	});

	test("--update writes the current counts", () => {
		const { dir, args } = project({ "a.ts": TWO_ERRORS }, null);
		expect(runScript("check-type-baseline.mjs", [...args, "--update"]).status).toBe(0);
		expect(JSON.parse(fs.readFileSync(path.join(dir, "baseline.json"), "utf8"))).toEqual({ total: 2, files: { "a.ts": 2 } });
	});

	test("a project the compiler cannot load counts as an error, not as zero", () => {
		const dir = tempTree({ "tsconfig.json": "{ \"compilerOptions\": { \"target\": \"nonsense\" }, \"include\": [\"*.ts\"] }", "a.ts": CLEAN, "baseline.json": JSON.stringify({ total: 0, files: {} }) });
		const result = runScript("check-type-baseline.mjs", [`--project=${path.join(dir, "tsconfig.json")}`, `--baseline=${path.join(dir, "baseline.json")}`]);
		expect(result.status).toBe(1);
	});
});

describe("the parts", () => {
	test("parseDiagnostics reads a file's error, a project error, and folds a continuation line", () => {
		const out = [
			"a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.",
			"  The expected type comes from here.",
			"error TS5090: Non-relative paths are not allowed.",
			"",
		].join("\n");
		const parsed = callExport<{ file: string; line: number | null; code: string; text: string }[]>("check-type-baseline.mjs", "parseDiagnostics", [out]);
		expect(parsed.map((e) => [e.file, e.line, e.code])).toEqual([["a.ts", 1, "TS2322"], ["(project)", null, "TS5090"]]);
		expect(parsed[0].text).toContain("The expected type comes from here.");
	});

	test("parseDiagnostics reads CRLF output and a file name with brackets and spaces", () => {
		const parsed = callExport<{ file: string }[]>("check-type-baseline.mjs", "parseDiagnostics", ["dir/a (1).ts(3,5): error TS2304: Cannot find name 'x'.\r\n"]);
		expect(parsed.map((e) => e.file)).toEqual(["dir/a (1).ts"]);
	});

	test("parseDiagnostics of empty or unrelated output is no errors", () => {
		expect(callExport("check-type-baseline.mjs", "parseDiagnostics", [""])).toEqual([]);
		expect(callExport("check-type-baseline.mjs", "parseDiagnostics", ["Version 7.0.2\n<script>alert(1)</script>\n"])).toEqual([]);
	});

	test("countByFile counts and sorts, and a prototype word is an ordinary file name", () => {
		const errors = [...PROTOTYPE_WORDS, "b.ts", "a.ts", "a.ts"].map((file) => ({ file }));
		const counts = callExport<Record<string, number>>("check-type-baseline.mjs", "countByFile", [errors]);
		expect(counts["a.ts"]).toBe(2);
		for (const word of PROTOTYPE_WORDS) expect(counts[word]).toBe(1);
		expect(Object.keys(counts)).toEqual([...Object.keys(counts)].sort());
	});

	test("compareCounts: over, equal and fallen, and a prototype-named file has no inherited allowance", () => {
		expect(callExport("check-type-baseline.mjs", "compareCounts", [{ "a.ts": 1 }, { "a.ts": 1 }])).toEqual({ over: [], fell: false });
		expect(callExport("check-type-baseline.mjs", "compareCounts", [{ "a.ts": 1 }, { "a.ts": 2 }])).toEqual({ over: [{ file: "a.ts", allowed: 1, count: 2 }], fell: false });
		expect(callExport("check-type-baseline.mjs", "compareCounts", [{ "a.ts": 2 }, {}])).toEqual({ over: [], fell: true });
		expect(callExport("check-type-baseline.mjs", "compareCounts", [{}, { constructor: 1, __proto__x: 1 }])).toEqual({
			over: [{ file: "constructor", allowed: 0, count: 1 }, { file: "__proto__x", allowed: 0, count: 1 }],
			fell: false,
		});
	});

	test("compareCounts at zero on both sides is neither over nor fallen", () => {
		expect(callExport("check-type-baseline.mjs", "compareCounts", [{}, {}])).toEqual({ over: [], fell: false });
	});
});
