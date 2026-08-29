/**
 * Reduce a ratio to its lowest whole-number terms, as a pure function: whole
 * numbers in, an `a:b:c` string out, or null for an input it cannot reduce (a
 * non-whole part, a part that is not positive, or fewer than two parts).
 */

function gcd(a: number, b: number): number {
	a = Math.abs(a);
	b = Math.abs(b);
	while (b) { [a, b] = [b, a % b]; }
	return a;
}

/** The ratio reduced by the greatest common divisor, e.g. [1920, 1080] to "16:9". */
export function reduceRatio(parts: readonly number[]): string | null {
	if (parts.length < 2) return null;
	if (parts.some((n) => !Number.isInteger(n) || n <= 0)) return null;
	const divisor = parts.reduce((g, n) => gcd(g, n), 0) || 1;
	return parts.map((n) => n / divisor).join(":");
}
