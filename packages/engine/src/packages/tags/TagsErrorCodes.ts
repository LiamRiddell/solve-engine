/**
 * The codes category tags (`#food`, `total of #food`, `breakdown`) answer with.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const TagsErrorCodes = {
	/** A tag total evaluated with no document to read tagged lines from. */
	TAG_NO_DOCUMENT: "TAG_NO_DOCUMENT",
	/** A tag total or a breakdown with no lines carrying the tag, or no tagged lines at all. */
	TAG_EMPTY: "TAG_EMPTY",
	/** A tagged line that is not a number or a quantity. */
	TAG_NON_NUMERIC: "TAG_NON_NUMERIC",
	/** A breakdown whose tagged lines add up to zero, so no tag has a share. */
	TAG_BREAKDOWN_NO_WHOLE: "TAG_BREAKDOWN_NO_WHOLE",
} as const;
