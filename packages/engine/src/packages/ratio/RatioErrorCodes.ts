/**
 * The codes the ratio package answers with.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const RatioErrorCodes = {
	/** `ratio(...)` given something that is not a whole number. */
	RATIO_EXPECTED_NUMBERS: "RATIO_EXPECTED_NUMBERS",
	/** `ratio(...)` given fewer than two whole positive numbers. */
	RATIO_INVALID: "RATIO_INVALID",
} as const;
