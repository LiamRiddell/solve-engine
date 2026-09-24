/**
 * A rate read as one quantity over another, whichever way it was written.
 *
 * A rate is a quantity per unit of something else: 60 kilometres per hour, $5
 * per kilogram, 12 square metres per litre. The engine writes most rates as a
 * compound unit, `km/h` or `USD/kg`, but a few common ones have a single-token
 * name of their own: `mph` is miles per hour, `mpg` miles per gallon, `Mbps`
 * megabits per second. Unit algebra needs to see the two halves of either kind,
 * so a rate can cancel against the quantity it is per (`60 mph * 2 h` is 120
 * miles) or divide one out of it (`120 mi / 60 mph` is two hours).
 *
 * Each named rate is spelled here as the pair a reader would write it as, in
 * units the table already holds: `mph` is `mi/h` and not metres per second, so
 * a distance worked out from it comes back in miles. `scale` is what one of the
 * named rate is in that pair, which is 1 for every rate except litres per 100
 * kilometres.
 */

import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

/** A rate as its two halves. */
export interface RateForm {
	/** The quantity being counted, as a unit spelling; `""` for a count with no unit (`30/week`). */
	readonly numerator: string;
	/** What it is per, as a unit spelling. */
	readonly denominator: string;
	/** One of the rate expressed in `numerator/denominator`. */
	readonly scale: number;
}

/** The single-token rates, each as the pair it names. */
const NAMED_RATES: Readonly<Record<string, RateForm>> = {
	// Speed.
	mps: { numerator: "m", denominator: "s", scale: 1 },
	kph: { numerator: "km", denominator: "h", scale: 1 },
	mph: { numerator: "mi", denominator: "h", scale: 1 },
	kn: { numerator: "nmi", denominator: "h", scale: 1 },
	ft_s: { numerator: "ft", denominator: "s", scale: 1 },
	// Pace, time per distance.
	min_km: { numerator: "min", denominator: "km", scale: 1 },
	min_mi: { numerator: "min", denominator: "mi", scale: 1 },
	// Data rate. Lowercase `b` is bits and uppercase `B` bytes, as in the names.
	bps: { numerator: "b", denominator: "s", scale: 1 },
	kbps: { numerator: "kb", denominator: "s", scale: 1 },
	Mbps: { numerator: "Mb", denominator: "s", scale: 1 },
	Gbps: { numerator: "Gb", denominator: "s", scale: 1 },
	Tbps: { numerator: "Tb", denominator: "s", scale: 1 },
	kBps: { numerator: "kB", denominator: "s", scale: 1 },
	MBps: { numerator: "MB", denominator: "s", scale: 1 },
	GBps: { numerator: "GB", denominator: "s", scale: 1 },
	// Volume flow.
	m3s: { numerator: "m³", denominator: "s", scale: 1 },
	m3h: { numerator: "m³", denominator: "h", scale: 1 },
	lps: { numerator: "l", denominator: "s", scale: 1 },
	lpm: { numerator: "l", denominator: "min", scale: 1 },
	gpm: { numerator: "gal", denominator: "min", scale: 1 },
	cfs: { numerator: "ft³", denominator: "s", scale: 1 },
	// Fuel economy and consumption. `mpg` is per US gallon, the table's `gal`.
	mpg: { numerator: "mi", denominator: "gal", scale: 1 },
	kmpl: { numerator: "km", denominator: "l", scale: 1 },
	l100km: { numerator: "l", denominator: "km", scale: 0.01 },
};

/**
 * The two halves of a rate unit, or `null` when `unit` is not a rate.
 *
 * A compound spelling splits at its slash (`km/h`, `USD/kg`, a countless
 * `/week`), and a named rate (`mph`, `mpg`) gives the pair it names. A slash
 * that belongs to a unit in the table (`cd/m2`, the nit) is not a rate, and
 * neither is a spelling with two slashes, which has no single pair of halves.
 *
 * @param unit - A unit spelling.
 * @returns The rate's halves, or `null`.
 */
export function rateForm(unit: string): RateForm | null {
	const named = NAMED_RATES[unit];
	if (named !== undefined) return named;
	const slash = unit.indexOf("/");
	if (slash < 0 || unit.indexOf("/", slash + 1) >= 0) return null;
	if (UNIT_TABLE[unit] !== undefined) return null;
	return { numerator: unit.slice(0, slash), denominator: unit.slice(slash + 1), scale: 1 };
}

/**
 * Whether `unit` is one of the single-token named rates (`mph`, `mpg`), rather
 * than a compound spelling with a slash.
 *
 * @param unit - A unit spelling.
 * @returns True for a named rate.
 */
export function isNamedRate(unit: string): boolean {
	return NAMED_RATES[unit] !== undefined;
}
