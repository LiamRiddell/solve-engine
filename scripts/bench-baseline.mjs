/**
 * Runs the benchmark suites with baseline writing enabled.
 *
 * A wrapper rather than an inline `SOLVE_BENCH_BASELINE=1 npm run bench`,
 * because that syntax is a shell feature that Windows does not have, and the
 * only development machine here is Windows. Adding cross-env for one variable
 * is not worth a dependency.
 *
 * This is the only thing that sets the variable. Continuous integration never
 * does, which is what stops a routine run overwriting the reference it is meant
 * to be measured against.
 */

import { spawn } from "node:child_process";

const child = spawn(
	process.execPath,
	[
		"--expose-gc",
		// Must match the `bench` script's own flags in package.json. mitata is
		// ESM-only and loaded through a real dynamic import (tools/testUtils.ts's
		// loadMeasure), which throws "A dynamic import callback was invoked
		// without --experimental-vm-modules" under Jest without this. Omitting it
		// here failed every measuring suite while still writing the baselines the
		// run was meant to produce, so the reference data silently became garbage.
		"--experimental-vm-modules",
		"node_modules/jest/bin/jest.js",
		"--config",
		"jest.bench.config.cjs",
		"--runInBand",
		...process.argv.slice(2),
	],
	{
		stdio: "inherit",
		env: { ...process.env, SOLVE_BENCH_BASELINE: "1" },
	},
);

child.on("exit", (code) => process.exit(code ?? 1));
