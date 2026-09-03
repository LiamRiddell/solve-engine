/**
 * Fails when a production dependency, or anything it pulls in, carries a
 * licence outside the allowlist.
 *
 * The published package has one runtime dependency today, and that is the
 * moment to install a check rather than the moment there are forty: a licence
 * that arrives through a transitive bump is invisible in a diff, and a
 * consumer's legal review is the wrong place to discover it.
 *
 * Walks `packages/engine/package.json`'s `dependencies` transitively through
 * the installed tree, hoisted or nested, reading each package's own manifest
 * the way Node resolves it. Development dependencies are out of scope: they
 * never ship.
 *
 * Usage:
 *   node scripts/check-licenses.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = path.join(ROOT, "packages/engine");

/**
 * Permissive licences a consumer can take on without a conversation. Adding
 * one here is a deliberate decision that belongs in a reviewed diff.
 */
const ALLOWED = new Set([
	"MIT",
	"ISC",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"Apache-2.0",
	"0BSD",
	"Unlicense",
	"CC0-1.0",
	"BlueOak-1.0.0",
]);

/** The manifest Node would resolve `name` to from `from`, walking up through node_modules. */
function manifestFor(name, from) {
	let dir = from;
	for (;;) {
		const candidate = path.join(dir, "node_modules", name, "package.json");
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/** The licence a manifest declares, in either of the shapes npm has accepted over the years. */
function licenseOf(manifest) {
	const value = manifest.license ?? manifest.licenses?.[0];
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && typeof value.type === "string") return value.type;
	return "(none declared)";
}

/**
 * Whether an SPDX expression is acceptable: every part of an `AND` must be
 * allowed, any part of an `OR` is enough.
 */
function allowed(expression) {
	const bare = expression.replace(/[()]/g, "").trim();
	if (/\sAND\s/i.test(bare)) return bare.split(/\sAND\s/i).every((part) => ALLOWED.has(part.trim()));
	return bare.split(/\sOR\s/i).some((part) => ALLOWED.has(part.trim()));
}

const problems = [];
const seen = new Set();
const visited = [];

function visit(name, from) {
	const file = manifestFor(name, from);
	if (!file) {
		problems.push(`${name}: not installed (run npm ci first)`);
		return;
	}
	const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
	const key = `${manifest.name}@${manifest.version}`;
	if (seen.has(key)) return;
	seen.add(key);

	const license = licenseOf(manifest);
	visited.push(`${key} (${license})`);
	if (!allowed(license)) problems.push(`${key}: ${license}`);

	for (const dep of Object.keys(manifest.dependencies ?? {})) visit(dep, path.dirname(file));
}

const engine = JSON.parse(fs.readFileSync(path.join(ENGINE, "package.json"), "utf8"));
for (const dep of Object.keys(engine.dependencies ?? {})) visit(dep, ENGINE);

if (problems.length > 0) {
	console.error(
		"A production dependency carries a licence outside the allowlist:\n" +
			problems.map((line) => `  ${line}`).join("\n") +
			"\nEither replace the dependency, or add the licence to ALLOWED in scripts/check-licenses.mjs in a reviewed change.",
	);
	process.exit(1);
}

console.log(`Licences are within the allowlist: ${visited.join(", ")}.`);
