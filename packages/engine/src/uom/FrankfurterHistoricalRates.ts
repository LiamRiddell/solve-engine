/**
 * The built-in historical exchange rate: the rate for one currency pair on one
 * past day, from the same Frankfurter v2 endpoint that backs the live rate
 * (`uom/CurrencyExchange.ts`), asked with a `date`.
 *
 * Frankfurter serves the European Central Bank's euro foreign exchange
 * reference rates with no key, so a default engine can answer `100 USD in GBP
 * on 2024-01-15` without host code. Using the v2 path for both the live and
 * the dated rate keeps the two answers from one source: the v1 path answers the
 * same day with a different figure.
 *
 * Three refusals are decided here, before any request, and each says why:
 * - a date before 4 January 1999, the first day of the ECB reference rates.
 *   The endpoint does answer earlier dates, from another source, so the
 *   refusal is a decision about provenance rather than the endpoint's limit;
 * - a date after today (UTC), for which no rate has been published;
 * - a code that is not an ISO 4217 currency (a cryptocurrency, say), which the
 *   ECB does not quote. The live path routes crypto to CoinGecko; this default
 *   is fiat only, and a host wanting more supplies its own provider.
 *
 * A weekend or holiday is answered with the rate in force that day, the last
 * one published before it, and the day that rate was published is returned as
 * `asOf` so the conversion's provenance names it.
 */
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { isIso4217 } from "@solve-js/uom/Iso4217";
import { FRANKFURTER_PROVIDER } from "@solve-js/uom/CurrencyExchange";
import { HistoricalCurrencyErrorCodes, type HistoricalRate, type HistoricalRateProvider } from "@solve-js/uom/HistoricalCurrency";

/** The Frankfurter v2 rates endpoint, the same one the live rate reads. */
export const FRANKFURTER_RATES_URL = "https://api.frankfurter.dev/v2/rates";

/**
 * The first day of the European Central Bank's euro reference rates. The
 * built-in historical provider refuses an earlier date (see this module's doc).
 */
export const ECB_REFERENCE_RATES_BEGIN = "1999-01-04";

/** The provider name the engine records on a historical rate it fetched itself. */
export const FRANKFURTER_HISTORICAL_PROVIDER = FRANKFURTER_PROVIDER;

/** Options for {@link createFrankfurterHistoricalRateProvider}. */
export interface FrankfurterHistoricalOptions {
	/**
	 * The fetch to call, `globalThis.fetch` (read at call time) when omitted.
	 * A test passes a stub here so no request leaves the process.
	 */
	readonly fetch?: typeof fetch;
	/** The present moment in epoch milliseconds, for the future-date refusal. `Date.now()` when omitted. */
	readonly now?: () => number;
}

/** Matches the ISO calendar date the `on <date>` parselets produce. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a value is a finite, positive number, the only shape an exchange rate can take. */
function isRate(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Wrap a source failure in the query-failed code, whose message the resolver prefixes with the pair and day. */
function sourceFailure(message: string, context?: Record<string, unknown>) {
	return ErrorFactory.external(HistoricalCurrencyErrorCodes.QUERY_FAILED, message, context);
}

/**
 * Refuse, by name, a pair or day the built-in source does not honestly cover.
 * Returns nothing when the request may go ahead. Exported for its own tests.
 */
export function refuseFrankfurterHistorical(from: string, to: string, isoDate: string, nowMs: number): void {
	for (const code of [from, to]) {
		if (!/^[A-Za-z]{3}$/.test(code) || !isIso4217(code)) {
			throw ErrorFactory.validation(
				HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY,
				`The built-in historical rates are the European Central Bank's reference rates, which cover currencies with an ISO 4217 code, so ${code.slice(0, 16)} has no rate there. A host can supply its own historicalRateProvider for it.`,
				{ code },
			);
		}
	}
	const match = ISO_DATE.exec(isoDate);
	if (!match) {
		throw sourceFailure(`"${isoDate.slice(0, 32)}" is not a calendar date in the form 2024-01-15`);
	}
	if (isoDate < ECB_REFERENCE_RATES_BEGIN) {
		throw ErrorFactory.validation(
			HistoricalCurrencyErrorCodes.DATE_OUT_OF_RANGE,
			`The built-in historical rates begin on 4 January 1999, the first day of the European Central Bank's euro reference rates, so ${isoDate} is not covered. Earlier figures exist from other sources, and a host can supply its own historicalRateProvider for them.`,
			{ isoDate },
		);
	}
	const today = new Date(nowMs).toISOString().slice(0, 10);
	if (isoDate > today) {
		throw ErrorFactory.validation(
			HistoricalCurrencyErrorCodes.DATE_OUT_OF_RANGE,
			`${isoDate} is after today (${today}), and no exchange rate has been published for it yet.`,
			{ isoDate, today },
		);
	}
}

/**
 * Read one pair's rate out of a Frankfurter response body, in the v2 shape (a
 * list of `{ date, base, quote, rate }`) or the v1 shape (`{ date, rates: {
 * CODE: rate } }`), as the live path accepts both. Throws a query failure for a
 * body that is not one of them or carries a rate that is not a positive number,
 * and the unsupported-currency refusal for a body with no entry for `to`.
 * Exported for its own tests.
 */
export function readFrankfurterHistoricalRate(body: unknown, from: string, to: string, isoDate: string): HistoricalRate {
	const quote = to.toUpperCase();
	if (Array.isArray(body)) {
		for (const entry of body) {
			if (typeof entry !== "object" || entry === null) continue;
			const candidate = entry as { quote?: unknown; rate?: unknown; date?: unknown };
			if (typeof candidate.quote !== "string" || candidate.quote.toUpperCase() !== quote) continue;
			if (!isRate(candidate.rate)) throw sourceFailure(`Frankfurter answered with a rate that is not a positive number`);
			return { rate: candidate.rate, asOf: typeof candidate.date === "string" && ISO_DATE.test(candidate.date) ? candidate.date : isoDate };
		}
	} else if (typeof body === "object" && body !== null && typeof (body as { rates?: unknown }).rates === "object" && (body as { rates?: unknown }).rates !== null) {
		const { rates, date } = body as { rates: Record<string, unknown>; date?: unknown };
		// An own-property read: a quote spelt like an inherited name must not
		// reach Object.prototype.
		if (Object.prototype.hasOwnProperty.call(rates, quote)) {
			const rate = rates[quote];
			if (!isRate(rate)) throw sourceFailure(`Frankfurter answered with a rate that is not a positive number`);
			return { rate, asOf: typeof date === "string" && ISO_DATE.test(date) ? date : isoDate };
		}
	} else {
		throw sourceFailure(`Frankfurter answered with a body that holds no rates`);
	}
	throw ErrorFactory.validation(
		HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY,
		`Frankfurter published no ${from.toUpperCase()} to ${quote} rate on or before ${isoDate}. The European Central Bank's reference rates cover about thirty currencies, and a host can supply its own historicalRateProvider for others.`,
		{ from, to, isoDate },
	);
}

/**
 * Build the built-in {@link HistoricalRateProvider}: one GET to the Frankfurter
 * v2 endpoint with `base`, `quotes` and `date`, after the refusals in
 * {@link refuseFrankfurterHistorical}. The caller's `signal` is passed to the
 * fetch, so the resolver's timeout and cancellation stop it.
 */
export function createFrankfurterHistoricalRateProvider(options: FrankfurterHistoricalOptions = {}): HistoricalRateProvider {
	return async (from, to, isoDate, signal) => {
		const fromUpper = from.toUpperCase();
		const toUpper = to.toUpperCase();
		refuseFrankfurterHistorical(fromUpper, toUpper, isoDate, (options.now ?? Date.now)());
		// Built with URLSearchParams so the query is safe on its own terms.
		const query = new URLSearchParams({ base: fromUpper, quotes: toUpper, date: isoDate });
		const fetchImpl = options.fetch ?? globalThis.fetch;
		const response = await fetchImpl(`${FRANKFURTER_RATES_URL}?${query.toString()}`, { signal });
		if (!response.ok) throw sourceFailure(`Frankfurter returned ${response.status}`, { status: response.status });
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw sourceFailure(`Frankfurter answered with a body that is not JSON`);
		}
		return readFrankfurterHistoricalRate(body, fromUpper, toUpper, isoDate);
	};
}

/** The built-in historical provider the default currency package uses. */
export const frankfurterHistoricalRateProvider: HistoricalRateProvider = createFrankfurterHistoricalRateProvider();
