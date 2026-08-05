/**
 * Fails when a workflow references an action by anything other than a commit
 * SHA.
 *
 * A tag is a mutable pointer owned by whoever publishes the action. `@v1` can be
 * repointed at any moment, with no diff, no pull request and no notification,
 * and the next run executes whatever it now points at. In `publish.yml` that
 * code runs in a job holding `id-token: write`, so it can mint a publishing
 * credential for this package.
 *
 * That is how tj-actions/changed-files was used to steal secrets from thousands
 * of repositories in March 2025: tags were repointed at a commit that dumped the
 * runner's memory into the build log. Every repository pinned to a tag was
 * affected on its next run. Every repository pinned to a SHA was not.
 *
 * Pins rot, which is a real cost and the reason Dependabot is configured to
 * accept action updates weekly. Rotting loudly, as a pull request somebody
 * reads, is the trade being made against changing silently.
 *
 * Usage:
 *   node scripts/check-action-pins.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(ROOT, ".github/workflows");

/** A 40-character hex commit SHA, which is the only immutable way to name a revision. */
const SHA = /^[0-9a-f]{40}$/;

const problems = [];
let pinned = 0;

for (const entry of fs.readdirSync(WORKFLOWS)) {
	if (!/\.ya?ml$/.test(entry)) continue;
	const file = path.join(WORKFLOWS, entry);

	fs.readFileSync(file, "utf8")
		.split(/\r?\n/)
		.forEach((line, index) => {
			const match = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)/);
			if (match === null) return;

			const reference = match[1];
			// A local action, `./.github/actions/thing`, is this repository's own
			// code and is already covered by review.
			if (reference.startsWith("./")) return;
			// A container action names an image rather than a git revision.
			if (reference.startsWith("docker://")) return;

			const at = reference.lastIndexOf("@");
			const revision = at === -1 ? "" : reference.slice(at + 1);
			if (SHA.test(revision)) {
				pinned++;
				return;
			}
			problems.push(`${entry}:${index + 1}  ${reference}`);
		});
}

if (problems.length > 0) {
	console.error("Actions must be pinned to a commit SHA, not a tag or branch.\n");
	for (const problem of problems) console.error(`  ${problem}`);
	console.error(
		"\nA tag can be repointed by whoever owns the action, with no diff and no review.\n" +
			"Resolve one with:\n" +
			"  gh api repos/OWNER/REPO/commits/TAG --jq .sha\n" +
			"and leave the version in a trailing comment so the pin stays readable.",
	);
	process.exit(1);
}

console.log(`All ${pinned} action reference(s) are pinned to a commit SHA.`);
