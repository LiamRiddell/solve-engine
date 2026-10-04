/**
 * The codes the statistics package answers with: list statistics and the probability distributions.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const StatisticsErrorCodes = {
	/** A statistics function given the wrong number of arguments. The message shows the call. */
	STAT_ARGUMENT_COUNT: "STAT_ARGUMENT_COUNT",
	/** A statistic that reads a list given something else, or too short a list. */
	STAT_EXPECTED_LIST: "STAT_EXPECTED_LIST",
	/** A two-list statistic (`correlation`, `slope`) given something other than two lists. */
	STAT_EXPECTED_LISTS: "STAT_EXPECTED_LISTS",
	/** A two-list statistic given lists of different lengths. */
	STAT_LENGTH_MISMATCH: "STAT_LENGTH_MISMATCH",
	/** A two-list statistic given fewer than two paired points. */
	STAT_TOO_FEW: "STAT_TOO_FEW",
	/** A statistic of an empty list. */
	STAT_EMPTY: "STAT_EMPTY",
	/** `percentile` given no percentage. */
	STAT_EXPECTED_PERCENT: "STAT_EXPECTED_PERCENT",
	/** `percentile` given a percentage outside 0 to 100. */
	STAT_PERCENT_RANGE: "STAT_PERCENT_RANGE",
	/** A distribution or `zscore` given something that is not a number where a number goes. */
	STAT_EXPECTED_VALUE: "STAT_EXPECTED_VALUE",
	/** A distribution given a probability outside the range it takes. */
	STAT_PROBABILITY_RANGE: "STAT_PROBABILITY_RANGE",
	/** A distribution given a count that is not a whole number. */
	STAT_NOT_WHOLE: "STAT_NOT_WHOLE",
	/** A distribution given a count below zero, or more successes than trials. */
	STAT_COUNT_RANGE: "STAT_COUNT_RANGE",
	/** A normal distribution given a standard deviation of zero or less. */
	STAT_SD_NOT_POSITIVE: "STAT_SD_NOT_POSITIVE",
	/** `gamma` at zero or a negative whole number, where it is undefined. */
	STAT_GAMMA_POLE: "STAT_GAMMA_POLE",
	/** A distribution or `gamma` whose answer is beyond the largest number a double can hold. */
	STAT_OVERFLOW: "STAT_OVERFLOW",
	/** A distribution whose series did not settle on an accurate answer for arguments this large. */
	STAT_NO_CONVERGENCE: "STAT_NO_CONVERGENCE",
} as const;
