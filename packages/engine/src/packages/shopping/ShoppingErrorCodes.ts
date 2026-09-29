/**
 * The codes the shopping package answers with.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const ShoppingErrorCodes = {
	/** `<a> vs <b>` between two amounts that are not the same kind of thing. */
	VS_INCOMPARABLE: "VS_INCOMPARABLE",
} as const;
