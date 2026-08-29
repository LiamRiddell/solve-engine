/**
 * The engine-facing layer over StatisticsMath.ts: read the list arguments off the
 * engine's values, apply a pure function, and return a Number. A bad shape (a
 * non-list, a length mismatch, too few points) is answered with a structured
 * Error naming the problem, never a wrong number.
 */
import {
	numberValue, errorValue, ValueType, type Value, type MatrixData, type RangeData,
} from "@solve-js/vm/Value";
import {
	correlation, slope, intercept, rSquared,
	percentile, zScore, normalCdf, normalPdf,
} from "./StatisticsMath";

/**
 * Read a value as a plain list of numbers. A bracketed list is a Matrix (a row
 * or column vector); a `min:max` range expands to its inclusive integers; a bare
 * number is a one-element list. Anything else, or a matrix carrying symbolic
 * cells, is not a list of numbers.
 */
function toNumberList(value: Value | undefined): number[] | null {
	if (!value) return null;
	if (value.type === ValueType.Matrix) {
		const m = value.value as MatrixData;
		if (m.hasSymbolic) return null;
		if (m.rows !== 1 && m.cols !== 1) return null;
		return (m.data as number[]).slice();
	}
	if (value.type === ValueType.Range) {
		const r = value.value as RangeData;
		const out: number[] = [];
		for (let i = Math.ceil(r.min); i <= r.max; i++) out.push(i);
		return out;
	}
	if (value.type === ValueType.Number) return [value.value as number];
	return null;
}

/** A two-list statistic (correlation, slope, intercept, r squared). */
function pairStat(name: string, fn: (xs: number[], ys: number[]) => number): (args: Value[]) => Value {
	return (args) => {
		const xs = toNumberList(args[0]);
		const ys = toNumberList(args[1]);
		if (xs === null || ys === null) {
			return errorValue("STAT_EXPECTED_LISTS", `${name} expects two lists, e.g. ${name} of [1, 2, 3] and [2, 4, 6]`);
		}
		if (xs.length !== ys.length) {
			return errorValue("STAT_LENGTH_MISMATCH", `${name}: the two lists must be the same length (got ${xs.length} and ${ys.length})`);
		}
		if (xs.length < 2) {
			return errorValue("STAT_TOO_FEW", `${name} needs at least two paired points`);
		}
		return numberValue(fn(xs, ys));
	};
}

/** The statistics package's plugin functions, keyed by the names the parselets emit. */
export const STATISTICS_PLUGIN_FUNCTIONS: Record<string, (args: Value[]) => Value> = {
	statCorrelation: pairStat("correlation", correlation),
	statSlope: pairStat("slope", slope),
	statIntercept: pairStat("intercept", intercept),
	statRSquared: pairStat("r squared", rSquared),

	// `percentile([list], p)`
	statPercentile: (args: Value[]): Value => {
		const xs = toNumberList(args[0]);
		const p = args[1];
		if (xs === null) return errorValue("STAT_EXPECTED_LIST", "percentile expects a list, e.g. percentile([1, 2, 3], 90)");
		if (xs.length === 0) return errorValue("STAT_EMPTY", "percentile needs at least one value");
		if (p?.type !== ValueType.Number) return errorValue("STAT_EXPECTED_PERCENT", "percentile needs a percentage, e.g. percentile([...], 90)");
		const pv = p.value as number;
		if (pv < 0 || pv > 100) return errorValue("STAT_PERCENT_RANGE", "a percentile is between 0 and 100");
		return numberValue(percentile(xs, pv));
	},

	// `zscore(x, [list])`
	statZScore: (args: Value[]): Value => {
		const x = args[0];
		const xs = toNumberList(args[1]);
		if (x?.type !== ValueType.Number) return errorValue("STAT_EXPECTED_VALUE", "zscore expects a value first, e.g. zscore(5, [1, 2, 3])");
		if (xs === null || xs.length < 2) return errorValue("STAT_EXPECTED_LIST", "zscore expects a list of at least two values");
		return numberValue(zScore(x.value as number, xs));
	},

	// Standard-normal `normalcdf(z)` and `normalpdf(z)`.
	statNormalCdf: (args: Value[]): Value => {
		const z = args[0];
		if (z?.type !== ValueType.Number) return errorValue("STAT_EXPECTED_VALUE", "normalcdf expects a number");
		return numberValue(normalCdf(z.value as number));
	},
	statNormalPdf: (args: Value[]): Value => {
		const z = args[0];
		if (z?.type !== ValueType.Number) return errorValue("STAT_EXPECTED_VALUE", "normalpdf expects a number");
		return numberValue(normalPdf(z.value as number));
	},
};
