import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { removeTempTrees, readWorkflow, stepScript, tempTree, workflowJob } from "@tools/scriptHarness";

/**
 * Issue #792: the scheduled coverage floor and fuzz soak reported nowhere when
 * they failed, and the coverage run of 2026-09-25 was cancelled at its 90-minute
 * limit with nothing saying so. Each workflow now has pages.yml's report job:
 * one issue per workflow, reopened and commented on rather than duplicated,
 * run when the job's result is anything but success (a timeout concludes as
 * cancelled, which `failure()` alone misses), on the schedule only.
 *
 * The report steps are run here for real, in bash, with a stand-in `gh` on the
 * PATH that records what it was asked to do.
 */

afterEach(removeTempTrees);

/** A stand-in for gh: records each call, answers the lookups from the environment. */
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "issue list") printf '%s' "\${FAKE_ISSUE:-}" ;;
  "issue create"|"issue comment") cp body.md "$GH_LOG.body" ;;
  "api repos/o/r/actions/runs/7/jobs") echo 55 ;;
  "api repos/o/r/actions/jobs/55/logs") printf '%s\\n' "2026-09-29T03:00:01.000Z fuzzing from seed 424242, 20000 cases per generator per block, heap 256MB" "2026-09-29T03:04:00.000Z   FINDING [crash] seed=424300: TypeError in <script>" "2026-09-29T03:04:01.000Z ordinary line" ;;
esac
`;

/** Run a report step's script with the stand-in gh; return its calls and the body it posted. */
function report(workflow: string, env: Record<string, string>): { status: number | null; calls: string[]; body: string } {
	const job = workflowJob(readWorkflow(workflow), "report");
	const script = job === null ? null : stepScript(job, "Say so in the tracker");
	if (script === null) throw new Error(`${workflow} has no report step`);
	const dir = tempTree({ "bin/gh": FAKE_GH, "report.sh": script });
	fs.chmodSync(path.join(dir, "bin/gh"), 0o755);
	const log = path.join(dir, "gh.log");
	const run = spawnSync("bash", ["report.sh"], {
		cwd: dir,
		encoding: "utf8",
		env: {
			PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
			GH_LOG: log,
			GH_REPO: "o/r",
			GITHUB_RUN_ID: "7",
			GITHUB_REF_NAME: "main",
			RUN_URL: "https://github.com/o/r/actions/runs/7",
			...env,
		},
	});
	const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
	const body = fs.existsSync(`${log}.body`) ? fs.readFileSync(`${log}.body`, "utf8") : "";
	return { status: run.status, calls, body };
}

describe.each([
	["coverage.yml", "floor", "The scheduled coverage run did not pass"],
	["fuzz.yml", "soak", "The scheduled fuzz soak did not pass"],
])("%s", (workflow, needed, title) => {
	const job = workflowJob(readWorkflow(workflow), "report") ?? "";

	test("has a report job that needs the run and fires on any result but success, on the schedule only", () => {
		expect(job).toContain(`needs: [${needed}]`);
		expect(job).toContain(`if: always() && github.event_name == 'schedule' && needs.${needed}.result != 'success'`);
		expect(job).toMatch(/permissions:\n\s+(# .*\n\s+)*(actions: read\n\s+)?issues: write/);
	});

	test("the workflow as a whole still reads only by default", () => {
		expect(readWorkflow(workflow)).toMatch(/^permissions:\n {2}contents: read$/m);
	});

	test("opens one issue when none exists, with the run's link", () => {
		const { status, calls, body } = report(workflow, { RESULT: "failure", START_SEED: "424242" });
		expect(status).toBe(0);
		expect(calls.some((c) => c.startsWith(`issue create --title ${title} --body-file body.md --label bug`))).toBe(true);
		expect(body).toContain("Run: https://github.com/o/r/actions/runs/7");
	});

	test("reopens and comments on the existing issue rather than opening another", () => {
		const { calls } = report(workflow, { RESULT: "failure", FAKE_ISSUE: "31", START_SEED: "1" });
		expect(calls).toContain("issue reopen 31");
		expect(calls).toContain("issue comment 31 --body-file body.md");
		expect(calls.some((c) => c.startsWith("issue create"))).toBe(false);
	});

	test("a cancelled run is reported too", () => {
		const { status, body } = report(workflow, { RESULT: "cancelled", START_SEED: "1" });
		expect(status).toBe(0);
		expect(body).toMatch(/cancelled/);
	});
});

describe("coverage.yml's note", () => {
	test("says a cancelled run did not measure the floor", () => {
		expect(report("coverage.yml", { RESULT: "cancelled" }).body).toContain("was cancelled, most likely at its 300-minute limit, so the coverage floor was not measured");
	});

	test("says what a failure means, and how to reproduce it", () => {
		const { body } = report("coverage.yml", { RESULT: "failure" });
		expect(body).toContain("ended with the result `failure`");
		expect(body).toContain("npm run test:coverage");
	});
});

describe("fuzz.yml's note", () => {
	test("the soak takes its start seed from a step, so the report knows it even when the log is cut off", () => {
		const soak = workflowJob(readWorkflow("fuzz.yml"), "soak") ?? "";
		expect(soak).toContain("seed: ${{ steps.seed.outputs.seed }}");
		expect(soak).toContain("npm run fuzz -- --seed=${{ steps.seed.outputs.seed }}");
	});

	test("names the start seed and each seed the log names, with how to reproduce", () => {
		const { body } = report("fuzz.yml", { RESULT: "failure", START_SEED: "424242" });
		expect(body).toContain("Start seed: `424242`");
		expect(body).toContain("fuzzing from seed 424242");
		expect(body).toContain("FINDING [crash] seed=424300");
		expect(body).not.toContain("ordinary line");
		expect(body).toContain("npm run fuzz -- --seed=<seed>");
	});

	test("an unknown start seed and an unreadable log still post a note", () => {
		const { status, body } = report("fuzz.yml", { RESULT: "cancelled", START_SEED: "", GH_REPO: "x/y" });
		expect(status).toBe(0);
		expect(body).toContain("Start seed: `unknown`");
		expect(body).toContain("(the log named no seed, or could not be read)");
	});

	test("markup in the log is posted inside a code block, as text", () => {
		const { body } = report("fuzz.yml", { RESULT: "failure", START_SEED: "1" });
		const fence = body.indexOf("```text");
		expect(fence).toBeGreaterThan(-1);
		expect(body.indexOf("<script>")).toBeGreaterThan(fence);
	});

	test("the chosen seed stays inside the fuzzer's range", () => {
		const seedStep = (workflowJob(readWorkflow("fuzz.yml"), "soak") ?? "").split("\n").find((l) => l.includes('echo "seed=')) ?? "";
		const command = seedStep.replace(/^\s*run: /, "").replace('>> "$GITHUB_OUTPUT"', "");
		for (let i = 0; i < 20; i++) {
			const out = spawnSync("bash", ["-c", command], { encoding: "utf8" }).stdout.trim();
			const seed = Number(out.replace("seed=", ""));
			expect(Number.isInteger(seed) && seed >= 0 && seed < 1_000_000_000).toBe(true);
		}
	});
});
