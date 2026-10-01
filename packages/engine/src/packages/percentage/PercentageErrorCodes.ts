/**
 * The codes the percentage phrases answer with at parse time. What percentages refuse while running is in `CoreErrorCodes`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const PercentageErrorCodes = {
	/** `<a> is what` not followed by `%` or `percent`. */
	IS_WHAT_EXPECTED_PERCENT: "IS_WHAT_EXPECTED_PERCENT",
	/** `<a> is <n>%` not followed by `of what`, `off what` or `on what`. */
	IS_WHAT_EXPECTED_PREPOSITION: "IS_WHAT_EXPECTED_PREPOSITION",
	/** A percentage phrase missing one of its words part-way through. The message names the word. */
	IS_WHAT_EXPECTED_WORD: "IS_WHAT_EXPECTED_WORD",
	/** `percent change from <a>` not followed by `to` and the new value. */
	PERCENT_CHANGE_EXPECTED_TO: "PERCENT_CHANGE_EXPECTED_TO",
} as const;
