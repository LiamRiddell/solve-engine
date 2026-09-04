/**
 * An `ExpressionEngine` that cleans itself up at the end of the test.
 *
 * An engine holds a query cache, and that cache arms a garbage-collection timer
 * per cached query for `gcTime` (ten minutes). A timer keeps a Node process
 * alive, so an engine that is constructed and dropped without `clear()` leaves
 * the process unable to exit long after the test that made it has finished.
 *
 * Under `npm run test:ci` this is invisible: Jest runs the files in parallel
 * workers and force-kills them at the end. Under `npm run test:full`, which
 * runs `--runInBand` so the memory-hungry suites do not fight over two cores,
 * everything shares one process and the timers accumulate there. That is what
 * made the full run pass every assertion and then sit for ten minutes until CI
 * killed it.
 *
 * Importing this module is the opt-in: the `afterEach` below is registered
 * against the importing spec file, and nothing else. Specs that already manage
 * their own engine in a `beforeEach`/`afterEach` pair do not need it.
 *
 * It is also where the calendar backend under test is chosen. A spec that
 * names no `calendar` gets the `Date` backend, the engine's own default, or
 * under `SOLVE_CALENDAR=temporal` the `Temporal` backend from
 * `temporalTestKit.ts`, so every date and time spec that builds its engines
 * here proves both backends without being written twice. `npm run
 * test:temporal` is the run that sets it.
 */
import { afterEach } from "@jest/globals";
import { ExpressionEngine, type EngineOptions } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";

const live: ExpressionEngine[] = [];

/** The `Temporal` backend every tracked engine shares under `SOLVE_CALENDAR=temporal`, built on first use. */
let temporalCalendar: CalendarBackend | undefined;

/**
 * The backend for a spec that names none: `undefined` (the engine's `Date`
 * default) unless the run asks for `Temporal`. Loaded lazily so a run that
 * does not ask never loads the polyfill.
 */
function defaultCalendar(): CalendarBackend | undefined {
	if (process.env.SOLVE_CALENDAR !== "temporal") return undefined;
	if (temporalCalendar === undefined) {
		// A `require` rather than an import: the kit pulls in `temporal-polyfill`,
		// which only a Temporal run should pay for.
		const kit = require("./temporalTestKit") as typeof import("./temporalTestKit");
		temporalCalendar = kit.temporalCalendarForTests();
	}
	return temporalCalendar;
}

/**
 * Drop-in for `new ExpressionEngine(options)`. Same options, same instance, but
 * the engine is released when the test finishes.
 *
 * A spec that passes no `packages` gets the full built-in set. The engine itself
 * registers only what it is given (so it can tree-shake), but a test that just
 * says `newTrackedEngine()` means "an ordinary engine", so this injects
 * `BUILTIN_PACKAGES` unless the spec chose its own package list. A spec that
 * passes no `calendar` gets the backend the run is proving; see the header.
 */
export function newTrackedEngine(options: EngineOptions = {}): ExpressionEngine {
	const engine = new ExpressionEngine({
		...options,
		packages: options.packages ?? BUILTIN_PACKAGES,
		calendar: options.calendar ?? defaultCalendar(),
	});
	live.push(engine);
	return engine;
}

afterEach(() => {
	while (live.length > 0) {
		// A spec is free to clear an engine itself; clearing twice is harmless,
		// but a throw here would fail a test that had already passed.
		try {
			live.pop()?.clear();
		} catch {
			/* already torn down */
		}
	}
});
