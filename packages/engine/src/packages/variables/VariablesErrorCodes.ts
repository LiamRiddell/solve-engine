/**
 * The codes the variables and global variables packages answer with.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const VariablesErrorCodes = {
	/** A `:` or `global :` not followed by a name, as in `:= 5`. */
	EXPECTED_IDENTIFIER: "EXPECTED_IDENTIFIER",
} as const;
