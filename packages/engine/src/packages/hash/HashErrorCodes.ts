/**
 * The codes the hashing package answers with.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const HashErrorCodes = {
	/** A hash function (`sha256(...)`) given something that is not text in quotes. */
	HASH_EXPECTED_TEXT: "HASH_EXPECTED_TEXT",
} as const;
