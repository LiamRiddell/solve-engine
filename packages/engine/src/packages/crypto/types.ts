/** A current crypto price, as returned by a host-supplied `fetchPrice`. */
export interface CryptoQuote {
	/** Current price of one coin, in `currency` (default "USD"). */
	price: number;
	/** ISO 4217 currency code the price is quoted in. Defaults to "USD". */
	currency?: string;
}

/**
 * Configuration for {@link createCryptoPackage}. Like stocks, and for the same
 * reason, there is no free/keyless crypto price API to bundle: the host supplies
 * the fetch, backed by whichever provider and key they have.
 */
export interface CryptoPackageConfig {
	/**
	 * Fetch the current price for `coin` (an upper-cased symbol like `BTC`).
	 * Required for `crypto(...)` to return real data; without it, a crypto
	 * expression resolves to an honest `CRYPTO_NOT_CONFIGURED` error, never a
	 * faked or zero price.
	 */
	fetchPrice?: (coin: string, signal: AbortSignal) => Promise<CryptoQuote>;

	/** Query staleTime for a price, in ms. Default 60s; crypto moves continuously. */
	staleTimeMs?: number;

	/** Cadence, in ms, for proactive background refresh of an on-screen price. Omit to keep it pull-only. */
	refetchIntervalMs?: number;
}
