/**
 * The `Temporal` implementation a test run uses, and a calendar backend built
 * on it.
 *
 * Two implementations are of interest. The runtime's own,
 * `globalThis.Temporal`, is native on Node 26 and sits behind
 * `--harmony-temporal` on Node 24; `temporal-polyfill` is a devDependency, so
 * it reaches nobody who installs the engine, and its `implementation` entry is
 * always the polyfill's own code even on a runtime that has a native one.
 * `SOLVE_TEMPORAL=native` insists on the runtime's and fails loudly when there
 * is none; anything else (the default) uses the polyfill.
 *
 * `SOLVE_CALENDAR=temporal` makes `newTrackedEngine()` build every engine a
 * spec does not give a backend to on the `Temporal` backend, so the existing
 * date and time specs prove it without being rewritten (see
 * `trackedEngine.ts`). `scripts/test-temporal.mjs` sets both variables and
 * the zone, and is what `npm run test:temporal` runs.
 */
import { Temporal as PolyfillTemporal } from "temporal-polyfill/implementation";
import { createTemporalCalendar, type TemporalCalendar, type TemporalLike } from "@solve-js/temporal/TemporalCalendar";

/** Which `Temporal` a run uses: the runtime's own, or the polyfill's implementation. */
export type TemporalSource = "native" | "polyfill";

/** The source `SOLVE_TEMPORAL` names, defaulting to the polyfill. */
export function temporalSource(): TemporalSource {
	return process.env.SOLVE_TEMPORAL === "native" ? "native" : "polyfill";
}

/** The runtime's own `Temporal`, when it has one. */
export function nativeTemporal(): TemporalLike | undefined {
	return (globalThis as { Temporal?: TemporalLike }).Temporal;
}

/**
 * The `Temporal` implementation for `source`.
 *
 * @param source - Native or polyfill; defaults to what `SOLVE_TEMPORAL` says.
 * @returns The implementation.
 * @throws When the native one is asked for on a runtime that has none.
 */
export function temporalForTests(source: TemporalSource = temporalSource()): TemporalLike {
	if (source === "native") {
		const native = nativeTemporal();
		if (native === undefined) {
			throw new Error(
				"SOLVE_TEMPORAL=native, but this runtime has no globalThis.Temporal: use Node 26, or Node 24 with --harmony-temporal",
			);
		}
		return native;
	}
	return PolyfillTemporal as unknown as TemporalLike;
}

/**
 * A `Temporal` backend for a spec. It reads `Date.now()` for `now()`, so a
 * spec that pins the clock with jest's fake timers pins this backend the same
 * way it pins the `Date` one, and computes in `timeZone`, defaulting to the
 * process's own so the `Date` backend is its oracle.
 *
 * @param options - The zone to compute in, and which implementation to build on.
 * @returns The backend.
 */
export function temporalCalendarForTests(options: { timeZone?: string; source?: TemporalSource } = {}): TemporalCalendar {
	return createTemporalCalendar(temporalForTests(options.source), { timeZone: options.timeZone, now: () => Date.now() });
}

/**
 * Whether the polyfill is known to misread an instant in a zone.
 *
 * `temporal-polyfill` 1.0.4 reads London as GMT between 16 March and 13
 * April 1947, a year with three transitions (summer time, then double
 * summer time), where `Intl`, `Date` and the runtime's native `Temporal` all
 * say BST. Across thirteen zones and the years 1840 to 2120 it is the only
 * window found. The differential specs leave those instants out under the
 * polyfill and assert the misreading is still there, so the exclusion goes
 * when the polyfill is fixed rather than outliving it.
 *
 * @param zone - The IANA zone being read.
 * @param epochMs - The instant.
 * @returns `true` only under the polyfill, for London inside that window.
 */
export function polyfillMisreads(zone: string, epochMs: number): boolean {
	return temporalSource() === "polyfill" && zone === "Europe/London" && epochMs >= Date.UTC(1947, 2, 16, 2) && epochMs < Date.UTC(1947, 3, 13, 1);
}

/** Which backend `newTrackedEngine()` gives a spec that names none: `SOLVE_CALENDAR=temporal` selects the `Temporal` one. */
export function calendarUnderTest(): "date" | "temporal" {
	return process.env.SOLVE_CALENDAR === "temporal" ? "temporal" : "date";
}
