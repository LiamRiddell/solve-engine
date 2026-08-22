import type { HistoricalRateProvider } from "@solve-js/uom/HistoricalCurrency";

/**
 * Configuration for {@link createCurrencyPackage}.
 *
 * Live conversion (`100 USD in GBP`) needs no configuration, it is backed by
 * the built-in Frankfurter/CoinGecko fetch and works out of the box. Only the
 * historical form (`100 USD in GBP on <date>`) needs a host-supplied data
 * source, since no free keyless historical-FX endpoint exists to bake in. See
 * `uom/HistoricalCurrency.ts`'s module doc.
 */
export interface CurrencyPackageConfig {
	/**
	 * Resolve the exchange rate for one currency pair on one past date, backed
	 * by whichever provider and key the host has. Required for
	 * `<money> in <currency> on <date>` to return real data, when omitted, that
	 * form resolves to an honest `HISTORICAL_RATES_NOT_CONFIGURED` error `Value`
	 * rather than falling back to today's rate.
	 */
	historicalRateProvider?: HistoricalRateProvider;
}
