import { afterEach, describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, callExport, readWorkflow, removeTempTrees, runScript, stepScript, tempTree, workflowJob } from "@tools/scriptHarness";

/**
 * The helpers the script and workflow specs share (tools/scriptHarness.ts),
 * tested on their own so a failure in a spec that uses them points at the
 * script under test rather than at the harness.
 */

afterEach(removeTempTrees);

const WORKFLOW = `name: X
on: push
jobs:
  first:
    runs-on: ubuntu-24.04
    steps:
      - name: Say hello
        run: |
          echo "hello"
          if true; then
            echo "  indented"
          fi

      - name: One line
        run: echo one
  second:
    steps:
      - name: Say hello
        run: |
          echo second
`;

describe("workflowJob", () => {
	test("returns one job's lines and stops at the next job", () => {
		const first = workflowJob(WORKFLOW, "first") ?? "";
		expect(first.startsWith("  first:")).toBe(true);
		expect(first).toContain("echo one");
		expect(first).not.toContain("second");
	});

	test("the last job runs to the end of the file", () => {
		expect(workflowJob(WORKFLOW, "second")).toContain("echo second");
	});

	test("an unknown job, a prototype word and a key that is not a job are null", () => {
		for (const id of ["third", "constructor", "__proto__", "steps", "jobs"]) expect(workflowJob(WORKFLOW, id)).toBeNull();
	});

	test("CRLF line endings are read", () => {
		expect(workflowJob(WORKFLOW.replace(/\n/g, "\r\n"), "second")).toContain("echo second");
	});
});

describe("stepScript", () => {
	test("returns a block run dedented, its own indentation kept", () => {
		expect(stepScript(workflowJob(WORKFLOW, "first") ?? "", "Say hello")).toBe('echo "hello"\nif true; then\n  echo "  indented"\nfi\n');
	});

	test("a one-line run and an unknown step are null", () => {
		const job = workflowJob(WORKFLOW, "first") ?? "";
		expect(stepScript(job, "One line")).toBeNull();
		expect(stepScript(job, "Nope")).toBeNull();
		expect(stepScript("", "Say hello")).toBeNull();
	});

	test("reads a real workflow step", () => {
		const job = workflowJob(readWorkflow("pages.yml"), "report") ?? "";
		expect(stepScript(job, "Say so in the tracker")).toContain("gh issue create");
	});
});

describe("runScript and callExport", () => {
	test("runScript returns the status and what the script printed", () => {
		const result = runScript("check-message-style.mjs", [`--root=${tempTree({ "x.txt": "" })}`]);
		expect(result.status).toBe(1);
		expect(result.out).toContain("No engine source at");
	});

	test("callExport calls a function and reads a value", () => {
		expect(callExport("remeasure-benchmarks.mjs", "median", [[1, 2, 3]])).toBe(2);
		// A value crosses as JSON, so a rule's test function is dropped and its name kept.
		expect(callExport<{ name: string; test?: unknown }[]>("check-message-style.mjs", "RULES").map((r) => [r.name, r.test])).toContainEqual(["em-dash", undefined]);
		expect(Array.isArray(callExport<{ file: string }[]>("check-message-style.mjs", "PENDING"))).toBe(true);
	});

	test("callExport carries large and hostile arguments intact", () => {
		const big = "x".repeat(300_000);
		expect(callExport("check-type-baseline.mjs", "parseDiagnostics", [big])).toEqual([]);
		expect(callExport("compare-benchmarks.mjs", "own", [{ "</script>": "${1}" }, "</script>"])).toBe("${1}");
	});

	test("callExport of a missing export or module throws with the child's error", () => {
		expect(() => callExport("no-such-script.mjs", "x")).toThrow(/failed/);
	});
});

describe("tempTree", () => {
	test("writes nested files and is removed afterwards", () => {
		const dir = tempTree({ "a/b/c.txt": "hi", "d.txt": "" });
		expect(fs.readFileSync(path.join(dir, "a/b/c.txt"), "utf8")).toBe("hi");
		removeTempTrees();
		expect(fs.existsSync(dir)).toBe(false);
	});

	test("REPO_ROOT is the repository root", () => {
		expect(fs.existsSync(path.join(REPO_ROOT, "packages/engine/package.json"))).toBe(true);
	});
});
