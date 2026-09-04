/**
 * The `Temporal` calendar backend, behind its own entry point.
 *
 * `import { createTemporalCalendar } from "solve-engine/temporal"`, hand it
 * the `Temporal` implementation the host has (`globalThis.Temporal` on Node
 * 26 and current browsers, or a polyfill's export) and pass the result as an
 * engine's `calendar` option. Nothing here is reached from the root entry or
 * any other subpath, and this module imports no `Temporal` and no polyfill,
 * so a host that never imports it ships no more than it did.
 *
 * @packageDocumentation
 */

export { createTemporalCalendar, TemporalCalendar } from "./TemporalCalendar";
export type {
	TemporalLike,
	TemporalCalendarOptions,
	TemporalInstantLike,
	TemporalZonedDateTimeLike,
	TemporalPlainDateTimeLike,
	TemporalDateTimeFields,
} from "./TemporalCalendar";
// The interface the backend implements, so a host typing its option needs no
// second import.
export type { CalendarBackend, CalendarFields, ZonedFields } from "@solve-js/calendar/CalendarBackend";
