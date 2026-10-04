/**
 * Two ways of writing a number short: engineering notation and compact form.
 *
 * `as engineering` is scientific notation with the exponent kept to a multiple
 * of three, so it lines up with the SI prefixes (kilo, mega, milli, micro):
 * 12,345 is `12.345e+3`, twelve-point-something thousand. `as compact` writes a
 * headline figure the way a report does, 3,300,000 as `3.3M`, with the same
 * suffix letters the engine reads back as input (see the number suffixes page):
 * `k`, `M`, `B` and `T`. It rounds to three significant figures, since a compact
 * figure is for reading at a glance rather than for carrying on with.
 *
 * Both answer text, as `as scientific` does. A quantity keeps its unit after
 * the number, and money its currency symbol in front, so `$3,300,000 as compact`
 * is `$3.3M`. Anything that is not a number or a quantity is refused by name.
 */

import { Value, ValueType, stringValue, errorValue } from "@solve-js/vm/Value";
import { CURRENCY_DISPLAY } from "@solve-js/uom/CurrencyAliases";
import { moneyUnitOf } from "@solve-js/format/FormatEngine";

/** The compact suffixes, largest first, each with the power of ten it stands for. */
const COMPACT_TIERS: ReadonlyArray<readonly [number, string]> = [
	[1e12, "T"],
	[1e9, "B"],
	[1e6, "M"],
	[1e3, "k"],
];

/** A number's shortest spelling to at most `figures` significant figures, trailing zeros trimmed. */
function significant(n: number, figures: number): string {
	return String(Number(n.toPrecision(figures)));
}

/**
 * `n` in engineering notation: a mantissa from 1 up to 1000 and an exponent
 * that is a multiple of three.
 */
export function engineeringString(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	if (n === 0) return "0e+0";
	let exponent = Math.floor(Math.floor(Math.log10(Math.abs(n))) / 3) * 3;
	// Fifteen figures keep the digits the value has while dropping the dust a
	// division by a power of ten leaves (0.00012 / 1e-6 is 119.99999999999999).
	let mantissa = Number((n / Math.pow(10, exponent)).toPrecision(15));
	if (Math.abs(mantissa) >= 1000) {
		mantissa /= 1000;
		exponent += 3;
	}
	return `${mantissa}e${exponent < 0 ? "-" : "+"}${Math.abs(exponent)}`;
}

/** `n` written compactly with a suffix, to three significant figures. */
export function compactString(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	const sign = n < 0 ? "-" : "";
	const magnitude = Math.abs(n);
	for (let i = 0; i < COMPACT_TIERS.length; i++) {
		const [size, suffix] = COMPACT_TIERS[i];
		if (magnitude < size) continue;
		const scaled = Number((magnitude / size).toPrecision(3));
		// 999,950 rounds to 1,000k, which is 1M written worse.
		if (scaled >= 1000 && i > 0) {
			const [largerSize, largerSuffix] = COMPACT_TIERS[i - 1];
			return `${sign}${significant(magnitude / largerSize, 3)}${largerSuffix}`;
		}
		return `${sign}${significant(scaled, 3)}${suffix}`;
	}
	return `${sign}${significant(magnitude, 3)}`;
}

/**
 * A short form written with its unit, as the full answer writes it: money with
 * its symbol where the display table has one (`$3.3M`, `-$1.5k`), a price per
 * unit with the unit after a slash (`$15/hour`), and any other quantity with its
 * unit after a space (`5k m`). The rate used to be looked up whole in the
 * display table, where `USD/hour` is not a currency, so it came out as
 * `15 USD/hour`. The sign goes before a prefix symbol (#554).
 *
 * @param text - The number, already written short.
 * @param unit - The unit the value carries.
 * @returns The text with its unit or currency.
 */
export function withUnit(text: string, unit: string): string {
	const money = moneyUnitOf(unit);
	const display = money === undefined || !Object.prototype.hasOwnProperty.call(CURRENCY_DISPLAY, money.code) ? undefined : CURRENCY_DISPLAY[money.code];
	if (money === undefined || display === undefined) return `${text} ${unit}`;
	const per = money.per === undefined ? "" : `/${money.per}`;
	if (display.position !== "prefix") return `${text} ${money.code}${per}`;
	const sep = display.spaced ? " " : "";
	const negative = text.startsWith("-");
	return `${negative ? "-" : ""}${display.symbol}${sep}${negative ? text.slice(1) : text}${per}`;
}

/** Wrap a short form in the value's unit or currency, or refuse a value that has no number to write. */
function notation(name: string, write: (n: number) => string): (value: Value) => Value {
	return (value) => {
		if (value.type === ValueType.Number) return stringValue(write(value.toNumber()));
		if (value.type === ValueType.Uom && value.unit !== undefined) return stringValue(withUnit(write(value.toNumber()), value.unit));
		return errorValue("AS_CONVERTER_EXPECTED_NUMBER", `as ${name} expects a number or a quantity`);
	};
}

/** `as engineering` / `as eng`. */
export const toEngineering = notation("engineering", engineeringString);

/** `as compact`. */
export const toCompact = notation("compact", compactString);
