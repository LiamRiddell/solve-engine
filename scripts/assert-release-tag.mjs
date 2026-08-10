/**
 * Checks a release tag against the tree it is pointing at.
 *
 * The version is read from `package.json` rather than parsed out of the tag,
 * because the tag is the thing being doubted: it is typed by a person, and the
 * tree is what actually gets packed and published.
 *
 * Usage:
 *   node scripts/assert-release-tag.mjs solve-engine@1.2.3
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "packages/engine/package.json");

const tag = process.argv[2];

/** Complains to stderr and stops. */
function fail(message) {
	console.error(message);
	process.exit(1);
}

if (!tag) fail("Usage: node scripts/assert-release-tag.mjs <tag>");

const pkg = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const expected = `${pkg.name}@${pkg.version}`;

if (tag !== expected) {
	fail(
		`This tag does not describe what is in the tree.\n` +
			`  tag:          ${tag}\n` +
			`  package.json: ${expected}\n\n` +
			"Publishing would put the tree's version on the registry under a name\n" +
			"that says otherwise, and npm does not let you take a version back. Merge\n" +
			"the version pull request first, then tag the commit it produced.",
	);
}

// Belt and braces. A version npm would reject, or one semver cannot read, is
// worth catching before the release rather than halfway through it.
if (!semver.valid(pkg.version)) {
	fail(`package.json has a version semver cannot parse: ${pkg.version}`);
}

console.log(`${tag} matches package.json.`);
