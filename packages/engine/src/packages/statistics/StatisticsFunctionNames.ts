/**
 * The function-call spellings the statistics package accepts, each mapped to its
 * plugin function. The two-list statistics also have a natural `correlation of A
 * and B` phrase form; percentile, z-score and the distributions are
 * function-only, since they take a mix of a list and plain numbers.
 *
 * The distribution names are a graphing calculator's (`normalcdf`, `binompdf`,
 * `poissoncdf`, `tcdf`), with `invnorm` and `invt` as its spellings of the two
 * inverses beside the `normalinv` and `tinv` a spreadsheet reader looks for.
 * Each of these words followed by `(` is a call, so none of them can also name a
 * function a reader defines.
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
	normalinv: "statNormalInv",
	invnorm: "statInvNorm",
	binompdf: "statBinomPdf",
	binomcdf: "statBinomCdf",
	poissonpdf: "statPoissonPdf",
	poissoncdf: "statPoissonCdf",
	tpdf: "statTPdf",
	tcdf: "statTCdf",
	tinv: "statTInv",
	invt: "statInvT",
	erf: "statErf",
	erfc: "statErfc",
	gamma: "statGamma",
	lgamma: "statLGamma",
};
