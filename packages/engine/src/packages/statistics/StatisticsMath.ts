/**
 * Statistics as pure functions: number arrays in, a number out, no engine types
 * and no side effects, so each is unit-tested on its own against known values.
 * The package layer reads lists off the engine's values and calls these.
 *
 * "Population" forms are used throughout (dividing by n, not n-1), to match the
 * standard deviation the engine's existing `stdev` already reports, so a z-score
 * here and a spread there speak the same language.
 */

/** The arithmetic mean. */
export function mean(xs: readonly number[]): number {
	return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** The population variance. */
export function variance(xs: readonly number[]): number {
	const m = mean(xs);
	return xs.reduce((a, x) => a + (x - m) * (x - m), 0) / xs.length;
}

/** The population standard deviation. */
export function stdev(xs: readonly number[]): number {
	return Math.sqrt(variance(xs));
}

/**
 * Pearson's correlation coefficient between two equal-length lists, from -1
 * (opposite) through 0 (unrelated) to 1 (identical trend). Returns NaN if either
 * list has no spread (a flat line has no direction to correlate).
 */
export function correlation(xs: readonly number[], ys: readonly number[]): number {
	const mx = mean(xs), my = mean(ys);
	let sxy = 0, sxx = 0, syy = 0;
	for (let i = 0; i < xs.length; i++) {
		const dx = xs[i] - mx, dy = ys[i] - my;
		sxy += dx * dy;
		sxx += dx * dx;
		syy += dy * dy;
	}
	const denom = Math.sqrt(sxx * syy);
	return denom === 0 ? NaN : sxy / denom;
}

/** The slope of the least-squares best-fit line y = slope·x + intercept. */
export function slope(xs: readonly number[], ys: readonly number[]): number {
	const mx = mean(xs), my = mean(ys);
	let sxy = 0, sxx = 0;
	for (let i = 0; i < xs.length; i++) {
		const dx = xs[i] - mx;
		sxy += dx * (ys[i] - my);
		sxx += dx * dx;
	}
	return sxx === 0 ? NaN : sxy / sxx;
}

/** The intercept of the least-squares best-fit line. */
export function intercept(xs: readonly number[], ys: readonly number[]): number {
	return mean(ys) - slope(xs, ys) * mean(xs);
}

/** The coefficient of determination, r², the square of the correlation. */
export function rSquared(xs: readonly number[], ys: readonly number[]): number {
	const r = correlation(xs, ys);
	return r * r;
}

/**
 * The value at the p-th percentile (0 to 100), by linear interpolation between the
 * two nearest ranks: the method NumPy and most spreadsheets use by default. The
 * list is sorted first; p=50 is the median.
 */
export function percentile(xs: readonly number[], p: number): number {
	const sorted = [...xs].sort((a, b) => a - b);
	if (sorted.length === 1) return sorted[0];
	const rank = ((p / 100) * (sorted.length - 1));
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

/** The standardised score of x against a list: (x - mean) / population stdev. */
export function zScore(x: number, xs: readonly number[]): number {
	const s = stdev(xs);
	return s === 0 ? NaN : (x - mean(xs)) / s;
}

/**
 * The error function, via the Abramowitz & Stegun 7.1.26 approximation
 * (maximum error about 1.5e-7), the building block of the normal CDF.
 */
function erf(x: number): number {
	const sign = x < 0 ? -1 : 1;
	const t = 1 / (1 + 0.3275911 * Math.abs(x));
	const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
	return sign * y;
}

/** The standard-normal cumulative probability P(Z ≤ z). */
export function normalCdf(z: number): number {
	return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** The standard-normal probability density at z. */
export function normalPdf(z: number): number {
	return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}
