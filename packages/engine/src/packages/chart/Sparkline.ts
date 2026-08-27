import { Value, ValueType, type ChartData, type MatrixData, type RangeData } from "@solve-js/vm/Value";

/** A sparkline's series is capped so the chart data stays small across the worker. */
export const SPARKLINE_MAX_SAMPLES = 32;

/** The numbers of a purely numeric vector (a single row or column), or null. */
function numericVector(m: MatrixData): number[] | null {
	if (m.hasSymbolic) return null;
	if (m.rows !== 1 && m.cols !== 1) return null;
	const nums: number[] = [];
	for (const cell of m.data) {
		if (typeof cell !== "number" || !Number.isFinite(cell)) return null;
		nums.push(cell);
	}
	return nums;
}

/** The integers of a range, sampled directly (never expanded) up to the cap. */
function rangeSeries(r: RangeData): number[] {
	const count = r.max - r.min + 1;
	const take = Math.min(count, SPARKLINE_MAX_SAMPLES);
	const series: number[] = [];
	for (let i = 0; i < take; i++) {
		series.push(r.min + Math.round((i * (count - 1)) / (take - 1)));
	}
	return series;
}

/** Evenly-spaced samples of a series, endpoints kept, when it exceeds the cap. */
function downsample(nums: number[], cap: number): number[] {
	if (nums.length <= cap) return [...nums];
	const out: number[] = [];
	for (let i = 0; i < cap; i++) out.push(nums[Math.round((i * (nums.length - 1)) / (cap - 1))]);
	return out;
}

/**
 * Builds the sparkline {@link ChartData} for a value, or null when there is
 * nothing to draw. A purely numeric vector (a 1xN or Nx1 matrix) or a range
 * qualifies; a mixed or non-numeric list, a 2-D matrix, or a scalar does not,
 * and a series of fewer than two points is not a line. The series is downsampled
 * to {@link SPARKLINE_MAX_SAMPLES}, and the label keeps the whole list only when
 * it is short enough to read.
 */
export function sparklineChart(value: Value): ChartData | null {
	let full: number[] | null = null;
	if (value.type === ValueType.Matrix) {
		full = numericVector(value.value as MatrixData);
	} else if (value.type === ValueType.Range) {
		const r = value.value as RangeData;
		full = r.max - r.min + 1 >= 2 ? rangeSeries(r) : null;
	}
	if (!full || full.length < 2) return null;

	const series = downsample(full, SPARKLINE_MAX_SAMPLES);
	const min = Math.min(...full);
	const max = Math.max(...full);
	const label = full.length <= SPARKLINE_MAX_SAMPLES ? `[${full.join(", ")}]` : `sparkline of ${full.length} values`;
	return {
		kind: "sparkline",
		points: series.map((v, i) => [i, v] as const),
		label,
		domain: [0, series.length - 1],
		range: [min, max],
	};
}
