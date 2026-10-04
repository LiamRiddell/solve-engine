import type { HistoricalRateProvider } from "@solve-js/uom/HistoricalCurrency";

/**
 * Configuration for {@link createCurrencyPackage}.
 *
 * Nothing here is required. Live conversion (`100 USD in GBP`) is backed by
 * the built-in Frankfurter/CoinGecko fetch, and the historical form (`100 USD
 * in GBP on <date>`) by the same Frankfurter endpoint asked for a date. See
 * `uom/HistoricalCurrency.ts`'s module doc.
 */
export interface CurrencyPackageConfig {
	/**
	 * Resolve the exchange rate for one currency pair on one past date.
	 *
	 * Omitted, the built-in Frankfurter provider answers (the European Central
	 * Bank's reference rates, fiat only, from 4 January 1999). A function here
	 * takes precedence over it, backed by whichever provider and key the host
	 * has. `null` switches the dated form off: it then resolves to an honest
	 * `HISTORICAL_RATES_NOT_CONFIGURED` error `Value` rather than falling back
	 * to today's rate.
	 */
	historicalRateProvider?: HistoricalRateProvider | null;

	/**
	 * The name of the service behind {@link historicalRateProvider}, recorded on
	 * every historical conversion so a host can say whose rate it was (see
	 * `vm/Provenance.ts`). Defaults to `"host"` for a host's provider; the
	 * built-in one is recorded as `"Frankfurter"`.
	 */
	historicalProviderName?: string;
}
