/**
 * Runs the built `solve` command as a real process and checks what it prints
 * and the code it exits with.
 *
 * The command's spec (`__tests__/bugs/Issue774_solveCli.spec.ts`) drives
 * `run()` in-process against the engine's source, so it cannot see anything
 * that only goes wrong once the command is bundled and started by Node: the
 * shebang, the `solve-engine` import resolving to the built engine, the exit
 * being explicit rather than waiting on a timer, standard input, and the exit
 * code reaching the shell. This is that half, after `build` in `npm run verify`.
 * Nothing here reaches the network: live data is switched off where a line
 * would ask for it.
 *
 * Usage:
 *   node scripts/smoke-cli.mjs
 *
 * @module smoke-cli
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "packages", "cli", "dist", "solve.js");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "solve-cli-smoke-"));
const failures = [];

/** Runs the command, bounded so a process that never exits fails rather than hangs. */
function solve(args, input) {
	const started = Date.now();
	const result = spawnSync(process.execPath, [bin, ...args], { input, encoding: "utf8", timeout: 30_000 });
	return { code: result.status, signal: result.signal, out: result.stdout ?? "", err: result.stderr ?? "", ms: Date.now() - started };
}

/** Writes a document into the scratch directory. */
function doc(name, text) {
	const file = path.join(scratch, name);
	fs.writeFileSync(file, text);
	return file;
}

function check(label, fn) {
	try {
		fn();
		console.log(`  ok    ${label}`);
	} catch (error) {
		console.log(`  FAIL  ${label}`);
		console.log(`        ${error.message}`);
		failures.push(label);
	}
}

function expectRun(r, code, out) {
	if (r.signal !== null) throw new Error(`killed by ${r.signal} after ${r.ms} ms: it did not exit on its own`);
	if (r.code !== code) throw new Error(`exited ${r.code}, expected ${code}; stderr: ${r.err.trim()}`);
	if (out !== undefined && r.out !== out) throw new Error(`printed ${JSON.stringify(r.out)}, expected ${JSON.stringify(out)}`);
	if (/\n\s+at /.test(r.err)) throw new Error(`printed a stack trace: ${r.err}`);
}

console.log("Smoke testing the built solve command.\n");

if (!fs.existsSync(bin)) {
	console.error(`${path.relative(root, bin)} does not exist. Run npm run build first.`);
	process.exit(1);
}

check("the bundle starts with its shebang and imports the engine rather than carrying it", () => {
	const text = fs.readFileSync(bin, "utf8");
	if (!text.startsWith("#!/usr/bin/env node\n")) throw new Error("no shebang on the first line");
	if (!/from "solve-engine"/.test(text)) throw new Error('no import from "solve-engine"');
	if (text.length > 100_000) throw new Error(`${text.length} characters: the engine was bundled in`);
});

check("an expression answers with exit 0", () => expectRun(solve(["5 km in miles"]), 0, "3.11 miles\n"));
check("a failed check exits 1", () => expectRun(solve(["check 1 == 2"]), 1, ""));
check("an unknown option exits 2", () => expectRun(solve(["--bogus"]), 2, ""));
check("an unknown --tz exits 2", () => expectRun(solve(["--tz", "Europe/Atlantis", "today"]), 2, ""));
check("a directory exits 2", () => expectRun(solve([scratch]), 2, ""));
check("a device exits 2", () => expectRun(solve(["/dev/zero"]), 2, ""));
check("--now and --tz pin the clock", () => expectRun(solve(["--now", "2026-01-01T09:00:00Z", "--tz", "Asia/Tokyo", "today"]), 0, "Thursday, January 1, 2026, 6:00:00 PM\n"));
check("--seed repeats a roll", () => {
	const a = solve(["--seed", "42", "roll(1, 1000000)"]);
	const b = solve(["--seed", "42", "roll(1, 1000000)"]);
	expectRun(a, 0);
	if (a.out !== b.out) throw new Error(`${a.out.trim()} then ${b.out.trim()}`);
});
check("--network off refuses live data, and the process still exits", () => {
	const r = solve(["--json", "--network", "off", "weather in London"]);
	expectRun(r, 1);
	if (JSON.parse(r.out).code !== "NETWORK_DISABLED") throw new Error(r.out);
});

const budget = doc("budget.md", "# Budget\n\n:price = 4\n:qty = 3\nprice * qty\ncheck price * qty == 12\ncheck price == 5\ncheck 22/7 ≈ pi within 0.1%\n");
check("a document answers one line per row", () => {
	const r = solve([budget]);
	expectRun(r, 1);
	if (!r.out.includes("5  price * qty") || !r.out.includes("= 12")) throw new Error(r.out);
});
check("solve check fails on a failing check", () => {
	const r = solve(["check", budget]);
	expectRun(r, 1);
	if (!r.out.endsWith("3 checks: 2 passed, 1 failed\n")) throw new Error(r.out);
});
check("solve check passes when every check does", () => expectRun(solve(["check", doc("pass.md", ":a = 2\ncheck a == 2\n")]), 0));
check("solve check --json parses", () => {
	const r = solve(["check", "--json", budget]);
	expectRun(r, 1);
	const body = JSON.parse(r.out);
	if (body.passed !== 2 || body.failed !== 1 || body.exitCode !== 1) throw new Error(r.out);
});
check("a document from standard input", () => expectRun(solve(["-"], ":a = 2\na * 21\n"), 0, "1  :a = 2  = 2\n2  a * 21  = 42\n"));
check("a check from standard input", () => expectRun(solve(["check", "-"], "check 1 == 2\n"), 1));

fs.rmSync(scratch, { recursive: true, force: true });

if (failures.length > 0) {
	console.log(`\n${failures.length} check(s) failed.`);
	process.exit(1);
}
console.log("\nThe built command runs, answers and exits as it should.");
