/**
 * The codes the stocks package answers with. A quote that fails to fetch arrives as `STOCKS-CURRENT_QUERY_FAILED` or `STOCKS-HISTORICAL_QUERY_FAILED`, the query resolver codes for its two namespaces.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const StocksErrorCodes = {
	/** A stock price asked for on an engine whose stocks package was created without a provider. The host supplies one through `createStocksPackage`. */
	STOCKS_NOT_CONFIGURED: "STOCKS_NOT_CONFIGURED",
	/** `stock(...)` given something that is not a ticker symbol. */
	STOCKS_INVALID_TICKER: "STOCKS_INVALID_TICKER",
	/** A historical price field (`close`, `open`) not followed by `on <date>`. */
	STOCKS_EXPECTED_ON: "STOCKS_EXPECTED_ON",
	/** `on` not followed by a date the stocks package reads. */
	STOCKS_EXPECTED_DATE: "STOCKS_EXPECTED_DATE",
	/** A date after `on` that is not a real calendar date, or has no four-digit year. */
	STOCKS_INVALID_DATE: "STOCKS_INVALID_DATE",
} as const;
