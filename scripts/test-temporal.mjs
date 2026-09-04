/**
 * Runs the date and time suites under the `Temporal` calendar backend, in one
 * or more time zones.
 *
 * The suites are the ones that already pin every date and time behaviour
 * against the `Date` backend. Run with `SOLVE_CALENDAR=temporal`, every engine
 * they build through `newTrackedEngine()` computes on the `Temporal` backend
 * instead (see `packages/engine/tools/trackedEngine.ts`), so the same
 * assertions prove the second backend without a second copy of the specs,
 * and the differential suite under `__tests__/temporal/` compares the two
 * backends directly on top of that.
 *
 * A zone is set on the spawned process, not on this one: Node reads `TZ`
 * once, when it starts, so setting `process.env.TZ` inside a running test
 * does nothing. Each zone named is a separate jest run, because the whole
 * point of a second zone is that the daylight-saving days and the offsets
 * are different ones.
 *
 * Usage:
 *   node scripts/test-temporal.mjs                       polyfill, the host's zone
 *   node scripts/test-temporal.mjs --tz=Europe/London,Pacific/Auckland
 *   node scripts/test-temporal.mjs --native              the runtime's own Temporal
 *
 * `--native` uses `globalThis.Temporal`: unflagged on Node 26, and behind
 * `--harmony-temporal` on Node 24, which this passes along when the current
 * process has no Temporal of its own. Node 22 has none at all and the run
 * fails saying so rather than quietly falling back to the polyfill.
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The suites that pin date and time behaviour, by path prefix or name. */
const SUITES = [
	"packages/engine/__tests__/temporal/",
	"packages/engine/__tests__/calendar/",
	"packages/engine/__tests__/hardening/DateTime",
	"packages/engine/__tests__/packages/datetime/",
	"packages/engine/__tests__/packages/time/",
	"packages/engine/__tests__/packages/stocks/",
	"packages/engine/__tests__/packages/currency/",
	"packages/engine/__tests__/packages/finance/",
	"packages/engine/__tests__/vm/BusinessDays",
	"packages/engine/__tests__/vm/HolidayCalendar",
	"packages/engine/__tests__/format/",
	"packages/engine/__tests__/docs/DocExamples",
	"packages/engine/__tests__/engine/CalendarBackendOption",
	"packages/engine/__tests__/worker/",
	"packages/engine/__tests__/integration/",
];

const args = process.argv.slice(2);
const native = args.includes("--native");
const zoneArg = args.find((arg) => arg.startsWith("--tz="));
const zones = zoneArg ? zoneArg.slice("--tz=".length).split(",").filter(Boolean) : [null];

/**
 * The V8 flag Node 24 keeps Temporal behind. Needed only when asked for the
 * native implementation on a process that has none; a Node 26 has it
 * unflagged, and passing the flag there would be a no-op the log would have
 * to explain.
 */
const needsHarmonyFlag = native && typeof globalThis.Temporal === "undefined";

for (const zone of zones) {
	const env = {
		...process.env,
		SOLVE_CALENDAR: "temporal",
		SOLVE_TEMPORAL: native ? "native" : "polyfill",
	};
	if (zone !== null) env.TZ = zone;

	const execArgv = ["--expose-gc"];
	if (needsHarmonyFlag) execArgv.push("--harmony-temporal");

	const jestArgs = ["node_modules/jest/bin/jest.js", "--no-coverage", ...SUITES];
	// A V8 flag on the parent does not reach jest's worker processes, so the
	// flagged run stays in one process.
	if (needsHarmonyFlag) jestArgs.splice(1, 0, "--runInBand");

	console.log(
		`\ntest-temporal: ${native ? "native Temporal" : "temporal-polyfill"}, zone ${zone ?? "(host)"}` +
			(needsHarmonyFlag ? ", with --harmony-temporal" : ""),
	);
	const result = spawnSync(process.execPath, [...execArgv, ...jestArgs], { cwd: ROOT, env, stdio: "inherit" });
	if (result.status !== 0) {
		console.error(`test-temporal: the run in zone ${zone ?? "(host)"} failed.`);
		process.exit(result.status ?? 1);
	}
}

console.log(`\ntest-temporal: ${zones.length} zone run(s) passed under the ${native ? "native" : "polyfilled"} Temporal backend.`);
