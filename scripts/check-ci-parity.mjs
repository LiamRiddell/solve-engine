/**
 * Checks that every script in `npm run verify:ci` is run by a pull-request job.
 *
 * `verify:ci` is documented as the list of gates continuous integration runs,
 * and CONTRIBUTING.md and ci.yml both say the two "cannot drift because they are
 * the same list". They had drifted: `test:temporal` and `lint:jest-configs` were
 * in `verify:ci` and in no job, so the first run to meet the Pacific/Auckland
 * leg of `test:temporal` was the publish job, and that failed two releases
 * (2.38.30 and 2.40.0) near a change of clocks while pull-request CI was green
 * (#619). This makes the sentence a checked one.
 *
 * A script counts as run when a workflow that runs on `pull_request` has a
 * step running it, directly or through a script that is itself a chain of
 * `npm run` steps (`npm run verify` runs typecheck, test:ci, build and the
 * smokes). Comment lines are ignored, since the workflows mention scripts in
 * prose. The publish workflow runs `verify:ci` whole, so it is left out: it is
 * the run this check exists to get ahead of.
 *
 * Usage:
 *   node scripts/check-ci-parity.mjs
 *
 * @module check-ci-parity
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;

/** The scripts a script runs with `npm run`, or null when it is not such a chain. */
function chained(name) {
	const body = scripts[name];
	if (typeof body !== "string") return null;
	const steps = body.split("&&").map((step) => step.trim());
	const names = steps.map((step) => /^npm run ([\w:.-]+)$/.exec(step)?.[1]);
	return names.every(Boolean) ? names : null;
}

/** A script and everything it runs through `npm run` chains. */
function expand(name, into = new Set()) {
	if (into.has(name)) return into;
	into.add(name);
	for (const inner of chained(name) ?? []) expand(inner, into);
	return into;
}

const required = chained("verify:ci");
if (required === null) {
	console.error('verify:ci is not a chain of "npm run" steps, so there is nothing to compare.');
	process.exit(1);
}

const workflowDir = path.join(root, ".github", "workflows");
const run = new Set();
const read = [];
for (const file of readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
	const text = readFileSync(path.join(workflowDir, file), "utf8");
	if (!/^\s*pull_request\s*:?/m.test(text)) continue;
	read.push(file);
	for (const line of text.split("\n")) {
		if (/^\s*#/.test(line)) continue;
		for (const match of line.matchAll(/npm run ([\w:.-]+)/g)) expand(match[1], run);
	}
}

const missing = required.filter((name) => !run.has(name));
if (missing.length > 0) {
	console.error(`In verify:ci but run by no pull-request job (${read.join(", ")}): ${missing.join(", ")}`);
	console.error("Add a step for each to ci.yml, so a pull request meets the gate the publish job will.");
	process.exit(1);
}
console.log(`Every verify:ci script (${required.length}) is run by a pull-request job in ${read.join(", ")}.`);
