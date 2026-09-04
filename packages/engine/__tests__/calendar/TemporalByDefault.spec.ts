/**
 * The engine computes dates on Temporal where the runtime has it.
 *
 * The backend used to default to `Date` and a host had to import the
 * `solve-engine/temporal` subpath and construct a backend to get anything
 * else. Temporal now ships in Chrome, Edge, Firefox and Opera and in Node
 * from 26, so the engine prefers it and falls back to `Date` where it is
 * absent (Node 22 and 24, Safari, iOS). No polyfill is bundled: what the
 * engine carries is the adapter.
 *
 * What is pinned: the preference and the fallback, that `"date"` and
 * `"temporal"` pin a backend outright, that asking for Temporal where there
 * is none is refused rather than silently answered on `Date`, and that a
 * host may still pass its own backend.
 *
 * The reason this is safe to default is that the two backends agree:
 * `scripts/test-temporal.mjs` runs the date suites under both in three time
 * zones. This spec pins the choosing, not the agreeing.
 */

import { describe, expect, test } from "@jest/globals";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { resolveCalendar, temporalIsAvailable } from "@solve-js/calendar/resolveCalendar";
import { EngineError } from "@solve-js/errors/EngineError";
import { TemporalCalendar } from "@solve-js/temporal/TemporalCalendar";
import { Temporal } from "temporal-polyfill";

/** Run `body` with `globalThis.Temporal` present or absent, whatever this runtime really has. */
const withTemporal = (temporal: unknown, body: () => void): void => {
	const holder = globalThis as { Temporal?: unknown };
	const had = "Temporal" in holder;
	const previous = holder.Temporal;
	if (temporal === undefined) delete holder.Temporal;
	else holder.Temporal = temporal;
	try {
		body();
	} finally {
		if (had) holder.Temporal = previous;
		else delete holder.Temporal;
	}
};

// A real implementation, the same polyfill the differential suite runs the
// date behaviour under. Hand-built stubs do not satisfy the adapter's shape
// check, and should not: it is what stops a half-implementation being used.
const hostTemporal = Temporal;

describe("the default", () => {
	test("is Temporal where the runtime has it", () => {
		withTemporal(hostTemporal, () => {
			expect(resolveCalendar()).toBeInstanceOf(TemporalCalendar);
			expect(resolveCalendar("auto")).toBeInstanceOf(TemporalCalendar);
			expect(temporalIsAvailable()).toBe(true);
		});
	});

	test("and Date where it has none", () => {
		withTemporal(undefined, () => {
			expect(resolveCalendar()).toBe(DATE_CALENDAR);
			expect(resolveCalendar("auto")).toBe(DATE_CALENDAR);
			expect(temporalIsAvailable()).toBe(false);
		});
	});
});

describe("pinning a backend", () => {
	test('"date" computes on Date even where Temporal is present', () => {
		withTemporal(hostTemporal, () => {
			expect(resolveCalendar("date")).toBe(DATE_CALENDAR);
		});
	});

	test('"temporal" computes on Temporal', () => {
		withTemporal(hostTemporal, () => {
			expect(resolveCalendar("temporal")).toBeInstanceOf(TemporalCalendar);
		});
	});

	test('"temporal" is refused where the runtime has none, rather than falling back', () => {
		withTemporal(undefined, () => {
			let code: string | undefined;
			try {
				resolveCalendar("temporal");
			} catch (thrown) {
				code = (thrown as EngineError).code;
			}
			expect(code).toBe("CALENDAR_TEMPORAL_UNAVAILABLE");
		});
	});

	test("a backend the host built is used as it is", () => {
		withTemporal(hostTemporal, () => {
			expect(resolveCalendar(DATE_CALENDAR)).toBe(DATE_CALENDAR);
		});
	});
});
