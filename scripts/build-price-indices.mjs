/**
 * Regenerates every bundled price index from its recorded source: the US
 * CPI-U (`build-cpi-table.mjs`, #700), the UK ONS series CDKO
 * (`build-uk-cpi-table.mjs`, #756) and the euro-area HICP
 * (`build-euro-hicp-table.mjs`, #756). This is what `npm run data:cpi` runs.
 *
 * With no arguments each table is rebuilt from the snapshot committed beside
 * its script, and with `--check` each is compared with it instead, the run
 * failing when any one differs. Each builder is run in turn, so one refusal
 * does not hide another's result.
 *
 * The options that pick a source (`--from-bls`, `--from-ons`, `--from-ecb`,
 * `--from-csv`, `--from-mirror`, `--save-csv`, `--out`, `--retrieved`) belong
 * to one index each, so they are taken only with `--index=us`, `--index=uk` or
 * `--index=euro`, and refused otherwise: a path meant for one table must not
 * reach the other two.
 *
 * Usage:
 *   npm run data:cpi                               rebuild every table
 *   npm run data:cpi -- --check                    exit 1 when any committed table differs
 *   npm run data:cpi -- --index=uk --from-ons --save-csv=scripts/fixtures/cpi
 *
 * @module build-price-indices
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { run as runUs } from "./build-cpi-table.mjs";
import { run as runUk } from "./build-uk-cpi-table.mjs";
import { run as runEuro } from "./build-euro-hicp-table.mjs";

/** The builders, by the name `--index` takes. */
export const BUILDERS = Object.freeze({ us: runUs, uk: runUk, euro: runEuro });

/** The arguments every builder takes; anything else names one index's source. */
const SHARED = new Set(["--check"]);

/**
 * Run the builders the arguments ask for.
 *
 * @param args - The arguments, as `process.argv.slice(2)`.
 * @returns The exit status: 0 when every builder succeeded, 1 otherwise.
 */
export async function run(args) {
	const pick = args.find((a) => a.startsWith("--index="));
	const rest = args.filter((a) => a !== pick);
	let names = Object.keys(BUILDERS);
	if (pick !== undefined) {
		const name = pick.slice("--index=".length);
		if (!Object.hasOwn(BUILDERS, name)) {
			console.error(`CPI_UNKNOWN_INDEX: --index takes ${names.join(", ")}, not "${name.slice(0, 20)}"`);
			return 1;
		}
		names = [name];
	} else {
		const own = rest.filter((a) => !SHARED.has(a));
		if (own.length > 0) {
			console.error(`CPI_OPTION_NEEDS_INDEX: ${own[0].slice(0, 40)} belongs to one index; name it with --index=${Object.keys(BUILDERS).join("|")}`);
			return 1;
		}
	}
	let status = 0;
	for (const name of names) {
		if ((await BUILDERS[name](rest)) !== 0) status = 1;
	}
	return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await run(process.argv.slice(2));
