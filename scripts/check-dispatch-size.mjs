/**
 * Checks that the VM's dispatch loop stays under V8's optimisation ceiling.
 *
 * V8 does not optimise a function whose bytecode is longer than 61,440 bytes,
 * and `executeBytecode` (packages/engine/src/vm/VM.ts) is one large function.
 * When it crossed that line (#575), the benchmark suite reported the VM about
 * three times slower on Node 22, with no change to any opcode: the whole loop
 * had fallen back to the interpreter. The comment above the loop asks whoever
 * grows it to measure it by hand; this measures it on every run (#689).
 *
 * It measures the loop as ts-jest compiles it, which is how the benchmark job
 * runs it: a bundle reads about a quarter shorter (35,004 against 46,898 on
 * the same source), so a gate measured on a bundle would not have caught the
 * last crossing. One small spec runs under `--print-bytecode` filtered to
 * `executeBytecode`, and the first `Bytecode length` V8 prints is the figure.
 * The figure moves with the V8 version, so the Node version is printed beside
 * it; CI runs this on Node 22, the version the benchmark job uses.
 *
 * Fails above MARGIN, a little under the ceiling, so a change that lands near
 * it is noticed before one lands over it.
 *
 * Usage:
 *   node scripts/check-dispatch-size.mjs
 *
 * @module check-dispatch-size
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** V8's --max-optimized-bytecode-size. */
const CEILING = 61_440;
/** Where this check fails: far enough under the ceiling to act before crossing it. */
const MARGIN = 58_000;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jest = path.join(root, "node_modules", "jest", "bin", "jest.js");
// A small spec that runs the loop. Any would do; this one is quick and stable.
const spec = "packages/engine/__tests__/vm/VMOpcodes.spec.ts";

const child = spawnSync(
	process.execPath,
	["--print-bytecode", "--print-bytecode-filter=executeBytecode", jest, "--runInBand", "--no-coverage", spec],
	{ cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
);
const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
const match = /Bytecode length: (\d+)/.exec(output);
if (match === null) {
	console.error(`No "Bytecode length" for executeBytecode in the output (exit ${child.status}). Did the spec run?`);
	console.error(output.split("\n").filter((l) => /FAIL|Error|error/.test(l)).slice(0, 10).join("\n"));
	process.exit(1);
}
const length = Number(match[1]);
const summary = `executeBytecode is ${length.toLocaleString("en-US")} bytecode bytes on Node ${process.version}: ${(CEILING - length).toLocaleString("en-US")} under V8's ${CEILING.toLocaleString("en-US")}-byte ceiling.`;
if (length > MARGIN) {
	console.error(`${summary} That is past this check's margin of ${MARGIN.toLocaleString("en-US")}.`);
	console.error("Move opcode bodies out of the loop into module-level helpers (see the comment above executeBytecode in VM.ts).");
	process.exit(1);
}
console.log(summary);
