/**
 * The codes the constants package answers with.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const ConstantsErrorCodes = {
	/** A physical constant asked for by a name the table does not have. */
	UNKNOWN_CONSTANT: "UNKNOWN_CONSTANT",
} as const;
