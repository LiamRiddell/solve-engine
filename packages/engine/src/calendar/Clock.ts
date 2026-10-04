/**
 * The clock a calendar backend reads, checked the same way on every backend.
 *
 * A host pins the date a document is computed on by handing a backend its own
 * clock: `dateCalendarInZone(zone, { now })` on the `Date` backend, and
 * `createTemporalCalendar(Temporal, { now })` on the `Temporal` one. The clock
 * is a function returning epoch milliseconds, and it is the host's code, so
 * the backend cannot assume what it returns. A clock that answered `NaN` used
 * to reach the display as `Invalid Date, Invalid Date`, and one that was not a
 * function at all failed on first use with an uncoded `TypeError` (#721, #826).
 *
 * Both backends wrap the host's clock here, so a host moving between them
 * meets one contract: a clock that is not a function is refused when the
 * backend is built, and a reading that is not a moment `Date` can hold (`NaN`,
 * an infinity, a number past 8.64e15 either side of the epoch, anything that
 * is not a number) or a clock that throws is refused on the line that read it,
 * with `DATE_CLOCK_INVALID`. The line fails and the rest of the document goes
 * on, because a line that does not read the clock does not need it.
 *
 * @module Clock
 */

import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { CoreErrorCodes } from "@solve-js/errors/ErrorCode";

/** The largest magnitude `Date` represents, in milliseconds either side of the epoch. */
const MAX_INSTANT = 8.64e15;

/**
 * What a clock reading is, in a few words a reader can follow, for the
 * refusal: `NaN`, `Infinity`, `a string`, or the number itself.
 */
function describeReading(reading: unknown): string {
	if (typeof reading === "number") return String(reading);
	if (reading === null) return "nothing (null)";
	if (reading === undefined) return "nothing";
	return `a ${typeof reading}`;
}

/**
 * The refusal for a clock reading that names no moment, or a clock that threw.
 *
 * @param owner - The call the host configured the clock through, for the message.
 * @param problem - What went wrong, as the end of a sentence.
 */
function clockRefusal(owner: string, problem: string, context: Record<string, unknown>): Error {
	return ErrorFactory.config(
		CoreErrorCodes.DATE_CLOCK_INVALID,
		`The clock given to ${owner} ${problem}, so today and now cannot be read. ` +
			"It should return the current moment in epoch milliseconds.",
		context,
	);
}

/**
 * Wrap a host's clock so every reading is a moment `Date` can hold, or a coded
 * refusal.
 *
 * @param now - The host's clock, as given. Checked here: anything but a
 *   function is refused at once.
 * @param owner - The call the clock was given to (`dateCalendarInZone` or
 *   `createTemporalCalendar`), named in the refusal so a host can find it.
 * @returns A clock answering finite epoch milliseconds within `Date`'s range,
 *   truncated to a whole millisecond as `Date` truncates, and throwing
 *   `DATE_CLOCK_INVALID` for anything else.
 * @throws `DATE_CLOCK_INVALID` when `now` is not a function.
 */
export function checkedClock(now: unknown, owner: string): () => number {
	if (typeof now !== "function") {
		throw clockRefusal(owner, `is ${describeReading(now)}, not a function`, { owner, given: typeof now });
	}
	const clock = now as () => unknown;
	return () => {
		let reading: unknown;
		try {
			reading = clock();
		} catch (error) {
			throw clockRefusal(owner, "failed when it was read", {
				owner,
				cause: error instanceof Error ? error.message : String(error),
			});
		}
		if (typeof reading !== "number" || !Number.isFinite(reading) || Math.abs(reading) > MAX_INSTANT) {
			throw clockRefusal(owner, `answered ${describeReading(reading)}, which is not a moment in time`, {
				owner,
				reading: typeof reading === "number" ? reading : typeof reading,
			});
		}
		// `|| 0` so a reading of -0.5 is the epoch, not -0.
		return Math.trunc(reading) || 0;
	};
}
