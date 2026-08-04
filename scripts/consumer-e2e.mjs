/**
 * Installs the packed package as a real dependency and uses it like a consumer.
 *
 * The existing smoke test imports from `packages/engine/dist` directly. That
 * catches a broken build, and it did not catch `1.0.0-beta.0` shipping with no
 * `dist` in it at all, because the files it imported were sitting right there on
 * the disk of the machine running it. The tarball is the artefact; anything that
 * reads the working tree instead is testing something the user never receives.
 *
 * So this packs the package, installs the tarball into a scratch project outside
 * the repository, and runs probe scripts *from inside that project* so every
 * import resolves by bare specifier through `node_modules`, the way a consumer's
 * would. Nothing can fall back to the workspace.
 *
 * Usage:
 *   node scripts/consumer-e2e.mjs                  pack locally, then test
 *   node scripts/consumer-e2e.mjs solve-engine@1.0.0-beta.1
 *                                                  test a published version
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = path.join(ROOT, "packages/engine");
const target = process.argv[2] ?? null;

/** Runs a command and returns stdout, letting stderr through so a failure is readable. */
function run(command, args, cwd) {
	return execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		maxBuffer: 64 * 1024 * 1024,
		shell: process.platform === "win32",
	});
}

/**
 * The expected results, as source and formatted output.
 *
 * One case per capability the package advertises, rather than a single import
 * check. A partial or mis-bundled build then reports which area broke instead of
 * merely proving that a module loaded.
 */
const CASES = [
	["1024 * 8", "8,192"],
	["15% of 2400", "360"],
	["100 cm + 2 m", "300.00 cm"],
	["5 km to miles", "3.11 miles"],
	["0xFF", "255"],
	["1 << 8", "256"],
	["12 xor 10", "6"],
	["expand((x+1)*(x+2))", "x^2+3x+2"],
	["factor(x^2-4)", "(x-2)*(x+2)"],
	["solve(x^2-4=0, x)", "[-2, 2]"],
	["der(x^3, x)", "3x^2"],
	["integral(x^2, x)", "1/3x^3"],
	["cancel((x^2-1)/(x-1))", "x+1"],
	["apart((3x+5)/(x^2-1))", "4/(x-1)-1/(x+1)"],
	["solve(x^2+1=0, x)", "[-i, i]"],
	["average of 10, 20, 30", "20"],
];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "solve-consumer-"));
console.log(`consumer project: ${scratch}`);

/** What the consumer installs: a local tarball by default, or a published version when one is named. */
function dependencySpecifier() {
	if (target !== null) {
		console.log(`installing from the registry: ${target}`);
		return target;
	}
	console.log("packing the workspace package");
	const output = run("npm", ["pack", "--silent", "--pack-destination", scratch], ENGINE);
	const tarball = output.trim().split(/\r?\n/).pop();
	const full = path.join(scratch, tarball);
	console.log(`packed ${tarball} (${(fs.statSync(full).size / 1024 / 1024).toFixed(2)} MB)`);
	return `file:${full}`;
}

const specifier = dependencySpecifier();

fs.writeFileSync(
	path.join(scratch, "package.json"),
	`${JSON.stringify({ name: "solve-consumer", private: true, version: "1.0.0", type: "module" }, null, 2)}\n`,
);

// No workspace, no lockfile, no link: a plain install of one dependency, which
// is the thing being tested.
run("npm", ["install", "--no-audit", "--no-fund", "--silent", specifier], scratch);

// Probes are written into the consumer project and run from there, so
// `require("solve-engine")` and `import "solve-engine"` resolve the same way a
// consumer's would rather than through this repository.
fs.writeFileSync(
	path.join(scratch, "probe.mjs"),
	`import { ExpressionEngine } from "solve-engine";\n` +
		`import { formatValue } from "solve-engine/format";\n` +
		`const cases = ${JSON.stringify(CASES)};\n` +
		`const engine = new ExpressionEngine("en");\n` +
		`const results = cases.map(([source]) => {\n` +
		`  try { return formatValue(engine.evaluateLine(1, source)[0]).replace(/^=\\s*/, ""); }\n` +
		`  catch (error) { return "threw: " + error.message; }\n` +
		`});\n` +
		`engine.clear();\n` +
		`process.stdout.write(JSON.stringify(results));\n`,
);

fs.writeFileSync(
	path.join(scratch, "probe.cjs"),
	`const { ExpressionEngine } = require("solve-engine");\n` +
		`const { formatValue } = require("solve-engine/format");\n` +
		`const engine = new ExpressionEngine("en");\n` +
		`process.stdout.write(formatValue(engine.evaluateLine(1, "2 + 2")[0]).replace(/^=\\s*/, ""));\n` +
		`engine.clear();\n`,
);

const failures = [];
/** Records one check, collecting failures so a single run reports all of them. */
function check(description, passed, detail) {
	console.log(`  ${passed ? "ok  " : "FAIL"}  ${description}${passed || detail === undefined ? "" : ` — ${detail}`}`);
	if (!passed) failures.push(description);
}

console.log("\nESM, imported by bare specifier");
let esmResults;
try {
	esmResults = JSON.parse(run("node", ["probe.mjs"], scratch));
} catch (error) {
	console.error(`  the ESM probe did not run: ${error.message}`);
	esmResults = CASES.map(() => "probe failed to run");
}
CASES.forEach(([source, expected], index) => {
	const actual = esmResults[index];
	check(`${source}  ->  ${expected}`, actual === expected, `got ${actual}`);
});

console.log("\nCJS, required by bare specifier");
let cjsResult;
try {
	cjsResult = run("node", ["probe.cjs"], scratch).trim();
} catch (error) {
	cjsResult = `threw: ${error.message}`;
}
check('require("solve-engine") evaluates 2 + 2 -> 4', cjsResult === "4", `got ${cjsResult}`);

console.log("\nWhat actually got installed");
const installed = path.join(scratch, "node_modules/solve-engine");
const manifest = JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8"));
const distFiles = fs.existsSync(path.join(installed, "dist"))
	? fs.readdirSync(path.join(installed, "dist")).length
	: 0;

// The check that would have caught the empty publish: a package containing only
// the three files npm always adds is not a package.
check("dist is present", distFiles > 0, `${distFiles} files`);
check("subpath exports are declared", Object.keys(manifest.exports ?? {}).length > 1, `${Object.keys(manifest.exports ?? {}).length} entries`);
console.log(`  installed ${manifest.name}@${manifest.version}, ${distFiles} files in dist`);

fs.rmSync(scratch, { recursive: true, force: true });

console.log("");
if (failures.length > 0) {
	console.error(`consumer-e2e: ${failures.length} of ${CASES.length + 3} checks failed.`);
	process.exit(1);
}
console.log(`consumer-e2e: ${CASES.length + 3} checks passed against an installed copy.`);
