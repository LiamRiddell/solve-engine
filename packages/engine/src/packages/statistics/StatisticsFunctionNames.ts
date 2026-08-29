/**
 * The function-call spellings the statistics package accepts, each mapped to its
 * plugin function. The two-list statistics also have a natural `correlation of A
 * and B` phrase form; percentile, z-score and the normal distribution are
 * function-only, since they take a mix of a list and plain numbers.
 */
export const STATISTICS_CALL_FUNCTIONS: Record<string, string> = {
	correlation: "statCorrelation",
	slope: "statSlope",
	intercept: "statIntercept",
	rsquared: "statRSquared",
	percentile: "statPercentile",
	zscore: "statZScore",
	normalcdf: "statNormalCdf",
	normalpdf: "statNormalPdf",
};
