/**
 * Turn a host's {@link HolidayCalendar} into the single `(epochMs) => boolean`
 * predicate the VM's business-day walk consults (see `vm/BusinessDays.ts`).
 *
 * A host can hand over either a function it already has, or a plain list of
 * dates. Both collapse to the same predicate here so the VM never has to know
 * which was given. No calendar resolves to `undefined`, which the VM reads as
 * weekends-only, the honest default described on `constants/Configuration.ts`'s
 * `date.holidays`.
 *
 * Dates are compared on their LOCAL calendar day, matching the rest of the
 * engine's date arithmetic (a date literal is local midnight). A `YYYY-MM-DD`
 * string is read as that calendar day directly, never through `new Date(str)`,
 * which would read a bare date as UTC and land on the previous day west of
 * Greenwich.
 */

import type { HolidayCalendar } from "@solve-js/constants/Configuration";

/** `2024-12-25`, the key both a stored date and a queried instant reduce to. */
function localDateKey(epochMs: number): string {
	const d = new Date(epochMs);
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${month}-${day}`;
}

/** The local-day key for one calendar entry, or `null` if it is unreadable. A
 *  string is matched on its leading `YYYY-MM-DD` so a full ISO timestamp works
 *  too; a number is epoch milliseconds; a `Date` is taken as-is. */
function entryToKey(entry: string | number | Date): string | null {
	if (entry instanceof Date) return localDateKey(entry.getTime());
	if (typeof entry === "number") {
		return Number.isFinite(entry) ? localDateKey(entry) : null;
	}
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(entry.trim());
	if (!match) return null;
	return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Resolve a host calendar to the VM's holiday predicate.
 *
 * A function is wrapped so the VM can call it with an epoch rather than a
 * `Date`. A list is frozen into a `Set` of local-day keys once, here, so the
 * per-day membership test the walk runs thousands of times is a hash lookup,
 * not a re-scan of the list.
 *
 * @returns the predicate, or `undefined` for no calendar (weekends-only).
 */
export function resolveHolidayPredicate(
	calendar: HolidayCalendar | undefined,
): ((epochMs: number) => boolean) | undefined {
	if (calendar === undefined) return undefined;

	if (typeof calendar === "function") {
		return (epochMs: number) => calendar(new Date(epochMs));
	}

	const keys = new Set<string>();
	for (const entry of calendar) {
		const key = entryToKey(entry);
		if (key !== null) keys.add(key);
	}
	// An empty or all-unreadable list is still a configured calendar with no
	// holidays in it, which is a legitimate thing to say. It reads weekends-only
	// like the unconfigured case, but through a real (always-false) predicate.
	return (epochMs: number) => keys.has(localDateKey(epochMs));
}
