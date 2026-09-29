import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, readWorkflow, workflowJob } from "@tools/scriptHarness";

/**
 * Issue #791: `lint:size` compares the brotli figures to the byte, and those
 * bytes depend on the running Node's compression library, yet `.nvmrc` named
 * only a major and the jobs that produce or check the figures asked setup-node
 * for `22`, whichever 22.x the runner carried. `.nvmrc` now pins the exact
 * patch the committed figures reproduce on (22.22.2: `lint:size` passes on it
 * against the committed packageSize.json), those jobs read it through
 * `node-version-file`, and the mismatch note names the full version.
 *
 * The boundary: the verify and consumer matrices keep floating versions, so they
 * keep testing current patches, and the pin does not reduce how often the
 * figures change, which follows source changes.
 */

const nvmrc = fs.readFileSync(path.join(REPO_ROOT, ".nvmrc"), "utf8");

/** The setup-node `with:` block of a job, as text. */
const setupNode = (workflow: string, job: string): string => {
	const text = workflowJob(readWorkflow(workflow), job) ?? "";
	const at = text.indexOf("actions/setup-node@");
	return at === -1 ? "" : text.slice(at, text.indexOf("\n\n", at) === -1 ? undefined : text.indexOf("\n\n", at));
};

describe("the pin", () => {
	test(".nvmrc is one exact version and a newline, on the 22 line", () => {
		expect(nvmrc).toMatch(/^22\.\d+\.\d+\n$/);
	});

	test("it satisfies the engines range the package declares", () => {
		const engines = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "packages/engine/package.json"), "utf8")).engines?.node ?? ">=22";
		const floor = Number(/(\d+)/.exec(engines)?.[1] ?? 22);
		expect(Number(nvmrc.split(".")[0])).toBeGreaterThanOrEqual(floor);
	});
});

describe("the jobs that produce or check the figures read it", () => {
	test.each([
		["ci.yml", "package"],
		["publish.yml", "version"],
		["publish.yml", "publish"],
	])("%s %s", (workflow, job) => {
		const block = setupNode(workflow, job);
		expect(block).toContain("node-version-file: .nvmrc");
		expect(block).not.toMatch(/node-version: /);
	});

	test("the verify and consumer matrices still float", () => {
		for (const job of ["verify", "consumer"]) expect(setupNode("ci.yml", job)).toContain("node-version: ${{ matrix.node }}");
	});
});

describe("the size script", () => {
	const source = fs.readFileSync(path.join(REPO_ROOT, "scripts/collect-package-size.mjs"), "utf8");

	test("compares the full version, not the major", () => {
		expect(source).toContain("const running = process.versions.node;");
		expect(source).not.toMatch(/parseInt\(process\.versions\.node/);
		expect(source).not.toMatch(/parseInt\(fs\.readFileSync\(path\.join\(ROOT, "\.nvmrc"\)/);
	});

	test("reads .nvmrc with its newline and an optional leading v", () => {
		expect(source).toContain('.trim().replace(/^v/, "")');
	});
});
