/**
 * The codes the crypto package answers with. A price that fails to fetch arrives as `CRYPTO_QUERY_FAILED`, one of the query resolver codes.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const CryptoErrorCodes = {
	/** A crypto price asked for on an engine whose crypto package was created without a `fetchPrice`. The host supplies one through `createCryptoPackage`. */
	CRYPTO_NOT_CONFIGURED: "CRYPTO_NOT_CONFIGURED",
} as const;
