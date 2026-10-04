/**
 * The codes a resolver built with `createQueryResolver` answers with, which
 * are named at run time after the resolver's namespace.
 *
 * Each value is a pattern rather than a code: `<NAMESPACE>` stands for the
 * resolver's `namespace` upper-cased, so the crypto package's resolver
 * (namespace `crypto`) answers `CRYPTO_QUERY_FAILED`, and the stocks
 * package's two (`stocks-current`, `stocks-historical`) answer
 * `STOCKS-CURRENT_QUERY_FAILED` and `STOCKS-HISTORICAL_QUERY_FAILED`. A host
 * that branches on one matches the suffix, or the whole name for a namespace
 * it knows. A package that passes its own `onError` answers with codes of its
 * own instead.
 */
export const QueryResolverErrorCodePatterns = {
	/** A live value whose fetch failed (the provider threw, or the network did). The line is refused rather than answered with a stale or made-up value; a later evaluation retries after the cooldown. */
	QUERY_FAILED: "<NAMESPACE>_QUERY_FAILED",
	/** A live value read before its fetch was started, which the engine's preflight makes unreachable. Worth reporting if a host sees it. */
	NOT_PREFLIGHTED: "<NAMESPACE>_NOT_PREFLIGHTED",
} as const;
