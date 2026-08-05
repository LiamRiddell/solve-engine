/**
 * Checks a release tag against the tree it is pointing at, and works out which
 * npm dist-tag the release belongs on.
 *
 * Both answers come from here so they cannot disagree. The version is read from
 * `package.json` rather than parsed out of the tag, because the tag is the thing
 * being doubted: it is typed by a person, and the tree is what actually gets
 * packed and published.
 *
 * The dist-tag matters more than it looks. `1.0.0-beta.2` was published to
 * `latest` because the publish command defaults there and nobody passed
 * anything else, which left `beta` pointing at `1.0.0-beta.0`, a release that
 * was published empty and fails on import. Deriving it means a prerelease
 * cannot silently become the version a plain `npm install` picks up.
 *
 * Usage:
 *   node scripts/assert-release-tag.mjs solve-engine@1.2.3
 *   node scripts/assert-release-tag.mjs solve-engine@1.2.3 --dist-tag
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "packages/engine/package.json");

const tag = process.argv[2];
const wantsDistTag = process.argv.includes("--dist-tag");

/** Complains to stderr and stops. stdout stays clean for `--dist-tag`. */
function fail(message) {
	console.error(message);
	process.exit(1);
}

if (!tag) fail("Usage: node scripts/assert-release-tag.mjs <tag> [--dist-tag]");

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

/**
 * Which dist-tag this version belongs on.
 *
 * A prerelease takes its own identifier, so `1.0.0-beta.3` goes to `beta` and
 * `2.0.0-rc.1` goes to `rc`. Only a stable version is allowed to become
 * `latest`, which is what a plain `npm install` resolves to.
 *
 * The numeric case is the one worth being careful about. Semver allows
 * `1.0.0-1`, whose prerelease identifier is the number 1 rather than a name, and
 * treating "no name" as "not a prerelease" would send it to `latest`. It is
 * still a prerelease, so it goes somewhere no plain install will find it.
 */
const prerelease = semver.prerelease(pkg.version);
let distTag = "latest";
if (prerelease) distTag = typeof prerelease[0] === "string" ? prerelease[0] : "prerelease";

if (wantsDistTag) {
	// The only thing on stdout, because the workflow captures it.
	process.stdout.write(distTag);
} else {
	console.log(`${tag} matches package.json. It will publish to the '${distTag}' dist-tag.`);
}
