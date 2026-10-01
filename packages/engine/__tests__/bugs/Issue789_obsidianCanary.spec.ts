import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { PROTOTYPE_WORDS } from "@tools/adversarial";
import { readWorkflow, removeTempTrees, stepScript, tempTree, workflowJob } from "@tools/scriptHarness";

/**
 * Issue #789: nothing in engine CI built the Obsidian plugin, the engine's
 * primary host, so a change that broke it was learnt only after a release. The
 * `obsidian-canary` job packs the engine the run built, checks out
 * LiamRiddell/obsidian-solve at main, installs the packed engine in place of
 * the published one, and runs the plugin's build and test:ci. It is optional
 * (`continue-on-error`), reads a public repository with no token, and waits for
 * the plugin's port: while the plugin pins another major (1.1.0 today) the job
 * says so and builds nothing, and it starts building by itself once the plugin
 * moves to this engine's major.
 */

afterEach(removeTempTrees);

const job = workflowJob(readWorkflow("ci.yml"), "obsidian-canary") ?? "";

/** Run the gate step against a plugin that asks for `wanted` and an engine at `engine`. */
function gate(wanted: string | null, engine: string): { status: number | null; run: string; out: string } {
	const script = stepScript(job, "Compare the plugin's engine major with this one");
	if (script === null) throw new Error("no gate step");
	const plugin = wanted === null ? { name: "solve", dependencies: {} } : { name: "solve", dependencies: { "solve-engine": wanted } };
	const dir = tempTree({
		"gate.sh": script,
		"obsidian-solve/package.json": JSON.stringify(plugin),
		"packages/engine/package.json": JSON.stringify({ name: "solve-engine", version: engine }),
		"out.txt": "",
	});
	const result = spawnSync("bash", ["gate.sh"], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: path.join(dir, "out.txt") } });
	return { status: result.status, run: fs.readFileSync(path.join(dir, "out.txt"), "utf8").trim(), out: `${result.stdout}${result.stderr}` };
}

describe("the job", () => {
	test("exists, and cannot fail the run", () => {
		expect(job).toContain("continue-on-error: true");
	});

	test("checks out the plugin at main with no credentials, and names no secret", () => {
		expect(job).toContain("repository: LiamRiddell/obsidian-solve");
		expect(job).toContain("ref: main");
		expect(job).toContain("persist-credentials: false");
		expect(job).not.toMatch(/secrets\.|token:/);
	});

	test("installs the packed engine in the plugin, then runs the plugin's build and test:ci", () => {
		const install = stepScript(job, "Install the packed engine in the plugin") ?? "";
		expect(install).toContain("npm pack --workspace=packages/engine");
		expect(install).toContain('npm install --no-save "${RUNNER_TEMP}"/canary/*.tgz');
		expect(job).toMatch(/- name: Build the plugin[\s\S]*run: npm run build/);
		expect(job).toMatch(/- name: Test the plugin[\s\S]*run: npm run test:ci/);
	});

	test("every build step waits on the gate", () => {
		const steps = job.split("\n      - ").slice(1).filter((s) => !s.startsWith("uses:") && !s.startsWith("name: Compare"));
		for (const step of steps) expect(step).toContain("if: steps.gate.outputs.run == 'true'");
	});
});

describe("the gate", () => {
	test("waits while the plugin pins another major, and says so", () => {
		const result = gate("1.1.0", "2.41.0");
		expect(result.run).toBe("run=false");
		expect(result.out).toContain("::notice::obsidian-solve pins solve-engine 1.1.0, not major 2");
	});

	test("builds once the plugin asks for this major, however the range is written", () => {
		for (const wanted of ["2.41.0", "^2.40.0", "~2.41.0", ">=2.0.0"]) expect({ wanted, run: gate(wanted, "2.41.0").run }).toEqual({ wanted, run: "run=true" });
	});

	test("a plugin with no engine dependency, or a non-version one, waits rather than failing", () => {
		for (const wanted of [null, "file:../engine", "latest", ""]) {
			const result = gate(wanted, "2.41.0");
			expect({ wanted, status: result.status, run: result.run }).toEqual({ wanted, status: 0, run: "run=false" });
		}
	});

	test("a prerelease engine is compared by its major", () => {
		expect(gate("^3.0.0", "3.0.0-beta.1").run).toBe("run=true");
	});

	test("a hostile dependency value is read as text", () => {
		for (const wanted of [...PROTOTYPE_WORDS, "$(touch pwned)", "`id`", "1; rm -rf /"]) {
			const result = gate(wanted, "2.41.0");
			expect({ wanted, run: result.run }).toEqual({ wanted, run: "run=false" });
		}
	});
});
