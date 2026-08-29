import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { STATISTICS_PLUGIN_FUNCTIONS } from "./StatisticsPluginFunctions";
import { pairStatParselet } from "./parselets/PairStatParselet";
import { StatsCallParselet } from "./parselets/StatsCallParselet";
import { statsCallNormalizerRule } from "./normalizer/StatsCallNormalizerRule";

/**
 * The second tier of statistics (issues #244, #245): the relationship between
 * two lists, and position within one. `correlation of A and B`, `slope of A and
 * B`, `intercept of A and B`; `percentile([list], p)`, `zscore(x, [list])`, and
 * the standard-normal `normalcdf`/`normalpdf`. Every form also has a call
 * spelling.
 *
 * A companion to the spread, shape and weighted-average forms already in the
 * language (and to `median of`, which the maths-phrases package supplies). On by
 * default and removable. Lists are `[bracketed]` vectors (or an integer range),
 * and a bad shape, a length mismatch or too few points is answered with a
 * structured Error rather than a wrong number.
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
	normalizerRules: [statsCallNormalizerRule()],
	pluginFunctions: STATISTICS_PLUGIN_FUNCTIONS,
	tokenCategories: {
		CORRELATION_OF: "function",
		SLOPE_OF: "function",
		INTERCEPT_OF: "function",
		STAT_CALL: "function",
	},
};
