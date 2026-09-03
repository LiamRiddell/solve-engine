/**
 * Calendar arithmetic that more than one layer needs.
 *
 * A leaf module with no imports, so the VM, the datetime package and any
 * parselet can share one definition. There used to be three private copies
 * of {@link daysInMonth}, and two of them counted months from zero while the
 * third counted from one, which is the kind of disagreement that reads as a
 * February bug rather than a duplication bug.
 *
 * @module Calendar
 */

/**
 * Days in calendar month `month0` (0 = January, 11 = December) of `year`,
 * honouring leap years. Day zero of the following month is the last day of
 * this one, which is how the leap-year rule gets applied without restating it.
 */
export function daysInMonth(year: number, month0: number): number {
	return new Date(year, month0 + 1, 0).getDate();
}
