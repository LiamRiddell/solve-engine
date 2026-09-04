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
import { collectExamples, collectDocBlocks, groupExamples } from "../tools/docExampleCorpus.mjs";

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
	`import { createEngine } from "solve-engine";\n` +
		`import { formatValue } from "solve-engine/format";\n` +
		`const cases = ${JSON.stringify(CASES)};\n` +
		`const engine = createEngine("en");\n` +
		`const results = cases.map(([source]) => {\n` +
		`  try { return formatValue(engine.evaluateLine(1, source)).replace(/^=\\s*/, ""); }\n` +
		`  catch (error) { return "threw: " + error.message; }\n` +
		`});\n` +
		`engine.clear();\n` +
		`process.stdout.write(JSON.stringify(results));\n`,
);

fs.writeFileSync(
	path.join(scratch, "probe.cjs"),
	`const { createEngine } = require("solve-engine");\n` +
		`const { formatValue } = require("solve-engine/format");\n` +
		`const engine = createEngine("en");\n` +
		`process.stdout.write(formatValue(engine.evaluateLine(1, "2 + 2")).replace(/^=\\s*/, ""));\n` +
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

// The Temporal entry, by bare specifier. No polyfill is installed into the
// scratch project, deliberately: the check is that the entry resolves in
// both module systems, that it shares one EngineError class with the root
// (a coded error from it is an `instanceof` the consumer can test), and,
// where the runtime ships a Temporal, that a date computed through the
// backend matches the Date backend's answer.
fs.writeFileSync(
	path.join(scratch, "probe-temporal.mjs"),
	[
		'import { createEngine } from "solve-engine";',
		'import { formatValue } from "solve-engine/format";',
		'import { EngineError } from "solve-engine/errors";',
		'import { createTemporalCalendar } from "solve-engine/temporal";',
		"const out = { entry: typeof createTemporalCalendar, coded: null, sharedClass: null, native: null };",
		"try { createTemporalCalendar({}); } catch (e) { out.coded = e.code; out.sharedClass = e instanceof EngineError; }",
		'if (typeof globalThis.Temporal !== "undefined") {',
		'  const withDate = formatValue(createEngine("en").evaluateExpression("31/01/2024 + 1 month"));',
		'  const withTemporal = formatValue(createEngine({ locale: "en", calendar: createTemporalCalendar(globalThis.Temporal) }).evaluateExpression("31/01/2024 + 1 month"));',
		"  out.native = withDate === withTemporal ? withTemporal : `date ${withDate} temporal ${withTemporal}`;",
		"}",
		"process.stdout.write(JSON.stringify(out), () => process.exit(0));",
	].join("\n"),
);
fs.writeFileSync(
	path.join(scratch, "probe-temporal.cjs"),
	'const { createTemporalCalendar } = require("solve-engine/temporal");\nprocess.stdout.write(typeof createTemporalCalendar);\n',
);

console.log("\nTemporal entry, by bare specifier");
let temporalProbe = { entry: "probe failed to run", coded: null, sharedClass: null, native: null };
try {
	temporalProbe = JSON.parse(run("node", ["probe-temporal.mjs"], scratch));
} catch (error) {
	console.error(`  the Temporal probe did not run: ${error.message}`);
}
check('import { createTemporalCalendar } from "solve-engine/temporal" resolves', temporalProbe.entry === "function", `got ${temporalProbe.entry}`);
check("a non-Temporal is refused with TEMPORAL_IMPLEMENTATION_INVALID", temporalProbe.coded === "TEMPORAL_IMPLEMENTATION_INVALID", `got ${temporalProbe.coded}`);
check("that error is an instanceof the root EngineError", temporalProbe.sharedClass === true, `got ${temporalProbe.sharedClass}`);
if (temporalProbe.native !== null) {
	check("31/01/2024 + 1 month agrees between the Date and the native Temporal backends", temporalProbe.native === "= Thursday, February 29, 2024", `got ${temporalProbe.native}`);
} else {
	console.log("  skip  no native Temporal on this Node; the backend is exercised by the polyfilled jest run");
}
let temporalCjs;
try {
	temporalCjs = run("node", ["probe-temporal.cjs"], scratch).trim();
} catch (error) {
	temporalCjs = `threw: ${error.message}`;
}
check('require("solve-engine/temporal") resolves', temporalCjs === "function", `got ${temporalCjs}`);

console.log("\nCJS, required by bare specifier");
let cjsResult;
try {
	cjsResult = run("node", ["probe.cjs"], scratch).trim();
} catch (error) {
	cjsResult = `threw: ${error.message}`;
}
check('require("solve-engine") evaluates 2 + 2 -> 4', cjsResult === "4", `got ${cjsResult}`);

// -- The documented corpus, against the installed package -----------------
//
// The cases above are a smoke test. This is the real one: every example the
// documentation asserts, with the results the docs already commit to, executed
// against what npm serves rather than against `src`. It is the same corpus
// `__tests__/docs/DocExamples.spec.ts` runs, so the two agreeing is the actual
// claim being made: that the packaged bundle behaves like the source it was
// built from.
console.log("\nDocumented examples, against the installed package");

const docsDir = path.join(ROOT, "docs/src/content/docs");
const readme = path.join(ROOT, "README.md");
const corpus = collectExamples(docsDir, [readme]);
const groups = groupExamples(corpus);
const docBlocks = collectDocBlocks(docsDir, [readme]);

// Asserted lines come from both kinds: a per-line ```solve line with a `//`, and
// a ```solve-doc row with one. The consumer must prove both, through the entry
// point each is written for.
const assertedLine = corpus.filter(example => example.expected !== null);
const assertedDocRows = docBlocks.flatMap(block =>
	block.rows.filter(row => row.expected !== null).map(row => ({ ...row, file: block.file })),
);
const asserted = [...assertedLine, ...assertedDocRows];

// A third implementation of the same parsing rule lives in
// collect-test-stats.mjs, and its result is committed. If any of the three
// drifts, the corpus quietly shrinks and this run keeps passing on less, so the
// counts are compared rather than trusted. That script walks the docs tree
// only, so README examples are excluded from the comparison.
const stats = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/src/data/testStats.json"), "utf8"));
const assertedInDocs = asserted.filter(example => !example.file.endsWith("README.md")).length;
check(
	`the corpus matches the committed count (${stats.docExamples})`,
	assertedInDocs === stats.docExamples,
	`collected ${assertedInDocs}`,
);

// ── Per-line ```solve blocks, through the single-expression path ──────────
fs.writeFileSync(path.join(scratch, "corpus.json"), JSON.stringify(groups));
fs.writeFileSync(
	path.join(scratch, "probe-docs.mjs"),
	[
		'import { createEngine } from "solve-engine";',
		'import { formatValue } from "solve-engine/format";',
		'import { readFileSync } from "node:fs";',
		'const groups = JSON.parse(readFileSync("corpus.json", "utf8"));',
		"const results = [];",
		"for (const group of groups) {",
		'  const engine = createEngine("en");',
		"  group.forEach((example, index) => {",
		"    let actual = null;",
		"    try {",
		"      const value = engine.evaluateLine(index + 1, example.expression);",
		// Double backslash: this string is source that gets written to a file, so
		// the regex needs to survive one round of escaping to reach the probe as
		// `\s`. Written singly it reaches the probe as `s`, which matches the
		// letter and leaves the leading space on every result.
		'      if (example.expected !== null) actual = formatValue(value).replace(/^=\\s*/, "");',
		'    } catch (error) { actual = "threw: " + error.message; }',
		"    if (example.expected !== null) results.push({ file: example.file, line: example.line, expression: example.expression, expected: example.expected, actual });",
		"  });",
		"  engine.clear();",
		"}",
		// Exit once the results are flushed rather than waiting for the event
		// loop to drain. A live line (weather) leaves an in-flight fetch and the
		// engine's batcher timers open, which would otherwise keep this probe
		// process alive long after it has produced its answer.
		"process.stdout.write(JSON.stringify(results), () => process.exit(0));",
	].join("\n"),
);

// ── Whole-document ```solve-doc blocks, as one document ───────────────────
// The same routing the docs harness and the live notepad use: a table stays on
// the batch pass (which skips its rows), everything else goes through
// evaluateDocument, the only path that can re-run a line for goal seek. Both are
// public API on the installed package, which is the point of proving them here.
fs.writeFileSync(path.join(scratch, "docblocks.json"), JSON.stringify(docBlocks));
fs.writeFileSync(
	path.join(scratch, "probe-docblocks.mjs"),
	[
		'import { createEngine } from "solve-engine";',
		'import { ValueType } from "solve-engine";',
		'import { evaluateDocument } from "solve-engine/engine";',
		'import { formatValue } from "solve-engine/format";',
		'import { readFileSync } from "node:fs";',
		'const blocks = JSON.parse(readFileSync("docblocks.json", "utf8"));',
		"const results = [];",
		"for (const block of blocks) {",
		'  const engine = createEngine("en");',
		'  const source = block.rows.map(row => row.expression).join("\\n");',
		'  const hasTable = block.rows.some(row => row.expression.startsWith("|"));',
		"  let parsed = null;",
		"  try {",
		'    parsed = hasTable ? engine.parseDocument(source, { inputType: "markdown" }) : evaluateDocument(engine, source, { inputType: "markdown" });',
		"  } catch (error) {",
		"    for (const row of block.rows) if (row.expected !== null) results.push({ file: block.file, line: row.line, expression: row.expression, expected: row.expected, actual: \"threw: \" + error.message });",
		"    engine.clear();",
		"    continue;",
		"  }",
		"  block.rows.forEach((row, index) => {",
		"    if (row.expected === null) return;",
		"    const parsedLine = parsed.lines[index];",
		"    let actual;",
		'    if (parsedLine && parsedLine.error) actual = "ERROR: " + parsedLine.error;',
		// A refusal reaches the line as an error-TYPED Value rather than as a
		// parse error, and the docs mark both the same way. Without this the two
		// harnesses disagreed about a refused date: the in-repo one wrote
		// "ERROR: ..." and this one wrote the bare sentence.
		'    else if (parsedLine && parsedLine.result) { const shown = formatValue(parsedLine.result).replace(/^=\\s*/, ""); actual = parsedLine.result.type === ValueType.Error ? "ERROR: " + shown : shown; }',
		'    else actual = "(no result)";',
		"    results.push({ file: block.file, line: row.line, expression: row.expression, expected: row.expected, actual });",
		"  });",
		"  engine.clear();",
		"}",
		// Force-exit after flushing, as the per-line probe does: a live weather
		// line leaves a fetch and batcher timers open that would hold the process.
		"process.stdout.write(JSON.stringify(results), () => process.exit(0));",
	].join("\n"),
);

let docResults = [];
try {
	docResults = JSON.parse(run("node", ["probe-docs.mjs"], scratch));
} catch (error) {
	console.error(`  the per-line documentation probe did not run: ${error.message}`);
}
let docBlockResults = [];
try {
	docBlockResults = JSON.parse(run("node", ["probe-docblocks.mjs"], scratch));
} catch (error) {
	console.error(`  the whole-document probe did not run: ${error.message}`);
}
const allDocResults = [...docResults, ...docBlockResults];

const mismatches = allDocResults.filter(result => result.actual !== result.expected);
check(
	`${allDocResults.length} documented examples evaluate as documented`,
	allDocResults.length === asserted.length && mismatches.length === 0,
	mismatches.length > 0 ? `${mismatches.length} mismatched` : `ran ${allDocResults.length} of ${asserted.length}`,
);
for (const bad of mismatches.slice(0, 12)) {
	console.log(`        ${path.relative(ROOT, bad.file)}:${bad.line}  ${bad.expression}`);
	console.log(`          expected ${bad.expected}`);
	console.log(`          actual   ${bad.actual}`);
}
if (mismatches.length > 12) console.log(`        ...and ${mismatches.length - 12} more`);

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
	console.error(`consumer-e2e: ${failures.length} of ${CASES.length + 9} checks failed.`);
	process.exit(1);
}
console.log(`consumer-e2e: ${CASES.length + 9} checks passed against an installed copy, including ${docResults.length} documented examples.`);
