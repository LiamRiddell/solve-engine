/**
 * Writes the parity counts the internal audits quote.
 *
 * `SoulverParity.spec.ts` and `OtherAppsParity.spec.ts` measure how many of
 * another app's documented examples this engine answers, and the audits in
 * `docs-internal/` quote those totals. The totals used to be typed by hand and
 * drifted: one document said two examples failed where the spec asserted none
 * (#786). This runs the two specs with `PARITY_STATS_WRITE=1`, which makes each
 * write its section of `docs-internal/parity-stats.json` and rewrite every
 * `<!-- parity:<section>.<name> -->N<!-- /parity -->` marker in the audits. An
 * ordinary run of the same specs fails when the file or a marker disagrees with
 * what it measured, so the check needs no script of its own.
 *
 * In band, so the two specs do not write the file at once.
 *
 * Usage:
 *   node scripts/collect-parity-stats.mjs [extra jest arguments]
 *
 * @module collect-parity-stats
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPECS = ["packages/engine/__tests__/docs/SoulverParity.spec.ts", "packages/engine/__tests__/docs/OtherAppsParity.spec.ts"];

const result = spawnSync(
	process.execPath,
	[path.join(ROOT, "node_modules/jest/bin/jest.js"), "--no-coverage", "--runInBand", ...SPECS, ...process.argv.slice(2)],
	{ cwd: ROOT, stdio: "inherit", env: { ...process.env, PARITY_STATS_WRITE: "1" } },
);

if (result.status !== 0) {
	console.error("A parity spec failed, so the counts it wrote may be partial. Fix the failure and run this again.");
	process.exit(result.status ?? 1);
}
console.log("Wrote docs-internal/parity-stats.json and the counts the audits quote.");
