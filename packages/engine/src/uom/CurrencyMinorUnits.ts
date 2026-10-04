/**
 * How many decimal places each currency is counted in: its minor unit.
 *
 * A currency's minor unit is the smallest amount that can actually be paid. A
 * US dollar is counted in cents, a hundredth, so two places; the Japanese yen
 * has no subunit in use, so none; the Kuwaiti dinar is counted in fils, a
 * thousandth, so three. ISO 4217 publishes the figure for every code, and it
 * is what the engine uses to show money and to share a bill (#731). Before,
 * every currency was shown to two places, so `¥1000 / 3` was `¥333.33`, a
 * hundredth of a yen nobody can pay, and `100 KWD / 3` lost a fils.
 *
 * The figures are held here rather than read from `Intl.NumberFormat`, which
 * reports them too: Intl's answer comes from the runtime's own copy of the
 * Unicode locale data, whose figures for a few codes differ from ISO's and
 * change between releases, and an answer must not depend on the host's
 * version of Node or of a browser. `CurrencyMinorUnits.spec.ts` checks the
 * table against Intl for the codes where the two agree.
 *
 * Cryptocurrencies are not ISO 4217 and Intl does not know them, so each has
 * an explicit figure: the places a wallet shows it to, which for bitcoin is
 * eight, the satoshi.
 */

/** A range of decimal places to show an amount with: at least `min`, at most `max`, trailing zeros past `min` dropped. */
export interface MoneyPlaces {
	readonly min: number;
	readonly max: number;
}

/**
 * The ISO 4217 codes whose minor unit is not two places. Every other active
 * code is counted in hundredths.
 */
const ISO_MINOR_UNITS_NOT_TWO: Readonly<Record<string, number>> = Object.freeze({
	// No subunit in use.
	BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
	RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
	// A thousandth: the fils, the baisa, the millime, the dirham of a dinar.
	BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
	// Units of account counted to four places.
	CLF: 4, UYW: 4,
});

/**
 * The places each cryptocurrency the engine prices is shown to: bitcoin and
 * dogecoin to eight (the satoshi and its equivalent), XRP and cardano to six
 * (the drop and the lovelace). Ether, solana and polkadot divide further (ether
 * to eighteen places) and are shown to eight, which is as far as a wallet
 * shows them and further than any amount a person reads.
 */
const CRYPTO_PLACES: Readonly<Record<string, number>> = Object.freeze({
	BTC: 8, ETH: 8, SOL: 8, XRP: 6, ADA: 6, DOGE: 8, DOT: 8,
});

/** The fewest places a cryptocurrency amount is shown with, so `1 BTC` is `1.00 BTC` rather than eight zeros. */
const CRYPTO_MIN_PLACES = 2;

/** The places a currency the tables do not name is counted in, the most common minor unit. */
const DEFAULT_MINOR_UNITS = 2;

/** An own-property read, so a code spelt like an inherited name (`constructor`) finds nothing. */
function own(table: Readonly<Record<string, number>>, key: string): number | undefined {
	return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * Whether `code` is one of the cryptocurrencies with a figure in this module.
 *
 * @param code - A currency code, in any case.
 */
export function isCryptoCurrency(code: string): boolean {
	return own(CRYPTO_PLACES, code.toUpperCase()) !== undefined;
}

/**
 * The places `code`'s smallest payable amount has: 0 for the yen, 3 for the
 * Kuwaiti dinar, 8 for bitcoin, and 2 for any other code, including one the
 * tables do not name.
 *
 * @param code - A currency code, in any case.
 */
export function currencyMinorUnits(code: string): number {
	const upper = code.toUpperCase();
	return own(ISO_MINOR_UNITS_NOT_TWO, upper) ?? own(CRYPTO_PLACES, upper) ?? DEFAULT_MINOR_UNITS;
}

/**
 * The places an amount of `code` is shown with when the line names none.
 *
 * An amount of a national currency is shown to exactly its minor unit, since
 * that is what can be paid: `¥333`, `33.333 KWD`, `$33.33`. A price per unit
 * (`¥31.5/kWh`, `$0.30/kWh`) is not a payable amount, and is shown with at least
 * the minor unit and up to `settingPlaces` when that is more, so a fraction of
 * a yen a kilowatt-hour is kept. A cryptocurrency is shown to between two and
 * its own figure, trailing zeros dropped, so `1 BTC` is `1.00 BTC` and
 * `0.00012345 BTC` keeps its digits.
 *
 * @param code - A currency code, in any case.
 * @param settingPlaces - The host's place count for quantities.
 * @param perUnit - Whether the amount is a price per unit of something.
 */
export function moneyDisplayPlaces(code: string, settingPlaces: number, perUnit: boolean): MoneyPlaces {
	const minor = currencyMinorUnits(code);
	if (isCryptoCurrency(code)) return { min: Math.min(CRYPTO_MIN_PLACES, minor), max: minor };
	if (perUnit) return { min: minor, max: Math.max(minor, settingPlaces) };
	return { min: minor, max: minor };
}

/**
 * Drop the zeros at the end of a fixed-decimal string's fraction, keeping at
 * least `min` places: `"0.33333300"` to `"0.333333"`, `"1.00000000"` with a
 * minimum of two to `"1.00"`, and `"3.00"` with a minimum of none to `"3"`.
 * A string that is not plain digits (an exponent form) is returned as it came.
 *
 * @param fixed - A string such as `toFixed` or `decimalToFixed` writes.
 * @param min - The fewest fraction digits to keep.
 */
export function trimFractionZeros(fixed: string, min: number): string {
	const match = /^(-?\d+)\.(\d+)$/.exec(fixed);
	if (!match) return fixed;
	const [, whole, fraction] = match;
	let end = fraction.length;
	while (end > min && fraction.charCodeAt(end - 1) === 48) end--;
	return end === 0 ? whole : `${whole}.${fraction.slice(0, end)}`;
}
