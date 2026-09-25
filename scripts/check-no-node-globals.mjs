/**
 * Checks that every ESM entry point of the built package loads, and the root
 * one evaluates a line, where Node's globals do not exist.
 *
 * The engine promises to run "unchanged in a browser and in a worker"
 * (versioning-and-support.md), but every other check runs the build under
 * Node, where `process`, `Buffer` and `global` are always there. A module-scope
 * read of `process.env` in Value.ts made every entry point throw "process is
 * not defined" on import in a browser tab or a module Web Worker, and nothing
 * here could see it.
 *
 * Each entry point is imported twice, each time in a fresh Node process: once
 * as Node has it, and once with those three globals deleted first, as a
 * browser has it. An entry that loads under Node and fails without the globals
 * fails this check. An entry that fails under Node too is not this check's
 * business (the worker entry expects a worker's own globals) and is reported
 * but not failed.
 *
 * Run after `npm run build`. Exits non-zero on a failure.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = resolve(root, "packages/engine");
const pkg = JSON.parse(readFileSync(resolve(engineDir, "package.json"), "utf8"));

/** Each export's ESM file, by its public path. */
const entries = Object.entries(pkg.exports)
	.map(([name, target]) => [name, typeof target === "string" ? target : target.import?.default ?? target.import])
	.filter(([, file]) => typeof file === "string" && file.endsWith(".js"));

/**
 * The script a child process runs: optionally delete the Node globals, import
 * the entry, and for the root entry evaluate one line. The result is written
 * with a stream captured before the globals go.
 */
function childScript(file, withoutGlobals, evaluate) {
	const url = pathToFileURL(resolve(engineDir, file)).href;
	return `
const write = process.stdout.write.bind(process.stdout);
const exit = process.exit.bind(process);
${withoutGlobals ? "delete globalThis.process; delete globalThis.Buffer; delete globalThis.global;" : ""}
let result;
try {
	const mod = await import(${JSON.stringify(url)});
	if (${evaluate}) {
		const value = mod.createEngine().evaluateExpression("1 + 1");
		result = "ok " + mod.formatValue(value);
	} else {
		result = "ok";
	}
} catch (error) {
	result = "FAIL " + (error && error.name ? error.name + ": " : "") + String(error && error.message ? error.message : error);
}
write(result + "\\n");
exit(0);
`;
}

function run(file, withoutGlobals, evaluate) {
	const child = spawnSync(process.execPath, ["--input-type=module", "-e", childScript(file, withoutGlobals, evaluate)], {
		encoding: "utf8",
		timeout: 60_000,
	});
	const line = (child.stdout || "").trim().split("\n").pop() || `FAIL no output (exit ${child.status}): ${(child.stderr || "").trim().split("\n").pop()}`;
	return line;
}

let failures = 0;
let loaded = 0;
for (const [name, file] of entries) {
	const evaluate = name === ".";
	const underNode = run(file, false, evaluate);
	const withoutGlobals = run(file, true, evaluate);
	if (!underNode.startsWith("ok")) {
		// The root entry must load: if it does not, the build is missing or broken,
		// and passing here would hide that behind a row of skips.
		if (name === ".") {
			failures++;
			console.log(`FAIL  ${name}: does not load under Node at all (${underNode.slice(0, 160)}); run npm run build first`);
		} else {
			console.log(`skip  ${name}: does not load under Node either (${underNode.slice(0, 120)})`);
		}
		continue;
	}
	loaded++;
	if (withoutGlobals !== underNode) {
		failures++;
		console.log(`FAIL  ${name}: under Node "${underNode}", without Node's globals "${withoutGlobals.slice(0, 200)}"`);
	} else {
		console.log(`ok    ${name}`);
	}
}

if (loaded === 0 && failures === 0) {
	failures++;
	console.log("FAIL  no entry point loaded under Node, so nothing was checked");
}
if (failures > 0) {
	console.error(`\n${failures} entry point(s) need Node's globals. Guard every module-scope read of process, Buffer and global (see Value.ts's isDevelopmentBuild).`);
	process.exit(1);
}
console.log("\nEvery entry point loads without Node's globals.");
