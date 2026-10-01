/**
 * Writes `docs/public/llms.txt` and `docs/public/llms-full.txt` (#783).
 *
 * The two files are built from the cheatsheet and the proven examples by
 * `packages/engine/tools/llmsTxt.ts`, read through the collector
 * `DocExamples.spec.ts` asserts. This runs `LlmsTxt.spec.ts` with
 * `LLMS_WRITE=1`, which writes them; an ordinary run of the same spec fails
 * when the committed copies are stale, so every test run is the check.
 *
 * Usage:
 *   node scripts/generate-llms-txt.mjs [extra jest arguments]
 *
 * @module generate-llms-txt
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = "packages/engine/__tests__/docs/LlmsTxt.spec.ts";

const result = spawnSync(process.execPath, [path.join(ROOT, "node_modules/jest/bin/jest.js"), "--no-coverage", SPEC, ...process.argv.slice(2)], {
	cwd: ROOT,
	stdio: "inherit",
	env: { ...process.env, LLMS_WRITE: "1" },
});

if (result.status !== 0) {
	console.error("LlmsTxt.spec.ts failed after writing; read its failures before committing the files.");
	process.exit(result.status ?? 1);
}
console.log("Wrote docs/public/llms.txt and docs/public/llms-full.txt.");
