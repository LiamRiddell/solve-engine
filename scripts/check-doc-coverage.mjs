/**
 * Fails when an exported symbol on the public surface has no doc block.
 *
 * "Public surface" means everything outside `src/packages`, which is where the
 * language packages live. Those are internals a consumer does not import
 * directly, and they are swept separately rather than held to this gate today.
 *
 * A doc block is what appears on hover in an editor and in generated
 * documentation, so a missing one is a gap a consumer walks into rather than a
 * stylistic preference.
 *
 * Blank lines and `//#region` markers between a doc block and its symbol are
 * tolerated. Both occur legitimately, and not allowing for them made an earlier
 * version of this report a dozen symbols undocumented that were not.
 *
 * Usage:
 *   node scripts/check-doc-coverage.mjs            fail on any public gap
 *   node scripts/check-doc-coverage.mjs --count    report without failing
 */

import * as fs from "node:fs";
import * as path from "node:path";

function walk(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const f = path.join(dir, e.name);
		if (e.isDirectory()) walk(f, out);
		else if (f.endsWith(".ts")) out.push(f);
	}
	return out;
}

const gaps = {};
let pub = 0;
let priv = 0;

for (const file of walk("packages/engine/src")) {
	const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
	lines.forEach((line, i) => {
		const m = line.match(
			/^export (?:declare )?(?:const|function|class|interface|type|enum|abstract class|async function) ([A-Za-z_][A-Za-z0-9_]*)/,
		);
		if (!m) return;

		let j = i - 1;
		while (
			j >= 0 &&
			(lines[j].trim() === "" ||
				lines[j].trim().startsWith("//#region") ||
				lines[j].trim().startsWith("//#endregion"))
		) {
			j--;
		}
		if (j >= 0 && lines[j].trim().endsWith("*/")) return;

		const rel = file.split(path.sep).join("/");
		if (rel.includes("/src/packages/")) {
			priv++;
			return;
		}
		pub++;
		(gaps[rel] = gaps[rel] || []).push(m[1]);
	});
}

const countOnly = process.argv.includes("--count");

for (const [f, syms] of Object.entries(gaps).sort((a, b) => b[1].length - a[1].length)) {
	console.log(`  ${String(syms.length).padStart(2)}  ${f.replace("packages/engine/src/", "")}  [${syms.join(", ")}]`);
}

console.log(`${pub} undocumented export(s) on the public surface.`);
console.log(`${priv} inside src/packages, which this gate does not cover yet.`);

if (pub > 0 && !countOnly) {
	console.error("Every exported symbol outside src/packages needs a doc block.");
	process.exit(1);
}
