/**
 * The engine-facing layer over StatisticsMath.ts: read the list arguments off the
 * engine's values, apply a pure function, and return a Number. A bad shape (a
 * non-list, a length mismatch, too few points) is answered with a structured
 * Error naming the problem, never a wrong number.
 */
import {
	Value, numberValue, errorValue, ValueType, type MatrixData, type RangeData,
} from "@solve-js/vm/Value";
import {
	correlation, slope, intercept, rSquared,
	percentile, zScore,
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

/**
 * Refuses a call given a number of arguments its form does not read, or null
 * when the count is one it does.
 *
 * Every handler here used to read the arguments it wanted and never look at the
 * rest, so an extra one was dropped without a word: `normalcdf(110, 100, 15)`
 * read only the 110, took it as a z-score and answered 1, and
 * `percentile([1, 2, 3], 50, 9)` quietly lost the 9. An argument a reader typed
 * either changes the answer or is refused by name.
 *
 * @param name - The function as the reader wrote it.
 * @param args - The arguments the call was given.
 * @param counts - Every argument count the function accepts.
 * @param usage - An example call, shown in the message.
 */
export function argumentCount(name: string, args: readonly Value[], counts: readonly number[], usage: string): Value | null {
	if (counts.includes(args.length)) return null;
	const accepted = counts.join(" or ");
	const plural = counts.length === 1 && counts[0] === 1 ? "argument" : "arguments";
	return errorValue(
		"STAT_ARGUMENT_COUNT",
		`${name} takes ${accepted} ${plural}, but was given ${args.length}, as in ${usage}`,
	);
}

/** A two-list statistic (correlation, slope, intercept, r squared). */
function pairStat(name: string, fn: (xs: number[], ys: number[]) => number): (args: Value[]) => Value {
	return (args) => {
		const count = argumentCount(name, args, [2], `${name.replace(" ", "")}([1, 2, 3], [2, 4, 6])`);
		if (count) return count;
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

/**
 * The statistics package's list plugin functions, keyed by the names the
 * parselets emit. The distributions are in DistributionPluginFunctions.ts.
 */
export const STATISTICS_PLUGIN_FUNCTIONS: Record<string, (args: Value[]) => Value> = {
	statCorrelation: pairStat("correlation", correlation),
	statSlope: pairStat("slope", slope),
	statIntercept: pairStat("intercept", intercept),
	statRSquared: pairStat("r squared", rSquared),

	// `percentile([list], p)`
	statPercentile: (args: Value[]): Value => {
		const count = argumentCount("percentile", args, [2], "percentile([1, 2, 3], 90)");
		if (count) return count;
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
		const count = argumentCount("zscore", args, [2], "zscore(5, [1, 2, 3])");
		if (count) return count;
		const x = args[0];
		const xs = toNumberList(args[1]);
		if (x?.type !== ValueType.Number) return errorValue("STAT_EXPECTED_VALUE", "zscore expects a value first, e.g. zscore(5, [1, 2, 3])");
		if (xs === null || xs.length < 2) return errorValue("STAT_EXPECTED_LIST", "zscore expects a list of at least two values");
		return numberValue(zScore(x.value as number, xs));
	},
};
