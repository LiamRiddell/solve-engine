/**
 * The codes the charts package answers with: `plot` and `as sparkline`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const ChartErrorCodes = {
	/** A `plot` whose expression reaches live data (weather, stocks, a currency rate), which a plot cannot wait for at every point. */
	PLOT_EXPR_MUST_BE_SYNCHRONOUS: "PLOT_EXPR_MUST_BE_SYNCHRONOUS",
	/** `as sparkline` given something other than a list or a range of at least two numbers. */
	SPARKLINE_NOT_A_SERIES: "SPARKLINE_NOT_A_SERIES",
} as const;
