/**
 * Reading a thousands comma in a range bound inside a call:
 * `sum(1,000:2,000)` is the range from 1,000 to 2,000.
 *
 * Inside a call's brackets a comma separates arguments, so `max(1,000, 2)` is
 * the largest of 1, 0 and 2 (see `CurrencyGrouping.ts` for the one other
 * exception). That rule split a grouped range bound: `sum(1,000:1)` was read as
 * `sum(1, 000:1)`, the element form adding 1 once for each of 0 and 1, and
 * answered 2, a confident wrong number. A bound written as three digits after a
 * comma, straight against the range's colon, is never a clock time (an hour has
 * at most two digits) and nobody writes a range as starting at `000`, so there
 * the comma is read as the grouping it is.
 *
 * The rule is narrow on purpose. Every group is exactly three digits, the first
 * one to three, with no space anywhere in the number. The first bound is
 * grouped when its last group ends at the colon (`1,000:`). The second bound is
 * grouped when the first cannot be a clock time's hour (three or more digits,
 * a name or a closing bracket: `100:1,000`, `1,000:2,000`, `a:1,002`), and its
 * last group ends the argument; `max(9:30,100)` keeps the separator, since `9:30` is a time. To mean
 * two arguments, a space after the comma says so: `sum(1, 100:200)`.
 *
 * @module RangeBoundGrouping
 */

/** Whether the code unit at `at` is an ASCII digit. Outside the text is not a digit. */
function digitAt(text: string, at: number): boolean {
	if (at < 0 || at >= text.length) return false;
	const unit = text.charCodeAt(at);
	return unit >= 0x30 && unit <= 0x39;
}

/**
 * Where a run of `,ddd` groups starting at the comma `commaAt` ends: the index
 * just past the last group, or -1 when the first comma does not open a group of
 * exactly three digits.
 *
 * @param text - The text the number sits in.
 * @param commaAt - Index of the first comma.
 */
export function groupsEnd(text: string, commaAt: number): number {
	let at = commaAt;
	let end = -1;
	while (text.charCodeAt(at) === 0x2c && digitAt(text, at + 1) && digitAt(text, at + 2) && digitAt(text, at + 3) && !digitAt(text, at + 4)) {
		at += 4;
		end = at;
	}
	return end;
}

/**
 * How many digits stand directly before `at`, counting through grouping commas
 * between them (`1,000` is four), stopping at anything else.
 *
 * @param text - The text.
 * @param at - Index just past the run.
 */
export function digitsBefore(text: string, at: number): number {
	let count = 0;
	let i = at - 1;
	while (i >= 0) {
		if (digitAt(text, i)) count++;
		else if (!(text.charCodeAt(i) === 0x2c && digitAt(text, i - 1) && digitAt(text, i + 1))) break;
		i--;
	}
	return count;
}

/** Whether the code unit at `at` ends a range's second bound: a closing bracket, a comma, a space, or the end. */
function endsBound(text: string, at: number): boolean {
	if (at >= text.length) return true;
	const unit = text.charCodeAt(at);
	return unit === 0x29 || unit === 0x2c || unit === 0x20 || unit === 0x09 || unit === 0xa0;
}

/**
 * Whether the comma at `commaAt`, inside a call, groups the thousands of a
 * range bound rather than separating two arguments.
 *
 * The number starts at `start` with one to three digits. It is the first bound
 * when its groups end directly at a `:`; it is the second when a `:` stands
 * directly before it, what stands before that colon cannot be an hour (see
 * {@link firstBoundBefore}), and its groups end the argument.
 *
 * @param text - The text the number sits in.
 * @param start - Index of the number's first digit.
 * @param commaAt - Index of the comma being weighed, the first after the leading digits or one after a group.
 * @returns True when the comma is a thousands group.
 */
export function groupsRangeBoundInCall(text: string, start: number, commaAt: number): boolean {
	if (text.charCodeAt(commaAt) !== 0x2c) return false;
	// The leading group is one to three digits, with no grouping before it.
	let lead = start;
	while (digitAt(text, lead)) lead++;
	if (lead === start || lead - start > 3 || lead > commaAt) return false;
	const end = groupsEnd(text, lead);
	if (end === -1 || commaAt >= end) return false;
	if (text.charCodeAt(end) === 0x3a) return true;
	return text.charCodeAt(start - 1) === 0x3a && firstBoundBefore(text, start - 1) && endsBound(text, end);
}

/**
 * Whether what stands directly before the colon at `colonAt` is a range's first
 * bound and cannot be a clock time's hour: three or more digits (`100:`,
 * `1,000:`), a name (`a:`), or a closing bracket (`(1 + 2):`).
 *
 * @param text - The text.
 * @param colonAt - Index of the colon.
 */
export function firstBoundBefore(text: string, colonAt: number): boolean {
	if (colonAt <= 0 || text.charCodeAt(colonAt) !== 0x3a) return false;
	if (digitsBefore(text, colonAt) >= 3) return true;
	const unit = text.charCodeAt(colonAt - 1);
	return unit === 0x29 || unit === 0x5f || (unit >= 0x41 && unit <= 0x5a) || (unit >= 0x61 && unit <= 0x7a);
}
