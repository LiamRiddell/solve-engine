import { afterEach, describe, expect, test } from "@jest/globals";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { REPO_ROOT, callExport, removeTempTrees, runScript, tempTree } from "@tools/scriptHarness";

/**
 * Issue #795: before a release a maintainer checked by hand whether npm had
 * the version package.json claims, whether a publish run was stuck, which
 * changesets were pending and whether `changeset version` would succeed, and on
 * 2026-09-25 the changelog named 2.38.29 and 2.39.1, which npm never had.
 * `npm run release:check` (scripts/release-check.mjs) gathers those into one
 * read-only report and drafts a release-note skeleton ending in
 * `## Verification` with the real test counts.
 *
 * The boundary: it publishes, edits and cancels nothing, and needs `gh` and the
 * network, so it is a maintainer's script and not a CI gate. The network
 * halves are exercised here through their parts; the run is exercised
 * `--offline` over fixture trees.
 */

afterEach(removeTempTrees);

const CHANGELOG = "# solve-engine\n\n## 2.41.0\n\n### Minor Changes\n\n## 2.40.0\n\n## 2.39.1\n\n## 2.39.0\n\n## 2.38.30\n\n## 2.38.29\n\n## 1.0.0-beta.7\n";

/** A fixture checkout the script can run over. */
function checkout(changesets: Record<string, string>, stats: object | string | null = { tests: 15925, suites: 618 }): string {
	const files: Record<string, string> = {
		"packages/engine/package.json": JSON.stringify({ name: "solve-engine", version: "2.41.0" }),
		"packages/engine/CHANGELOG.md": CHANGELOG,
		".changeset/README.md": "# Changesets\n",
		".changeset/config.json": "{}",
	};
	for (const [name, content] of Object.entries(changesets)) files[`.changeset/${name}`] = content;
	if (stats !== null) files["docs/src/data/testStats.json"] = typeof stats === "string" ? stats : JSON.stringify(stats);
	return tempTree(files);
}

/** Every file under a directory with its hash, to show a run changed nothing. */
function snapshot(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (d: string): void => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			const full = path.join(d, entry.name);
			if (entry.isDirectory()) walk(full);
			else out[path.relative(dir, full)] = crypto.createHash("sha1").update(fs.readFileSync(full)).digest("hex");
		}
	};
	walk(dir);
	return out;
}

const minor = "---\n\"solve-engine\": minor\n---\n\nPercentages can be written in words.\n\nMore.\n";
const patch = "---\n'solve-engine': patch\n---\n\nA fix.\n";

describe("a run over a checkout", () => {
	test("lists the pending changesets, the version they add up to, and a skeleton ending in Verification", () => {
		const root = checkout({ "percent-in-words.md": minor, "a-fix.md": patch });
		const result = runScript("release-check.mjs", [`--root=${root}`, "--offline", "--skip-version"]);
		expect(result.status).toBe(0);
		expect(result.out).toContain("patch  a-fix.md  A fix.");
		expect(result.out).toContain("minor  percent-in-words.md  Percentages can be written in words.");
		expect(result.out).toContain("together: 2.41.0 to 2.42.0.");
		expect(result.out).toContain("# solve-engine 2.42.0");
		expect(result.out).toMatch(/## Verification\n\n- 15,925 tests in 618 suites \(docs\/src\/data\/testStats\.json\), passing\./);
		expect(result.out.trimEnd().endsWith("(`test:consumer`): <result>.")).toBe(true);
	});

	test("changes nothing in the tree it reads", () => {
		const root = checkout({ "percent-in-words.md": minor });
		const before = snapshot(root);
		runScript("release-check.mjs", [`--root=${root}`, "--offline", "--skip-version"]);
		expect(snapshot(root)).toEqual(before);
	});

	test("with nothing pending, says so and keeps the version", () => {
		const result = runScript("release-check.mjs", [`--root=${checkout({})}`, "--offline", "--skip-version"]);
		expect(result.out).toContain("3. Pending changesets\n  none.");
		expect(result.out).toContain("# solve-engine 2.41.0");
	});

	test("names the skipped halves rather than passing over them", () => {
		const result = runScript("release-check.mjs", [`--root=${checkout({})}`, "--offline", "--skip-version"]);
		expect(result.out).toContain("1. npm against the changelog and the GitHub releases\n  skipped (--offline)");
		expect(result.out).toContain("2. Publish runs\n  skipped (--offline)");
		expect(result.out).toContain("skipped (--skip-version)");
	});

	test("is a root script, and not in verify:ci, since it needs the network and gh", () => {
		const scripts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).scripts;
		expect(scripts["release:check"]).toBe("node scripts/release-check.mjs");
		expect(scripts["verify:ci"]).not.toContain("release:check");
	});
});

describe("the parts", () => {
	test("changelogVersions reads every heading, prereleases included, and nothing else", () => {
		expect(callExport("release-check.mjs", "changelogVersions", [CHANGELOG])).toEqual(["2.41.0", "2.40.0", "2.39.1", "2.39.0", "2.38.30", "2.38.29", "1.0.0-beta.7"]);
		expect(callExport("release-check.mjs", "changelogVersions", ["### 1.2.3\n## Minor Changes\n## 1.2\n"])).toEqual([]);
		expect(callExport("release-check.mjs", "changelogVersions", ["## 1.2.3\r\n## 1.2.4  \n"])).toEqual(["1.2.3", "1.2.4"]);
	});

	test("missingFromNpm finds the 2026-09-25 gaps in the changelog and the releases", () => {
		const npm = ["2.38.28", "2.38.30", "2.39.0", "2.40.0"];
		const missing = callExport("release-check.mjs", "missingFromNpm", [
			{ changelog: ["2.40.0", "2.39.1", "2.39.0", "2.38.30", "2.38.29"], releases: ["solve-engine@2.40.0", "solve-engine@2.39.1", "other@1.0.0"], npm },
		]);
		expect(missing).toEqual({ changelog: ["2.39.1", "2.38.29"], releases: ["solve-engine@2.39.1"] });
	});

	test("missingFromNpm with nothing on npm lists everything, and with nothing named lists nothing", () => {
		expect(callExport("release-check.mjs", "missingFromNpm", [{ changelog: ["1.0.0"], releases: ["solve-engine@1.0.0"], npm: [] }])).toEqual({ changelog: ["1.0.0"], releases: ["solve-engine@1.0.0"] });
		expect(callExport("release-check.mjs", "missingFromNpm", [{ changelog: [], releases: [], npm: ["1.0.0"] }])).toEqual({ changelog: [], releases: [] });
	});

	test("runsToWatch finds unfinished runs and cancelled release runs", () => {
		const runs = [
			{ databaseId: 1, status: "completed", conclusion: "cancelled", event: "release" },
			{ databaseId: 2, status: "completed", conclusion: "cancelled", event: "push" },
			{ databaseId: 3, status: "in_progress", conclusion: "", event: "release" },
			{ databaseId: 4, status: "waiting", conclusion: "", event: "push" },
			{ databaseId: 5, status: "completed", conclusion: "success", event: "release" },
		];
		const watch = callExport<{ unfinished: { databaseId: number }[]; cancelledReleases: { databaseId: number }[] }>("release-check.mjs", "runsToWatch", [runs]);
		expect(watch.unfinished.map((r) => r.databaseId)).toEqual([3, 4]);
		expect(watch.cancelledReleases.map((r) => r.databaseId)).toEqual([1]);
	});

	test("pendingChangesets reads both quote styles and CRLF, and skips a changeset for another package or with no frontmatter", () => {
		const pending = callExport<{ file: string; bump: string }[]>("release-check.mjs", "pendingChangesets", [
			{ "b.md": minor, "a.md": patch.replace(/\n/g, "\r\n"), "c.md": "---\n\"solve-playground-bridge\": patch\n---\n\nx\n", "d.md": "no frontmatter\n" },
		]);
		expect(pending.map((p) => [p.file, p.bump])).toEqual([["a.md", "patch"], ["b.md", "minor"]]);
	});

	test("nextVersion: the largest bump wins, none keeps the version, and a prerelease is left to pre mode", () => {
		expect(callExport("release-check.mjs", "nextVersion", ["2.41.0", ["patch", "minor"]])).toBe("2.42.0");
		expect(callExport("release-check.mjs", "nextVersion", ["2.41.9", ["patch"]])).toBe("2.41.10");
		expect(callExport("release-check.mjs", "nextVersion", ["2.41.0", ["major", "patch"]])).toBe("3.0.0");
		expect(callExport("release-check.mjs", "nextVersion", ["2.41.0", []])).toBe("2.41.0");
		expect(callExport("release-check.mjs", "nextVersion", ["1.0.0-beta.7", ["minor"]])).toBe("1.0.0-beta.7");
	});

	test("draftNote without readable stats says so rather than inventing counts", () => {
		const note = callExport<string>("release-check.mjs", "draftNote", [{ version: "1.0.0", changesets: [], stats: null }]);
		expect(note).toContain("## Verification");
		expect(note).toContain("docs/src/data/testStats.json could not be read");
		expect(note).not.toMatch(/\d+ tests in/);
	});
});

describe("adversarial", () => {
	test("security: changeset files named for inherited properties are ordinary files", () => {
		expectPrototypeUntouched(() => {
			const files = Object.fromEntries(PROTOTYPE_WORDS.map((w) => [`${w}.md`, patch]));
			const pending = callExport<{ file: string }[]>("release-check.mjs", "pendingChangesets", [files]);
			expect(pending).toHaveLength(PROTOTYPE_WORDS.length);
		});
	});

	test("security: markup in a changeset's first line reaches the skeleton as text, and the run does not execute it", () => {
		const root = checkout({ "x.md": "---\n\"solve-engine\": patch\n---\n\n<script>alert(1)</script> $(touch pwned)\n" });
		const result = runScript("release-check.mjs", [`--root=${root}`, "--offline", "--skip-version"]);
		expect(result.out).toContain("<script>alert(1)</script> $(touch pwned)");
		expect(fs.existsSync(path.join(root, "pwned"))).toBe(false);
	});

	test("security: a very large changelog is read within budget", () => {
		const big = Array.from({ length: 20_000 }, (_, i) => `## 0.${Math.floor(i / 100)}.${i % 100}\n\ntext\n`).join("\n");
		const started = Date.now();
		expect(callExport<string[]>("release-check.mjs", "changelogVersions", [big])).toHaveLength(20_000);
		expect(Date.now() - started).toBeLessThan(20_000);
	});

	test("realistic: unreadable stats and a missing changelog still produce the report", () => {
		const root = checkout({ "a.md": patch }, "{ not json");
		fs.rmSync(path.join(root, "packages/engine/CHANGELOG.md"));
		const result = runScript("release-check.mjs", [`--root=${root}`, "--offline", "--skip-version"]);
		expect(result.status).toBe(0);
		expect(result.out).toContain("could not be read");
		expect(result.out).not.toMatch(/TypeError|RangeError/);
	});

	test("edge: an empty changeset body gives an empty summary, not a crash", () => {
		const pending = callExport<{ summary: string }[]>("release-check.mjs", "pendingChangesets", [{ "e.md": "---\n\"solve-engine\": patch\n---\n" }]);
		expect(pending).toEqual([{ file: "e.md", bump: "patch", summary: "" }]);
	});
});
