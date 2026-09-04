/**
 * Choosing the calendar backend an engine computes dates with.
 *
 * The engine prefers Temporal. Where the runtime has it, dates are computed
 * on `Temporal` (Chrome, Edge, Firefox and Opera ship it, and Node from 26);
 * where it does not (Node 22 and 24, Safari, iOS), they are computed on
 * `Date`, which is what every engine did before the backend existed.
 *
 * The engine bundles no polyfill. What it carries is the adapter, a few
 * kilobytes that translate the backend's plain-number contract onto whichever
 * implementation is present. A host that wants Temporal on a runtime without
 * it installs a polyfill itself and passes the backend, which is what the
 * `solve-engine/temporal` subpath is for.
 *
 * The two backends are held to the same answers: `scripts/test-temporal.mjs`
 * runs the date suites under both, in three time zones, and the differential
 * suite compares them case by case. That is what makes preferring one safe
 * rather than a coin toss, because it means a reader on Firefox and a reader
 * on Safari see the same number.
 *
 * @module resolveCalendar
 */

import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { CalendarBackend } from "./CalendarBackend";
import { DATE_CALENDAR } from "./DateCalendar";
import { createTemporalCalendar, type TemporalLike } from "@solve-js/temporal/TemporalCalendar";

/**
 * How an engine picks its calendar backend.
 *
 * - `"auto"`, the default: Temporal where the runtime has it, `Date` otherwise.
 * - `"temporal"`: Temporal, refusing to build an engine on a runtime without
 *   it rather than quietly computing on `Date`.
 * - `"date"`: the `Date` backend, whatever the runtime has. What to pin when a
 *   result must not depend on where it was computed.
 * - A {@link CalendarBackend}: that backend, for a host supplying its own (a
 *   polyfill-backed one, or a zone-bound one).
 */
export type CalendarOption = "auto" | "temporal" | "date" | CalendarBackend;

/** The `Temporal` the runtime exposes, or undefined where it has none. */
function hostTemporal(): TemporalLike | undefined {
	const candidate = (globalThis as { Temporal?: unknown }).Temporal;
	return candidate === undefined || candidate === null ? undefined : (candidate as TemporalLike);
}

/**
 * Whether this runtime computes dates on Temporal by default.
 *
 * Exposed so a host can report which backend its readers are on, and so a
 * test can say what it is asserting about. It answers for the runtime, not
 * for a particular engine: an engine given `calendar: "date"` computes on
 * `Date` whatever this returns.
 *
 * @returns True where `globalThis.Temporal` is present.
 */
export function temporalIsAvailable(): boolean {
	return hostTemporal() !== undefined;
}

/**
 * The backend an engine's `calendar` option asks for.
 *
 * @param option - The engine's `calendar` option; see {@link CalendarOption}.
 * @returns The backend to compute dates with.
 * @throws When `"temporal"` is asked for on a runtime that has no `Temporal`.
 *   Refused rather than silently answered with `Date`, because a host that
 *   named Temporal did so to be sure of what it was computing on.
 */
export function resolveCalendar(option?: CalendarOption): CalendarBackend {
	if (option !== undefined && typeof option !== "string") return option;

	if (option === "date") return DATE_CALENDAR;

	const temporal = hostTemporal();
	if (option === "temporal") {
		if (temporal === undefined) {
			throw ErrorFactory.config(
				"CALENDAR_TEMPORAL_UNAVAILABLE",
				'calendar: "temporal" was asked for, but this runtime has no Temporal. ' +
					"Node ships it from 26 (24 behind --harmony-temporal), and Chrome, Edge, Firefox and Opera ship it; " +
					'Safari does not. Pass a polyfill-backed backend from "solve-engine/temporal", ' +
					'or use calendar: "auto" to compute on Date where Temporal is absent.',
			);
		}
		return createTemporalCalendar(temporal);
	}

	// "auto", or nothing given.
	return temporal === undefined ? DATE_CALENDAR : createTemporalCalendar(temporal);
}
