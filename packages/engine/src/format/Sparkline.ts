import { Value, ValueType, type MatrixData, type RangeData } from "@solve-js/vm/Value";

/**
 * The numeric metadata an inline sparkline draws: a downsampled series and the
 * true extent of the data it came from. Never pixels, matching the colour
 * swatch: the engine says what to draw, each frontend draws it (issue #186).
 */
export interface SparklineData {
	/** The series to draw, at most {@link SPARKLINE_MAX_SAMPLES} points. */
	readonly series: number[];
	/** The smallest value in the full series, for scaling. */
	readonly min: number;
	/** The largest value in the full series, for scaling. */
	readonly max: number;
}

/** The series is capped so the metadata stays small across the worker boundary. */
export const SPARKLINE_MAX_SAMPLES = 32;

/** Whether a matrix is a purely numeric vector (a single row or column). */
function numericVector(m: MatrixData): number[] | null {
	if (m.hasSymbolic) return null;
	if (m.rows !== 1 && m.cols !== 1) return null;
	const nums: number[] = [];
	for (const cell of m.data) {
		// "Purely numeric": a boolean or symbolic cell is not plottable.
		if (typeof cell !== "number" || !Number.isFinite(cell)) return null;
		nums.push(cell);
	}
	return nums;
}

/**
 * Picks at most `cap` evenly-spaced samples from a series, keeping the first and
 * last so the drawn shape still starts and ends where the data does. A series
 * already within the cap is returned unchanged.
 */
function downsample(nums: number[], cap: number): number[] {
	if (nums.length <= cap) return [...nums];
	const out: number[] = [];
	for (let i = 0; i < cap; i++) {
		out.push(nums[Math.round((i * (nums.length - 1)) / (cap - 1))]);
	}
	return out;
}

/**
 * The sparkline metadata for a value, or `null` when there is nothing plottable.
 *
 * A purely numeric vector (a 1xN or Nx1 matrix) draws its cells; a range draws
 * its integers, sampled directly across the bounds rather than expanded, so a
 * wide range costs nothing to plot. Anything else, a mixed or non-numeric list,
 * a 2-D matrix, a scalar, carries no series and draws nothing, exactly the
 * boundary the issue names. A series of fewer than two points is not a line, so
 * it too returns null.
 */
export function sparklineFor(value: Value): SparklineData | null {
	if (value.type === ValueType.Matrix) {
		const nums = numericVector(value.value as MatrixData);
		if (nums === null || nums.length < 2) return null;
		return { series: downsample(nums, SPARKLINE_MAX_SAMPLES), min: Math.min(...nums), max: Math.max(...nums) };
	}

	if (value.type === ValueType.Range) {
		const { min, max } = value.value as RangeData;
		const count = max - min + 1;
		if (count < 2) return null;
		const take = Math.min(count, SPARKLINE_MAX_SAMPLES);
		const series: number[] = [];
		for (let i = 0; i < take; i++) {
			// Evenly spaced integer stops across the range, endpoints included.
			series.push(min + Math.round((i * (count - 1)) / (take - 1)));
		}
		return { series, min, max };
	}

	return null;
}
