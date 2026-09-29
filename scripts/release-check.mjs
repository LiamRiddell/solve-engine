/**
 * The release preflight: what a maintainer used to check by hand before a
 * release, gathered into one read-only report (#795).
 *
 * On 2026-09-25 the changelog and the GitHub releases named 2.38.29 and 2.39.1,
 * and npm had neither: 2.38.30 and 2.40.0 carried their changes, but nothing
 * said the two were missing, and the cancelled 2.39.1 publish run was one
 * re-run away from publishing an older version. This reports, in order:
 *
 *   1. npm's versions and dist-tags against `packages/engine/package.json`, and
 *      every changelog heading or GitHub release npm does not have;
 *   2. publish runs still queued, waiting or in progress, and release runs that
 *      were cancelled;
 *   3. the pending changesets, and the version they add up to;
 *   4. a throwaway `changeset version` in a temporary worktree with its own
 *      install, which is the one step pull-request CI never exercises (it runs
 *      only in the version job on main), removed afterwards;
 *   5. a release-note skeleton ending in `## Verification`, with the test and
 *      suite counts from `docs/src/data/testStats.json`.
 *
 * It checks and reports. It publishes nothing, edits nothing in the working
 * tree and cancels nothing, and exits 0 whatever it finds: the findings are for
 * a person to read. It needs network access for npm and `gh` for the GitHub
 * half, so it is a maintainer's script rather than a CI gate; without `gh` the
 * GitHub checks are named as skipped. The note it drafts is a skeleton, and the
 * prose is written by hand in the house voice.
 *
 * Usage:
 *   npm run release:check
 *   npm run release:check -- --skip-version   leave out the throwaway changeset version
 *   npm run release:check -- --offline        leave out npm and GitHub as well
 *   node scripts/release-check.mjs --root=<dir> --offline --skip-version
 *
 * @module release-check
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "solve-engine";

/** Run statuses GitHub uses for a run that has not finished. */
const UNFINISHED = new Set(["queued", "waiting", "in_progress", "pending", "requested"]);

/**
 * The versions a changelog has headings for, in the order they appear.
 *
 * @param text - A Changesets changelog, whose version headings are `## x.y.z`.
 * @returns Each version, prerelease suffix included.
 */
export function changelogVersions(text) {
	const out = [];
	for (const match of String(text).matchAll(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)[ \t]*$/gm)) out.push(match[1]);
	return out;
}

/**
 * The versions named in the changelog or in a GitHub release that npm does not have.
 *
 * @param input - `changelog` and `npm` version lists, and `releases` as tag names.
 * @returns The changelog versions and the release tags npm lacks, each sorted
 * as they came.
 */
export function missingFromNpm({ changelog, releases, npm }) {
	const published = new Set(npm);
	const prefix = `${PACKAGE}@`;
	return {
		changelog: changelog.filter((v) => !published.has(v)),
		releases: releases
			.filter((tag) => tag.startsWith(prefix))
			.filter((tag) => !published.has(tag.slice(prefix.length))),
	};
}

/**
 * The publish runs a maintainer should look at before releasing.
 *
 * @param runs - Runs of the publish workflow, as `gh run list --json` gives them.
 * @returns `unfinished`, the runs still queued, waiting or in progress, and
 * `cancelledReleases`, the release-triggered runs that were cancelled.
 */
export function runsToWatch(runs) {
	return {
		unfinished: runs.filter((r) => UNFINISHED.has(r.status)),
		cancelledReleases: runs.filter((r) => r.event === "release" && r.conclusion === "cancelled"),
	};
}

/**
 * The pending changesets for the engine.
 *
 * @param files - File name to content, for each `.changeset/*.md` but the README.
 * @returns One entry per changeset naming the engine: its file, bump and first line.
 */
export function pendingChangesets(files) {
	const out = [];
	for (const [file, content] of Object.entries(files)) {
		const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
		if (!match) continue;
		const bump = /["']?solve-engine["']?\s*:\s*(major|minor|patch)/.exec(match[1])?.[1];
		if (!bump) continue;
		const summary = match[2].trim().split(/\r?\n/)[0] ?? "";
		out.push({ file, bump, summary });
	}
	return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * The version the pending changesets add up to.
 *
 * @param current - The version in package.json, `x.y.z`.
 * @param bumps - Each pending changeset's bump.
 * @returns The next version, or `current` when there are no bumps. A
 * prerelease current version is returned unchanged, since Changesets' pre mode
 * decides that one.
 */
export function nextVersion(current, bumps) {
	const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
	if (!parsed || bumps.length === 0) return current;
	const [major, minor, patch] = parsed.slice(1).map(Number);
	if (bumps.includes("major")) return `${major + 1}.0.0`;
	if (bumps.includes("minor")) return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
}

/**
 * A release-note skeleton: headings and placeholders in the house shape, the
 * changesets listed for the author to write up, and the real test counts.
 *
 * @param input - `version`, `changesets` from {@link pendingChangesets}, and
 * `stats` from testStats.json (or null when it is unreadable).
 * @returns Markdown ending in a `## Verification` section.
 */
export function draftNote({ version, changesets, stats }) {
	const lines = [`# solve-engine ${version}`, "", "<One plain sentence: what this release changes for a reader.>", ""];
	for (const c of changesets) {
		lines.push(`## <${c.summary.slice(0, 80)}>`, "", `(${c.bump}, from .changeset/${c.file})`, "", "| line | before | now |", "| --- | --- | --- |", "| `<a real line>` | <a real result> | <a real result> |", "");
	}
	if (changesets.length === 0) lines.push("<No changeset is pending, so there is nothing to describe yet.>", "");
	lines.push("## Verification", "");
	if (stats && Number.isInteger(stats.tests) && Number.isInteger(stats.suites)) {
		lines.push(`- ${stats.tests.toLocaleString("en-GB")} tests in ${stats.suites.toLocaleString("en-GB")} suites (docs/src/data/testStats.json), passing.`);
	} else {
		lines.push("- <The test and suite counts: docs/src/data/testStats.json could not be read.>");
	}
	lines.push("- `npm run verify:ci`: <result>, run by the publish job before anything reached npm.");
	lines.push("- The bundled-consumer contract and the packed tarball installed and used (`test:consumer`): <result>.");
	return lines.join("\n");
}

/** Run a command, returning its stdout, or null when it could not run or failed. */
function capture(command, args, options = {}) {
	const run = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32", ...options });
	return run.status === 0 ? run.stdout : null;
}

/** Parse JSON, or return null. */
function json(text) {
	try {
		return text === null ? null : JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Run `changeset version` in a throwaway worktree of HEAD with its own install,
 * and report what it produced. The worktree is removed whatever happens, and it
 * never links this checkout's node_modules.
 */
function throwawayVersion(root) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solve-release-check-"));
	const tree = path.join(dir, "tree");
	const lines = [];
	const added = spawnSync("git", ["worktree", "add", "--detach", tree, "HEAD"], { cwd: root, encoding: "utf8" });
	if (added.status !== 0) {
		fs.rmSync(dir, { recursive: true, force: true });
		return [`  could not create a worktree: ${(added.stderr ?? "").trim()}`];
	}
	try {
		const install = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tree, encoding: "utf8", shell: process.platform === "win32" });
		if (install.status !== 0) return [`  npm ci failed in the worktree:\n${(install.stderr ?? "").trim().split("\n").slice(-5).join("\n")}`];
		const version = spawnSync("npx", ["changeset", "version"], { cwd: tree, encoding: "utf8", shell: process.platform === "win32" });
		if (version.status !== 0) {
			return [`  changeset version FAILED, so the version job on main would fail too:\n${`${version.stdout}${version.stderr}`.trim()}`];
		}
		const bumped = JSON.parse(fs.readFileSync(path.join(tree, "packages/engine/package.json"), "utf8")).version;
		const changed = capture("git", ["status", "--short"], { cwd: tree }) ?? "";
		lines.push(`  changeset version succeeded: packages/engine would be ${bumped}.`);
		for (const l of changed.split("\n").filter(Boolean)) lines.push(`    ${l.trim()}`);
		return lines;
	} finally {
		const removed = spawnSync("git", ["worktree", "remove", "--force", tree], { cwd: root, encoding: "utf8" });
		if (removed.status !== 0) spawnSync("git", ["worktree", "prune"], { cwd: root });
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function main() {
	const args = process.argv.slice(2);
	const rootArg = args.find((a) => a.startsWith("--root="));
	const root = rootArg ? path.resolve(rootArg.slice("--root=".length)) : REPO;
	const offline = args.includes("--offline");
	const skipVersion = args.includes("--skip-version");
	const out = [];
	const say = (line = "") => out.push(line);

	const manifest = JSON.parse(fs.readFileSync(path.join(root, "packages/engine/package.json"), "utf8"));
	const changelogPath = path.join(root, "packages/engine/CHANGELOG.md");
	const changelog = fs.existsSync(changelogPath) ? changelogVersions(fs.readFileSync(changelogPath, "utf8")) : [];

	say(`release:check for ${PACKAGE}, package.json at ${manifest.version}`);
	say();
	say("1. npm against the changelog and the GitHub releases");
	let releases = [];
	const hasGh = !offline && capture("gh", ["--version"]) !== null;
	if (offline) {
		say("  skipped (--offline)");
	} else {
		const view = json(capture("npm", ["view", PACKAGE, "versions", "dist-tags", "--json"]));
		if (view === null) {
			say("  npm view failed, so npm's versions are unknown. Check the network.");
		} else {
			const versions = view.versions ?? [];
			const tags = view["dist-tags"] ?? {};
			say(`  dist-tags: ${Object.entries(tags).map(([t, v]) => `${t} ${v}`).join(", ") || "(none)"}`);
			say(`  package.json ${manifest.version} is ${versions.includes(manifest.version) ? "already on npm" : "not on npm yet"}.`);
			if (hasGh) {
				const list = json(capture("gh", ["release", "list", "--limit", "200", "--json", "tagName,isDraft"], { cwd: root })) ?? [];
				releases = list.filter((r) => !r.isDraft).map((r) => r.tagName);
			}
			// The version about to be released is expected to be missing, and is
			// reported on the line above instead.
			const missing = missingFromNpm({
				changelog: changelog.filter((v) => v !== manifest.version),
				releases: releases.filter((t) => t !== `${PACKAGE}@${manifest.version}`),
				npm: versions,
			});
			say(missing.changelog.length > 0 ? `  in the changelog and not on npm: ${missing.changelog.join(", ")}` : "  every changelog version is on npm.");
			if (hasGh) say(missing.releases.length > 0 ? `  a GitHub release and not on npm: ${missing.releases.join(", ")}` : "  every GitHub release is on npm.");
			else say("  GitHub releases skipped: gh is not installed or not signed in.");
		}
	}

	say();
	say("2. Publish runs");
	if (!hasGh) {
		say(offline ? "  skipped (--offline)" : "  skipped: gh is not installed or not signed in.");
	} else {
		const runs = json(capture("gh", ["run", "list", "--workflow", "publish.yml", "--limit", "100", "--json", "databaseId,status,conclusion,event,displayTitle,createdAt,url"], { cwd: root })) ?? [];
		const { unfinished, cancelledReleases } = runsToWatch(runs);
		say(unfinished.length > 0 ? "  not finished:" : "  none queued, waiting or in progress.");
		for (const r of unfinished) say(`    ${r.databaseId}  ${r.status}  ${r.event}  ${r.displayTitle}  ${r.url}`);
		say(cancelledReleases.length > 0 ? "  release runs that were cancelled (a re-run publishes that version):" : "  no cancelled release runs.");
		for (const r of cancelledReleases) say(`    ${r.databaseId}  ${r.createdAt}  ${r.displayTitle}  ${r.url}`);
	}

	say();
	say("3. Pending changesets");
	const changesetDir = path.join(root, ".changeset");
	const files = {};
	if (fs.existsSync(changesetDir)) {
		for (const f of fs.readdirSync(changesetDir)) {
			if (f.endsWith(".md") && f !== "README.md") files[f] = fs.readFileSync(path.join(changesetDir, f), "utf8");
		}
	}
	const pending = pendingChangesets(files);
	const next = nextVersion(manifest.version, pending.map((c) => c.bump));
	if (pending.length === 0) say("  none.");
	for (const c of pending) say(`  ${c.bump.padEnd(5)}  ${c.file}  ${c.summary.slice(0, 90)}`);
	if (pending.length > 0) say(`  together: ${manifest.version} to ${next}.`);

	say();
	say("4. A throwaway changeset version, in a temporary worktree of HEAD");
	if (skipVersion) say("  skipped (--skip-version)");
	else for (const l of throwawayVersion(root)) say(l);

	say();
	say("5. A release-note skeleton");
	const stats = json(fs.existsSync(path.join(root, "docs/src/data/testStats.json")) ? fs.readFileSync(path.join(root, "docs/src/data/testStats.json"), "utf8") : null);
	say();
	say(draftNote({ version: next, changesets: pending, stats }));

	console.log(out.join("\n"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
