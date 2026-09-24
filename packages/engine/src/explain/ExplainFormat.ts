import { ValueType, type Value } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import type { ExplainContext } from "./Explanation";

/** One formatter per significant-digit count, built on first use. */
const formatters = new Map<number, Intl.NumberFormat>();

/**
 * A number to six significant figures, never fewer than its whole part has,
 * grouped in thousands: `0.621371`, `1,609.34`, `100,000`, `1,234,567`.
 *
 * The display rounds to two decimal places, which is right for an answer and
 * wrong for a factor: `1 km is 0.62 miles` is a different, and wrong, claim.
 * Six figures show a conversion factor or a rate the way a reference table
 * would, and a whole number is never cut short, since `1,234,567` shown as
 * `1,234,570` would misreport the number the reader typed.
 *
 * @param n - The number to show.
 * @returns The number as text.
 */
export function formatExplainNumber(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	const whole = Math.trunc(Math.abs(n));
	const wholeDigits = whole === 0 ? 1 : Math.floor(Math.log10(whole)) + 1;
	const digits = Math.min(21, Math.max(6, wholeDigits));
	let formatter = formatters.get(digits);
	if (formatter === undefined) {
		formatter = new Intl.NumberFormat("en-US", { maximumSignificantDigits: digits });
		formatters.set(digits, formatter);
	}
	// `-0` would print as "-0", which no reader wrote.
	return formatter.format(n === 0 ? 0 : n);
}

/**
 * The formatting an `explain` hook is handed: the engine's own display for a
 * value, with a plain number shown to six significant figures rather than two
 * decimal places, so an argument such as `3.14159` reads as typed in the step
 * that rounds it.
 */
export const EXPLAIN_CONTEXT: ExplainContext = {
	format(value: Value): string {
		if (value.type === ValueType.Number) return formatExplainNumber(value.toNumber());
		return formatValue(value, DEFAULT_FORMATTING_SETTINGS).replace(/^=\s*/, "");
	},
	formatNumber: formatExplainNumber,
};
