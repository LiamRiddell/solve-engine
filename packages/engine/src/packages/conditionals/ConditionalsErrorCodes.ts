/**
 * The codes the conditionals package answers with: `check` lines and negation.
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
	/** A `check` whose comparisons are joined by something other than `and`: `or`, a bitwise operator, or a comparison after a `within` margin. The message says to join them with `and` or to bracket a side. */
	CHECK_JOIN_UNSUPPORTED: "CHECK_JOIN_UNSUPPORTED",
	/** `not` or a prefix `!` before a value that is not true or false (`not 5`, `!"yes"`). The message names what the value is. */
	NOT_NEEDS_BOOLEAN: "NOT_NEEDS_BOOLEAN",
} as const;
