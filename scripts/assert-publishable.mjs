/**
 * Refuses to publish a package with no code in it.
 *
 * `solve-engine@1.0.0-beta.0` went to npm containing three files: LICENSE,
 * package.json and README.md. Those are the ones npm includes whatever `files`
 * says, so what actually shipped was nothing at all. `files` lists `dist`, the
 * build had not run, and npm packed the absence without comment.
 *
 * Nothing caught it. `publint` and `arethetypeswrong` both passed, because they
 * were run against a tarball built moments earlier in a different job; the
 * publish itself happened somewhere else. A version cannot be replaced once it
 * is on the registry, so the check has to sit in the publish, not near it.
 *
 * Wired as `prepublishOnly`, which npm runs for `npm publish` and not for
 * `npm pack`. That is the boundary that matters: packing is done repeatedly by
 * the size and lint tooling, and making every one of those rebuild would be a
 * tax for no protection.
 *
 * Usage:
 *   node scripts/assert-publishable.mjs <packageDir>
 */

import * as fs from "node:fs";
import * as path from "node:path";

const packageDir = path.resolve(process.argv[2] ?? ".");
const manifestPath = path.join(packageDir, "package.json");

if (!fs.existsSync(manifestPath)) {
	console.error(`assert-publishable: no package.json at ${manifestPath}`);
	process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

/** Every path the manifest promises to ship, minus the ones npm adds by itself. */
const promised = (manifest.files ?? []).filter(
	entry => !/^(LICENSE|README|package\.json)/i.test(entry),
);

if (promised.length === 0) {
	console.error(
		"assert-publishable: package.json has no `files` entries beyond the ones npm always includes.\n" +
			"Publishing would produce a package with no code in it.",
	);
	process.exit(1);
}

const problems = [];

for (const entry of promised) {
	const target = path.join(packageDir, entry);
	if (!fs.existsSync(target)) {
		problems.push(`${entry} is listed in "files" but does not exist. Run the build first.`);
		continue;
	}
	const stat = fs.statSync(target);
	if (stat.isDirectory() && fs.readdirSync(target).length === 0) {
		problems.push(`${entry} exists but is empty.`);
	}
	if (stat.isFile() && stat.size === 0) {
		problems.push(`${entry} exists but is zero bytes.`);
	}
}

// The entry points are what a consumer actually reaches for, and a `dist` that
// exists but is missing them is the same failure wearing a hat.
for (const field of ["main", "module", "types"]) {
	const declared = manifest[field];
	if (typeof declared !== "string") continue;
	if (!fs.existsSync(path.join(packageDir, declared))) {
		problems.push(`"${field}" points at ${declared}, which does not exist.`);
	}
}

if (problems.length > 0) {
	console.error(`assert-publishable: ${manifest.name} is not publishable.\n`);
	for (const problem of problems) console.error(`  - ${problem}`);
	console.error("\nNothing was published. Build, then publish.");
	process.exit(1);
}

console.log(`assert-publishable: ${manifest.name}@${manifest.version} has ${promised.join(", ")} and its entry points.`);
