import { afterEach, describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, readWorkflow, removeTempTrees, runScript, stepScript, tempTree, workflowJob } from "@tools/scriptHarness";

/**
 * Issue #794: the publish job's consumer test installed a tarball it packed
 * and then threw away, and `npm publish --workspace` published the folder, so
 * npm ran `prepublishOnly` (a clean rebuild) and packed again: what reached the
 * registry was a second build nothing had installed. The job now packs once,
 * into a known folder, runs assert-publishable against the packed contents and
 * the consumer test against that file, and publishes that file. npm runs
 * lifecycle scripts only for a folder, so nothing rebuilds in between.
 *
 * The boundary: the pull-request `consumer` job keeps packing its own tarball
 * (it tests the tree, not a release), and `prepublishOnly` stays in
 * package.json for anyone who publishes a folder.
 */

afterEach(removeTempTrees);

const job = workflowJob(readWorkflow("publish.yml"), "publish") ?? "";

describe("the publish job", () => {
	test("packs once, then checks, installs and publishes that same file, in that order", () => {
		const order = ["run: npm run verify:ci", "- name: Pack the release tarball", "- name: Check the packed contents are publishable", "- name: Install the release tarball and use it", "- name: Publish"].map((s) => job.indexOf(s));
		expect(order.every((i) => i > 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	test("the pack step writes exactly one tarball to a known folder and hands its path on", () => {
		const script = stepScript(job, "Pack the release tarball") ?? "";
		expect(script).toContain('npm pack --workspace=packages/engine --pack-destination "${out}"');
		expect(script).toContain('if [ "${#tarballs[@]}" -ne 1 ]; then');
		expect(script).toContain('echo "tarball=${tarballs[0]}" >> "$GITHUB_OUTPUT"');
	});

	test("the checks read the packed file, not the folder", () => {
		expect(stepScript(job, "Check the packed contents are publishable")).toContain('node scripts/assert-publishable.mjs "${contents}/package"');
		expect(job).toContain('run: node scripts/consumer-e2e.mjs "file:${TARBALL}"');
	});

	test("both publish commands upload the tested file, and neither publishes the workspace folder", () => {
		const script = stepScript(job, "Publish") ?? "";
		expect(script).toContain('npm publish "${TARBALL}" --tag next');
		expect(script).toMatch(/npm publish "\$\{TARBALL\}"\n/);
		expect(script).not.toContain("--workspace");
		expect(script).not.toContain("--tag latest");
	});

	test("prepublishOnly stays as the guard for a folder publish", () => {
		const engine = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "packages/engine/package.json"), "utf8"));
		expect(engine.scripts.prepublishOnly).toBe("npm run build && node ../../scripts/assert-publishable.mjs .");
	});

	test("the pull-request consumer job still packs its own", () => {
		expect(workflowJob(readWorkflow("ci.yml"), "consumer")).toContain("run: npm run test:consumer");
	});
});

describe("consumer-e2e takes the tarball it is given", () => {
	test("a file: specifier is named as a packed tarball, not the registry", () => {
		const source = fs.readFileSync(path.join(REPO_ROOT, "scripts/consumer-e2e.mjs"), "utf8");
		expect(source).toContain('target.startsWith("file:") ? `installing the packed tarball: ${target.slice(5)}`');
	});
});

describe("assert-publishable, on unpacked contents", () => {
	const manifest = { name: "solve-engine", version: "9.9.9", files: ["dist", "LICENSE"], main: "dist/index.cjs", module: "dist/index.js", types: "dist/index.d.ts" };

	test("contents with dist and its entry points pass", () => {
		const dir = tempTree({ "package/package.json": JSON.stringify(manifest), "package/dist/index.cjs": "x", "package/dist/index.js": "x", "package/dist/index.d.ts": "x" });
		const result = runScript("assert-publishable.mjs", [path.join(dir, "package")]);
		expect(result.status).toBe(0);
	});

	test("contents packed without dist fail, naming what is missing", () => {
		const dir = tempTree({ "package/package.json": JSON.stringify(manifest), "package/LICENSE": "MIT" });
		const result = runScript("assert-publishable.mjs", [path.join(dir, "package")]);
		expect(result.status).toBe(1);
		expect(result.out).toContain("dist is listed in \"files\" but does not exist");
	});

	test("an empty dist or a zero-byte entry point fails", () => {
		const empty = tempTree({ "package/package.json": JSON.stringify({ ...manifest, main: undefined, module: undefined, types: undefined }) });
		fs.mkdirSync(path.join(empty, "package/dist"));
		expect(runScript("assert-publishable.mjs", [path.join(empty, "package")]).status).toBe(1);
		const zero = tempTree({ "package/package.json": JSON.stringify({ ...manifest, files: ["dist/index.js"] }), "package/dist/index.js": "" });
		expect(runScript("assert-publishable.mjs", [path.join(zero, "package")]).status).toBe(1);
	});

	test("a folder with no package.json fails rather than passing on nothing", () => {
		expect(runScript("assert-publishable.mjs", [tempTree()]).status).toBe(1);
	});

	test("a manifest whose files name only what npm always includes fails", () => {
		const dir = tempTree({ "package/package.json": JSON.stringify({ ...manifest, files: ["LICENSE", "README.md"] }) });
		expect(runScript("assert-publishable.mjs", [path.join(dir, "package")]).status).toBe(1);
	});
});
