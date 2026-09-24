import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { STATISTICS_PLUGIN_FUNCTIONS } from "./StatisticsPluginFunctions";
import { DISTRIBUTION_PLUGIN_FUNCTIONS } from "./DistributionPluginFunctions";
import { pairStatParselet } from "./parselets/PairStatParselet";
import { StatsCallParselet } from "./parselets/StatsCallParselet";
import { STATISTICS_CALL_FUNCTIONS } from "./StatisticsFunctionNames";

/**
 * The second tier of statistics (issues #244, #245): the relationship between
 * two lists, and position within one. `correlation of A and B`, `slope of A and
 * B`, `intercept of A and B`; `percentile([list], p)` and `zscore(x, [list])`.
 * Every form also has a call spelling.
 *
 * And the probability distributions (#517): the normal (`normalcdf`,
 * `normalpdf`, `normalinv`), binomial (`binompdf`, `binomcdf`), Poisson
 * (`poissonpdf`, `poissoncdf`) and Student's t (`tpdf`, `tcdf`, `tinv`), with the
 * special functions behind them (`erf`, `erfc`, `gamma`, `lgamma`).
 *
 * A companion to the spread, shape and weighted-average forms already in the
 * language (and to `median of`, which the maths-phrases package supplies). On by
 * default and removable. Lists are `[bracketed]` vectors (or an integer range),
 * and a bad shape, a length mismatch, too few points, an argument outside a
 * distribution's domain or an argument the form does not read is answered with
 * a structured Error rather than a wrong number.
 */
export const STATISTICS_PACKAGE: IEnginePackage = {
	name: "solve-statistics",
	phrases: {
		"correlation of": "CORRELATION_OF",
		"slope of": "SLOPE_OF",
		"intercept of": "INTERCEPT_OF",
	},
	prefixParselets: {
		CORRELATION_OF: pairStatParselet("statCorrelation"),
		SLOPE_OF: pairStatParselet("statSlope"),
		INTERCEPT_OF: pairStatParselet("statIntercept"),
		STAT_CALL: new StatsCallParselet(),
	},
	// `correlation(...)`, `percentile(...)`, ... fused to STAT_CALL by the shared rule.
	callFusions: Object.fromEntries(Object.keys(STATISTICS_CALL_FUNCTIONS).map((n) => [n, "STAT_CALL"])),
	pluginFunctions: { ...STATISTICS_PLUGIN_FUNCTIONS, ...DISTRIBUTION_PLUGIN_FUNCTIONS },
	tokenCategories: {
		CORRELATION_OF: "function",
		SLOPE_OF: "function",
		INTERCEPT_OF: "function",
		STAT_CALL: "function",
	},
};
