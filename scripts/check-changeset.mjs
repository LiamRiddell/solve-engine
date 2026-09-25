/**
 * Checks that a change to the engine's source carries a changeset.
 *
 * A changeset is what puts a change into the changelog and the version bump.
 * The pull-request template asks for one as a checkbox, and nothing checked the
 * box, so a pull request that changed engine behaviour and forgot one shipped
 * in the next version with no entry (#691). This fails when the branch changes
 * a file under packages/engine/src and adds no .changeset/*.md.
 *
 * A refactor or a test-only change that should not bump the version opts out
 * with the `no-changeset` label, which ci.yml reads before running this.
 *
 * Usage:
 *   node scripts/check-changeset.mjs [base]    base defaults to origin/main
 *
 * @module check-changeset
 */

import { spawnSync } from "node:child_process";

const base = process.argv[2] ?? "origin/main";

const diff = spawnSync("git", ["diff", "--name-status", `${base}...HEAD`], { encoding: "utf8" });
if (diff.status !== 0) {
	console.error(`Could not compare with ${base}: ${(diff.stderr ?? "").trim()}. Fetch it first (actions/checkout with fetch-depth: 0).`);
	process.exit(1);
}
const rows = diff.stdout.split("\n").filter(Boolean).map((line) => line.split("\t"));
const touchesSource = rows.some(([, file]) => file?.startsWith("packages/engine/src/"));
const addsChangeset = rows.some(([status, file]) => status === "A" && /^\.changeset\/[^/]+\.md$/.test(file ?? "") && !file.endsWith("README.md"));

if (touchesSource && !addsChangeset) {
	console.error("This branch changes packages/engine/src and adds no changeset.");
	console.error('Add one with "npx changeset", or label the pull request no-changeset if the change should not reach the changelog.');
	process.exit(1);
}
console.log(touchesSource ? "The engine source changes, and a changeset is added." : "No engine source changes, so no changeset is needed.");
