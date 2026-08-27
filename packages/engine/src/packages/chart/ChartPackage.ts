import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { chartValue, errorValue, type Value } from "@solve-js/vm/Value";
import { sparklineChart } from "./Sparkline";
import { PlotParselet } from "./parselets/PlotParselet";
import { plotNormalizerRule } from "./normalizer/PlotNormalizerRule";

/**
 * Charts: visuals the engine describes as data, never draws. `<vector> as
 * sparkline` and `plot <expr> from <a> to <b>` both produce a
 * {@link ValueType.Chart} value, a specification (points, a domain, a range, a
 * label) a host renders with its own charting library (issues #186, #187).
 *
 * On by default, and removable: an engine that wants no charting drops this
 * package and the two forms simply do not parse, exactly as dropping the colour
 * package removes colours. Nothing else depends on it.
 */
export const CHART_PACKAGE: IEnginePackage = {
	name: "solve-chart",
	// `<vector> as sparkline`: turn a numeric vector or range into a sparkline
	// chart. A value with no drawable series is declined with a clear error
	// rather than silently passed through, since the reader asked for a chart.
	asConverters: {
		sparkline: (value: Value): Value => {
			const chart = sparklineChart(value);
			if (!chart) {
				return errorValue(
					"SPARKLINE_NOT_A_SERIES",
					`"as sparkline" expects a numeric vector or a range, with at least two values`,
				);
			}
			return chartValue(chart);
		},
	},
	prefixParselets: {
		PLOT: new PlotParselet(),
	},
	normalizerRules: [plotNormalizerRule()],
	tokenCategories: {
		PLOT: "keyword",
	},
};
