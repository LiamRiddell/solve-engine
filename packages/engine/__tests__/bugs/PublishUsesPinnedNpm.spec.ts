import { afterEach, describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, readWorkflow, removeTempTrees, tempTree, workflowJob } from "@tools/scriptHarness";

/**
 * The 2.44.0 publish failed on its first step, before anything reached npm:
 * `npm install -g npm@12.0.2`, run by the npm that ships with the pinned Node,
 * made the running npm replace its own files part-way through, and the old npm
 * then asked for a module the new one no longer ships ("Cannot find module
 * 'promise-retry'"). It was the first publish on the Node `.nvmrc` pins, so the
 * step had never run there.
 *
 * The pinned npm is now installed beside the runner's, in its own directory,
 * by `scripts/use-pinned-npm.sh`, and put first on the PATH. The publish job
 * and the pull-request `package` job both run that script on the same Node, so
 * a break is met on a pull request and not in the middle of a release.
 *
 * The boundary: this checks the wiring and the script's refusals; whether the
 * install works on a runner is what the `package` job proves on every pull
 * request.
 */

afterEach(removeTempTrees);

const SCRIPT = path.join(REPO_ROOT, "scripts", "use-pinned-npm.sh");
const script = fs.readFileSync(SCRIPT, "utf8");
const publish = readWorkflow("publish.yml");
const ci = readWorkflow("ci.yml");

/** The lines of a workflow that are not comments, since the comments explain the old command. */
const code = (text: string): string => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

describe("the pinned npm", () => {
	test("is installed beside the runner's npm, never over it", () => {
		for (const [name, text] of [["publish.yml", publish], ["ci.yml", ci], ["use-pinned-npm.sh", script]] as const) {
			expect({ name, replacesItself: /npm install (-g|--global)[^\n]*npm@/.test(code(text)) }).toEqual({ name, replacesItself: false });
		}
		expect(code(script)).toContain('npm install --prefix "$dir"');
		expect(code(script)).toContain('>> "$github_path"');
	});

	test("the publish job and the package job both run the script, and the script holds the one pin", () => {
		const publishJob = workflowJob(publish, "publish") ?? "";
		const packageJob = workflowJob(ci, "package") ?? "";
		expect(publishJob).toContain("run: sh scripts/use-pinned-npm.sh");
		expect(packageJob).toContain("run: sh scripts/use-pinned-npm.sh");
		expect(script).toMatch(/^version="\d+\.\d+\.\d+"$/m);
		for (const text of [publish, ci]) expect(code(text)).not.toMatch(/npm@\d/);
	});

	test("runs before the first npm command that needs it, in both jobs", () => {
		for (const [job, first] of [[workflowJob(publish, "publish") ?? "", "run: npm ci"], [workflowJob(ci, "package") ?? "", "run: npm ci"]] as const) {
			expect(job.indexOf("scripts/use-pinned-npm.sh")).toBeGreaterThan(-1);
			expect(job.indexOf("scripts/use-pinned-npm.sh")).toBeLessThan(job.indexOf(first));
		}
	});

	test("is version 11.5.1 or newer, which trusted publishing needs", () => {
		const [major, minor, patch] = (script.match(/^version="(\d+)\.(\d+)\.(\d+)"$/m) ?? []).slice(1).map(Number);
		expect(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)))).toBe(true);
	});
});

describe("adversarial: outside a GitHub Actions job", () => {
	const run = (env: Record<string, string>) => {
		const dir = tempTree({});
		return spawnSync("sh", [SCRIPT], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env, TMPDIR: dir } });
	};

	test("refuses with a message when RUNNER_TEMP is not set, before installing anything", () => {
		const result = run({});
		expect(result.status).not.toBe(0);
		expect(`${result.stderr}${result.stdout}`).toContain("RUNNER_TEMP is not set");
	});

	test("refuses when GITHUB_PATH is not set, before installing anything it could not then use", () => {
		const temp = tempTree({});
		const result = run({ RUNNER_TEMP: temp });
		expect(result.status).not.toBe(0);
		expect(`${result.stderr}${result.stdout}`).toContain("GITHUB_PATH is not set");
		expect(fs.readdirSync(temp)).toEqual([]);
	});
});
