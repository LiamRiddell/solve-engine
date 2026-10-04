/**
 * The codes the conditionals package answers with: `check` lines.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const ConditionalsErrorCodes = {
	/** A `check` whose statement is not a comparison. The message shows the forms a check takes. */
	CHECK_EXPECTED_COMPARISON: "CHECK_EXPECTED_COMPARISON",
	/** A `check` whose comparison does not hold. The message says by how much; a host counts these through `ParsingResult.checks`. */
	CHECK_FAILED: "CHECK_FAILED",
	/** A `check` between two values that cannot be compared: text with `<`, or quantities of different measures. */
	CHECK_INCOMPARABLE: "CHECK_INCOMPARABLE",
} as const;
