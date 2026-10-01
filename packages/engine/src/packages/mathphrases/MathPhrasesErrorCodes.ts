/**
 * The codes the maths phrases answer with: `clamp`, `remainder of`, `root N of`, `log N base M`, proportions, weighted averages and the aggregate calls.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const MathPhrasesErrorCodes = {
	/** An aggregate call with nothing inside, as in `mean()`, refused rather than answered 0. */
	AGGREGATE_CALL_EMPTY: "AGGREGATE_CALL_EMPTY",
	/** An aggregate call whose only argument is written like a range (`average(1:3)`, `mean(1:3)`, `median(1:3)`), which outside `sum` (and its synonym `total`), `prod`, `map` and `reduce` is a clock time. */
	AGGREGATE_CALL_RANGE: "AGGREGATE_CALL_RANGE",
	/** A function of the reader's own defined under an aggregate's name (`mean`, `median`, `stdev`), which a call would never reach. */
	AGGREGATE_NAME_RESERVED: "AGGREGATE_NAME_RESERVED",
	/** `clamp <value>` followed by neither `between` nor `from`. */
	CLAMP_EXPECTED_BETWEEN_OR_FROM: "CLAMP_EXPECTED_BETWEEN_OR_FROM",
	/** `remainder of <a>` not followed by `divided by` or `/`. */
	REMAINDER_EXPECTED_DIVIDED_BY: "REMAINDER_EXPECTED_DIVIDED_BY",
	/** `root <n>` not followed by `of`. */
	ROOT_EXPECTED_OF: "ROOT_EXPECTED_OF",
	/** `log <n>` not followed by `base`. */
	LOG_EXPECTED_BASE: "LOG_EXPECTED_BASE",
	/** A proportion (`5 km is to 500 m as 5 cm is to what`) missing its final `what`. */
	PROPORTION_EXPECTED_WHAT: "PROPORTION_EXPECTED_WHAT",
	/** A weighted average with a value that has no `at <weight>` after it. */
	WEIGHTED_AVERAGE_MISSING_WEIGHT: "WEIGHTED_AVERAGE_MISSING_WEIGHT",
} as const;
