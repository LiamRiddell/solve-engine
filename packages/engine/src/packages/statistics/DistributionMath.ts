/**
 * Probability distributions and the special functions behind them, as pure
 * functions: numbers in, a number out, no engine types and no side effects, so
 * each is pinned on its own against reference values computed independently.
 *
 * Accuracy is the design constraint throughout. A probability is often read in
 * a tail (a p-value of 0.001, the chance of 40 heads in 50 tosses), where a
 * formula accurate to a fixed number of decimal places is accurate to none of
 * the significant ones. So every function here is built to be accurate
 * *relative to its own size*, to twelve significant digits or better. The one
 * exception is the cumulative binomial past about a billion trials, whose
 * continued fraction loses digits slowly as the counts grow (ten are left at
 * 1e11, seven at 1e15).
 *
 * - The error function is an everywhere-positive series near zero and a
 *   continued fraction for the tail, so neither side subtracts two nearly equal
 *   numbers.
 * - A probability mass (binomial, Poisson) and the prefactor of each incomplete
 *   function are written with Loader's saddle-point form: the Stirling-series
 *   remainder and a deviance term that is expanded as a series when its two
 *   arguments are close. Taking the difference of two large log-gamma values
 *   instead loses a digit per power of ten in the counts.
 * - The regularised incomplete gamma and beta functions compute directly
 *   whichever side can be small (by a series or a continued fraction) and
 *   reach the other by subtracting from 1.
 * - Student's t with 10,000 or more degrees of freedom is an expansion in
 *   incomplete gamma functions, since the beta continued fraction loses a digit
 *   per power of ten in the degrees of freedom.
 * - The quantiles are solved by a bracketed Newton iteration on whichever of the
 *   two forms keeps the target free of cancellation: the logarithm of the tail
 *   far out, the distance from the median near the middle.
 *
 * A computation that has not converged within its iteration budget returns NaN
 * rather than its last partial answer, and the package layer turns that into a
 * named Error.
 */

/** ln(√(2π)), the constant of Stirling's formula. */
const LN_SQRT_2PI = 0.9189385332046728;

/** √(2π), the normal density's normalising constant. */
const SQRT_2PI = 2.5066282746310002;

/** √π. */
const SQRT_PI = 1.772453850905516;

/** The relative tolerance each series and continued fraction iterates to. */
const TOLERANCE = 1e-16;

/** Stands in for zero in a continued fraction's denominators (modified Lentz). */
const TINY = 1e-300;

/**
 * The iteration budget of the incomplete gamma and beta evaluations. Their
 * series and fractions converge in a number of steps that grows with the square
 * root of the parameters, so a budget this size covers counts into the tens of
 * billions before a call gives up and reports that it did not converge.
 */
const MAX_ITERATIONS = 1_000_000;

// ── The error function ───────────────────────────────────────────────────────

/**
 * Where the error function switches from its series to its continued fraction.
 * Below it erfc is at least 0.157, so erfc = 1 - erf keeps its significant
 * digits; above it the fraction converges in under two hundred steps, and
 * erfc(2) (about 0.0047) is not left to the subtraction, which would lose two.
 */
const ERF_SWITCH = 1;

/**
 * How far out e^(-x²) and e^(-x²/2) are worked out. Beyond 40 both have
 * underflowed to zero in a double (e^-800 is below the smallest one), so the
 * answer is 0 without the arithmetic, which is what keeps a value near the top
 * of the double range from overflowing into NaN.
 */
const UNDERFLOW_BEYOND = 40;

/**
 * e^(-x²), accurate to the last place.
 *
 * Squaring x rounds, and the rounding error of x² is multiplied by x² again in
 * the exponent, so e^(-x*x) loses about three digits by x = 26. Splitting x into
 * a head with few enough bits that its square is exact, and a small remainder,
 * keeps the whole exponent exact but for the remainder's tiny contribution.
 */
function expMinusSquare(x: number): number {
	// Past 40 the answer has underflowed to zero anyway (e^-1600), and near the
	// top of the double range `x * 4096` below overflows: the head became
	// infinite and the product NaN, so `normalcdf(1e308)` was NaN (#601).
	if (!(Math.abs(x) < UNDERFLOW_BEYOND)) return 0;
	const head = Math.trunc(x * 4096) / 4096;
	return Math.exp(-head * head) * Math.exp(-(x - head) * (x + head));
}

/** e^(-z²/2), split the same way as {@link expMinusSquare} and for the same reason. */
function expMinusHalfSquare(z: number): number {
	// As expMinusSquare: e^-800 has underflowed, and the split below overflows (#601).
	if (!(Math.abs(z) < UNDERFLOW_BEYOND)) return 0;
	const head = Math.trunc(z * 4096) / 4096;
	return Math.exp(-0.5 * head * head) * Math.exp(-0.5 * (z - head) * (z + head));
}

/**
 * erf(x) by its everywhere-positive series,
 * erf(x) = 2/√π · e^(-x²) · Σ 2ⁿ x^(2n+1) / (1·3·5···(2n+1)),
 * whose terms all share the sign of x, so nothing cancels. Used for |x| < 1.
 */
function erfSeries(x: number): number {
	const twoX2 = 2 * x * x;
	let term = x;
	let sum = x;
	for (let n = 1; n < 200; n++) {
		term *= twoX2 / (2 * n + 1);
		sum += term;
		if (Math.abs(term) <= Math.abs(sum) * TOLERANCE) break;
	}
	return (2 / SQRT_PI) * expMinusSquare(x) * sum;
}

/**
 * erfc(x) for x ≥ 1 by the continued fraction
 * √π e^(x²) erfc(x) = 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + ...)))),
 * evaluated with the modified Lentz method. Accurate in the far tail, where
 * 1 - erf(x) would be 1 - 1.
 */
function erfcFraction(x: number): number {
	let f = x;
	let c = x;
	let d = 0;
	for (let n = 1; n < 500; n++) {
		const a = n / 2;
		d = x + a * d;
		if (d === 0) d = TINY;
		d = 1 / d;
		c = x + a / c;
		if (c === 0) c = TINY;
		const delta = c * d;
		f *= delta;
		if (Math.abs(delta - 1) <= TOLERANCE) break;
	}
	return expMinusSquare(x) / (SQRT_PI * f);
}

/**
 * The error function, erf(x) = 2/√π ∫₀ˣ e^(-t²) dt: the share of a normal
 * curve (with variance 1/2) within x of its centre. Odd, from -1 to 1.
 */
export function erf(x: number): number {
	if (Number.isNaN(x)) return NaN;
	if (!Number.isFinite(x)) return Math.sign(x);
	if (Math.abs(x) < ERF_SWITCH) return erfSeries(x);
	const tail = erfcFraction(Math.abs(x));
	return x > 0 ? 1 - tail : tail - 1;
}

/**
 * The complementary error function, erfc(x) = 1 - erf(x), computed directly so
 * that a far-tail value keeps its significant digits (erfc(6) is about 2e-17,
 * which 1 - erf(6) would round to 0).
 */
export function erfc(x: number): number {
	if (Number.isNaN(x)) return NaN;
	if (!Number.isFinite(x)) return x > 0 ? 0 : 2;
	if (x >= ERF_SWITCH) return erfcFraction(x);
	if (x > -ERF_SWITCH) return 1 - erfSeries(x);
	return 2 - erfcFraction(-x);
}

// ── The normal distribution ─────────────────────────────────────────────────

/**
 * The standard-normal cumulative probability P(Z ≤ z), as erfc(-z/√2)/2, which
 * keeps the lower tail's significant digits (normalCdf(-10) is about 7.6e-24,
 * not 0).
 */
export function normalCdf(z: number): number {
	return 0.5 * erfc(-z / Math.SQRT2);
}

/** The standard-normal probability density at z, e^(-z²/2) / √(2π). */
export function normalPdf(z: number): number {
	return expMinusHalfSquare(z) / SQRT_2PI;
}

/**
 * A starting point for the normal quantile of a lower-tail probability p ≤ 1/2:
 * the rational approximation of Abramowitz and Stegun 26.2.23, within 4.5e-4 of
 * the answer, which the Newton iteration then refines to full precision.
 */
function normalQuantileGuess(p: number): number {
	const t = Math.sqrt(-2 * Math.log(p));
	const z = -(t - (2.515517 + t * (0.802853 + t * 0.010328)) / (1 + t * (1.432788 + t * (0.189269 + t * 0.001308))));
	// Near p = 1/2 the approximation's error is larger than the answer, and it
	// can land on the wrong side of zero; the line through the median is closer.
	return Math.min(z, (p - 0.5) * SQRT_2PI);
}

/**
 * The standard-normal quantile: the z with P(Z ≤ z) = p, for 0 < p < 1. The
 * inverse of {@link normalCdf}, so normalInv(0.975) is the 1.96 of a 95%
 * interval. Returns NaN outside the open interval.
 */
export function normalInv(p: number): number {
	if (!(p > 0 && p < 1)) return NaN;
	if (p === 0.5) return 0;
	// Solve in the lower half and reflect. 1 - p is exact for p ≥ 1/2.
	if (p > 0.5) return -normalInv(1 - p);
	return lowerQuantile(
		p,
		normalQuantileGuess(p),
		(z) => normalCdf(z),
		(z) => 0.5 * erf(z / Math.SQRT2),
		(z) => normalPdf(z),
	);
}

// ── Log-gamma and gamma ────────────────────────────────────────────────────

/** The Lanczos approximation's shift, g = 7, with its nine coefficients. */
const LANCZOS_G = 7;
const LANCZOS = [
	0.9999999999998099, 676.5203681218851, -1259.1392167224028,
	771.3234287776531, -176.6150291621406, 12.507343278686905,
	-0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
];

/** The Lanczos series A(x) for Γ(x + 1) = √(2π) (x + g + 1/2)^(x + 1/2) e^-(x + g + 1/2) A(x). */
function lanczosSum(x: number): number {
	let a = LANCZOS[0];
	for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i);
	return a;
}

/** Euler's constant γ, the slope of -ln Γ at 1. */
const EULER_GAMMA = 0.5772156649015329;

/**
 * ζ(k) for k = 2 to 25, Riemann's zeta function at the whole numbers, each the
 * nearest double to its true value: ζ(k)/k are the Taylor coefficients of
 * ln Γ(1 + ε).
 */
const ZETA = [
	1.6449340668482264, 1.2020569031595942, 1.0823232337111381, 1.03692775514337,
	1.0173430619844492, 1.008349277381923, 1.0040773561979444, 1.0020083928260821,
	1.000994575127818, 1.0004941886041194, 1.000246086553308, 1.0001227133475785,
	1.0000612481350588, 1.000030588236307, 1.0000152822594086, 1.0000076371976379,
	1.000003817293265, 1.0000019082127165, 1.0000009539620338, 1.0000004769329869,
	1.0000002384505027, 1.000000119219926, 1.000000059608189, 1.0000000298035034,
];

/**
 * ln Γ(1 + ε) for |ε| < 0.2 by its Taylor series -γε + Σ ζ(k)(-ε)ᵏ/k. The
 * Lanczos form reaches a value near zero by cancelling terms of size one, so it
 * is accurate to fifteen decimal places but not to fifteen significant digits
 * around the zeros of ln Γ at 1 and 2; the series is accurate to both.
 */
function logGammaNearOne(e: number): number {
	const m = -e;
	let sum = 0;
	// Horner's rule over ζ(k)/k, entry i holding k = i + 2.
	for (let i = ZETA.length - 1; i >= 0; i--) sum = ZETA[i] / (i + 2) + m * sum;
	return -EULER_GAMMA * e + m * m * sum;
}

/**
 * ln Γ(x) for x > 0, by the Lanczos approximation (g = 7, nine terms), accurate
 * to about fifteen significant digits of Γ, which is fifteen decimal places of
 * its logarithm, and by a Taylor series near 1 and 2, where the logarithm is
 * zero and decimal places are not enough. NaN for x ≤ 0, where Γ has poles or
 * changes sign.
 */
export function logGamma(x: number): number {
	if (!(x > 0)) return NaN;
	if (x === Infinity) return Infinity;
	if (Math.abs(x - 1) < 0.2) return logGammaNearOne(x - 1);
	if (Math.abs(x - 2) < 0.2) return Math.log1p(x - 2) + logGammaNearOne(x - 2);
	if (x < 0.5) {
		// Reflection keeps the approximation on the side it is accurate on:
		// Γ(x) Γ(1 - x) = π / sin(πx), and sin(πx) > 0 for 0 < x < 1/2.
		return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
	}
	const shifted = x - 1;
	const t = shifted + LANCZOS_G + 0.5;
	return LN_SQRT_2PI + (shifted + 0.5) * Math.log(t) - t + Math.log(lanczosSum(shifted));
}

/**
 * sin(πx), with the argument reduced exactly first, so that it is exactly zero
 * at every integer and keeps its digits near one (Math.sin(Math.PI * 1e6) is
 * about -2e-10, not 0).
 */
function sinPi(x: number): number {
	const r = x - 2 * Math.round(x / 2); // in [-1, 1], exact
	if (r === 0 || Math.abs(r) === 1) return 0;
	if (Math.abs(r) === 0.5) return Math.sign(r);
	return Math.sin(Math.PI * r);
}

/** The largest x with a finite Γ(x) in double precision, where Γ(x) reaches 1.797e308. */
export const GAMMA_MAX = 171.6243769563027;

/**
 * The gamma function Γ(x), which extends the factorial to every real number
 * but zero and the negative whole numbers: Γ(n) = (n - 1)! for a whole n.
 *
 * A whole number up to 171 is an exact product, so gamma(5) is 24 and not
 * 23.999999999999996. Otherwise the Lanczos approximation for x ≥ 1/2 and the
 * reflection formula Γ(x) = π / (sin(πx) Γ(1 - x)) below it. NaN at a pole,
 * Infinity past {@link GAMMA_MAX}.
 */
export function gamma(x: number): number {
	if (Number.isNaN(x)) return NaN;
	if (Number.isInteger(x)) {
		if (x <= 0) return NaN;
		if (x > 171) return Infinity;
		let product = 1;
		for (let i = 2; i < x; i++) product *= i;
		return product;
	}
	if (x > GAMMA_MAX) return Infinity;
	if (x >= 0.5) {
		const shifted = x - 1;
		const t = shifted + LANCZOS_G + 0.5;
		// t^(x - 1/2) e^-t in two halves, so the power cannot overflow before
		// the exponential brings it back down near the top of the range.
		const half = Math.pow(t, (shifted + 0.5) / 2);
		return SQRT_2PI * half * (half * Math.exp(-t)) * lanczosSum(shifted);
	}
	const s = sinPi(x);
	if (1 - x <= GAMMA_MAX) return Math.PI / (s * gamma(1 - x));
	// Γ(1 - x) overflows but the quotient does not (yet): go through logs.
	return Math.sign(s) * Math.exp(Math.log(Math.PI / Math.abs(s)) - logGamma(1 - x));
}

// ── Loader's saddle-point terms ───────────────────────────────────────────────

/**
 * The Stirling-series remainder δ(n) = ln Γ(n + 1) - ln(√(2πn) (n/e)ⁿ), for real
 * n > 0. The series 1/(12n) - 1/(360n³) + ... past 15, where five terms reach
 * double precision; the definition through {@link logGamma} below it.
 */
function stirlingError(n: number): number {
	if (n > 15) {
		const nn = n * n;
		return (1 / 12 - (1 / 360 - (1 / 1260 - (1 / 1680 - 1 / 1188 / nn) / nn) / nn) / nn) / n;
	}
	return logGamma(n + 1) - (n + 0.5) * Math.log(n) + n - LN_SQRT_2PI;
}

/**
 * The deviance term x ln(x/m) + m - x, which is small when x is close to m and
 * is then summed as a series in v = (x - m)/(x + m) rather than computed as the
 * difference of two large numbers (Loader, 2000).
 */
function deviance(x: number, m: number): number {
	if (x === 0) return m;
	if (Math.abs(x - m) < 0.1 * (x + m)) {
		let v = (x - m) / (x + m);
		let sum = (x - m) * v;
		let term = 2 * x * v;
		v *= v;
		for (let j = 1; j < 1000; j++) {
			term *= v;
			const next = sum + term / (2 * j + 1);
			if (next === sum) return next;
			sum = next;
		}
		return sum;
	}
	return x * Math.log(x / m) + m - x;
}

/**
 * e^(-λ) λˣ / Γ(x + 1) for real x ≥ 0: the Poisson probability of x, and the
 * prefactor of the incomplete gamma function.
 */
function poissonTerm(x: number, lambda: number): number {
	if (x === 0) return Math.exp(-lambda);
	if (lambda === 0) return 0;
	return Math.exp(-stirlingError(x) - deviance(x, lambda)) / Math.sqrt(2 * Math.PI * x);
}

/**
 * C(n, x) pˣ q^(n - x) for real 0 ≤ x ≤ n, with q = 1 - p passed separately so
 * that a q near 0 keeps its digits: the binomial probability of x.
 */
function binomialTerm(x: number, n: number, p: number, q: number): number {
	if (p === 0) return x === 0 ? 1 : 0;
	if (q === 0) return x === n ? 1 : 0;
	if (x === 0) return Math.exp(n * Math.log1p(-p));
	if (x === n) return Math.exp(n * Math.log(p));
	const lc = stirlingError(n) - stirlingError(x) - stirlingError(n - x) - deviance(x, n * p) - deviance(n - x, n * q);
	const lf = Math.log(2 * Math.PI) + Math.log(x) + Math.log1p(-x / n);
	return Math.exp(lc - 0.5 * lf);
}

// ── The regularised incomplete gamma function ─────────────────────────────────

/**
 * The regularised incomplete gamma functions P(a, x) and Q(a, x) = 1 - P(a, x),
 * for a > 0 and x ≥ 0. Whichever of the two can be small where x lies is
 * computed directly (the power series for P when x < a + 1, the continued
 * fraction for Q otherwise) and the other by subtraction, so a small answer
 * keeps its significant digits and a moderate one loses at most a digit.
 */
function incompleteGamma(a: number, x: number): { p: number; q: number } {
	if (x === 0) return { p: 0, q: 1 };
	if (x === Infinity) return { p: 1, q: 0 };
	if (x < a + 1) {
		// P(a, x) = e^-x xᵃ / Γ(a + 1) · Σ xⁿ / ((a + 1)(a + 2)···(a + n))
		let term = 1;
		let sum = 1;
		let converged = false;
		for (let n = 1; n < MAX_ITERATIONS; n++) {
			term *= x / (a + n);
			sum += term;
			if (term <= sum * TOLERANCE) {
				converged = true;
				break;
			}
		}
		if (!converged) return { p: NaN, q: NaN };
		const p = poissonTerm(a, x) * sum;
		return { p, q: 1 - p };
	}
	// Q(a, x) = e^-x xᵃ / Γ(a) · 1/(x + 1 - a - 1(1 - a)/(x + 3 - a - 2(2 - a)/(x + 5 - a - ...)))
	let b = x + 1 - a;
	let c = 1 / TINY;
	let d = 1 / b;
	let h = d;
	let converged = false;
	for (let i = 1; i < MAX_ITERATIONS; i++) {
		const an = -i * (i - a);
		b += 2;
		d = an * d + b;
		if (Math.abs(d) < TINY) d = TINY;
		c = b + an / c;
		if (Math.abs(c) < TINY) c = TINY;
		d = 1 / d;
		const delta = d * c;
		h *= delta;
		if (Math.abs(delta - 1) <= TOLERANCE) {
			converged = true;
			break;
		}
	}
	if (!converged) return { p: NaN, q: NaN };
	// e^-x xᵃ / Γ(a) is a times the Poisson term e^-x xᵃ / Γ(a + 1).
	const q = a * poissonTerm(a, x) * h;
	return { p: 1 - q, q };
}

// ── The regularised incomplete beta function ──────────────────────────────────

/**
 * xᵃ yᵇ / B(a, b), with y = 1 - x, in Loader's form: the Stirling remainders of
 * a, b and a + b and two deviance terms, so large a and b (a binomial with a
 * million trials) keep their digits.
 *
 * The form rests on xn + yn = n exactly (n = a + b). The smaller of x and y is
 * the one known to all its digits, so its share is computed and the other is n
 * minus it: taking both from x and y, which each carry a rounding, leaves the
 * sum off by n times that rounding, which is a 5% error at a = 5e14.
 */
function betaPrefactor(x: number, y: number, a: number, b: number): number {
	const n = a + b;
	let xn: number;
	let yn: number;
	if (y <= x) {
		yn = y * n;
		xn = n - yn;
	} else {
		xn = x * n;
		yn = n - xn;
	}
	const log = stirlingError(n) - stirlingError(a) - stirlingError(b) - deviance(a, xn) - deviance(b, yn);
	return Math.sqrt((a * b) / (2 * Math.PI * n)) * Math.exp(log);
}

/**
 * I_x(a, b) by its continued fraction (Abramowitz and Stegun 26.5.8), which
 * converges quickly for x < (a + 1)/(a + b + 2), where the answer is the
 * smaller side. NaN if it has not converged within the budget.
 */
function incompleteBetaFraction(x: number, y: number, a: number, b: number): number {
	let c = 1;
	let d = 1 - ((a + b) * x) / (a + 1);
	if (Math.abs(d) < TINY) d = TINY;
	d = 1 / d;
	let h = d;
	for (let m = 1; m < MAX_ITERATIONS; m++) {
		const m2 = 2 * m;
		// The even step, d₂ₘ = m(b - m)x / ((a + 2m - 1)(a + 2m)).
		let an = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
		d = 1 + an * d;
		if (Math.abs(d) < TINY) d = TINY;
		c = 1 + an / c;
		if (Math.abs(c) < TINY) c = TINY;
		d = 1 / d;
		h *= d * c;
		// The odd step, d₂ₘ₊₁ = -(a + m)(a + b + m)x / ((a + 2m)(a + 2m + 1)).
		an = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
		d = 1 + an * d;
		if (Math.abs(d) < TINY) d = TINY;
		c = 1 + an / c;
		if (Math.abs(c) < TINY) c = TINY;
		d = 1 / d;
		const delta = d * c;
		h *= delta;
		if (Math.abs(delta - 1) <= TOLERANCE) return (betaPrefactor(x, y, a, b) / a) * h;
	}
	return NaN;
}

/**
 * The regularised incomplete beta function I_x(a, b), for a, b > 0 and
 * 0 ≤ x ≤ 1, with y = 1 - x passed separately so a y near 0 keeps its digits.
 * Whichever of I_x(a, b) and I_y(b, a) = 1 - I_x(a, b) is the smaller is
 * computed by the continued fraction and the other by subtraction, so a small
 * answer keeps its significant digits: call it with the arguments swapped to
 * get the complement accurately.
 */
export function regularisedBeta(x: number, y: number, a: number, b: number): number {
	if (x <= 0) return 0;
	if (y <= 0) return 1;
	if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBetaFraction(y, x, b, a);
	return incompleteBetaFraction(x, y, a, b);
}

// ── The binomial distribution ────────────────────────────────────────────────

/**
 * Up to this many trials the binomial is computed term by term. C(n, k) and
 * every partial product on the way to it stay below 2^53, so the coefficient is
 * exact, and a fair coin's answers are exact too: 3 heads in 10 tosses is
 * 120/1024 = 0.1171875 to the last digit, not 0.11718749999999967.
 */
const DIRECT_BINOMIAL_TRIALS = 50;

/** C(n, k) for n ≤ {@link DIRECT_BINOMIAL_TRIALS}, exactly. */
function smallBinomialCoefficient(n: number, k: number): number {
	const r = Math.min(k, n - k);
	let c = 1;
	// After step i, c = C(n - r + i, i), a whole number, so each division is exact.
	for (let i = 1; i <= r; i++) c = (c * (n - r + i)) / i;
	return c;
}

/** C(n, k) pᵏ q^(n - k) term by term, for n ≤ {@link DIRECT_BINOMIAL_TRIALS}. */
function smallBinomialPmf(n: number, p: number, q: number, k: number): number {
	return smallBinomialCoefficient(n, k) * Math.pow(p, k) * Math.pow(q, n - k);
}

/**
 * The binomial probability of exactly k successes in n independent trials that
 * each succeed with probability p: C(n, k) pᵏ (1 - p)^(n - k). Assumes whole
 * numbers 0 ≤ k ≤ n and 0 ≤ p ≤ 1, which the package layer checks.
 */
export function binomialPmf(n: number, p: number, k: number): number {
	if (n <= DIRECT_BINOMIAL_TRIALS) return smallBinomialPmf(n, p, 1 - p, k);
	return binomialTerm(k, n, p, 1 - p);
}

/**
 * The binomial probability of at most k successes, P(X ≤ k). Up to
 * {@link DIRECT_BINOMIAL_TRIALS} trials, the sum of the terms on whichever side
 * of k is the lower tail; past it, the incomplete beta function
 * I_(1-p)(n - k, k + 1), which needs no sum over the k + 1 terms and keeps a
 * small tail's digits.
 */
export function binomialCdf(n: number, p: number, k: number): number {
	if (k >= n) return 1;
	if (p === 0) return 1;
	if (p === 1) return 0;
	const q = 1 - p;
	if (n <= DIRECT_BINOMIAL_TRIALS) {
		let sum = 0;
		if (k < n * p) {
			for (let j = 0; j <= k; j++) sum += smallBinomialPmf(n, p, q, j);
			return sum;
		}
		for (let j = k + 1; j <= n; j++) sum += smallBinomialPmf(n, p, q, j);
		return 1 - sum;
	}
	return regularisedBeta(q, p, n - k, k + 1);
}

// ── The Poisson distribution ─────────────────────────────────────────────────

/**
 * The Poisson probability of exactly k events when they occur independently at
 * an average of λ per interval: e^-λ λᵏ / k!. Assumes a whole k ≥ 0 and λ > 0.
 */
export function poissonPmf(lambda: number, k: number): number {
	return poissonTerm(k, lambda);
}

/**
 * The Poisson probability of at most k events, P(X ≤ k), as the regularised
 * incomplete gamma function Q(k + 1, λ).
 */
export function poissonCdf(lambda: number, k: number): number {
	return incompleteGamma(k + 1, lambda).q;
}

// ── Student's t distribution ─────────────────────────────────────────────────

/**
 * Past this, s² = t²/ν is so large that 1 + s² is s² to the last place, and s²
 * itself may not be representable, so the t functions work with ln s instead.
 */
const T_FAR = 1e150;

/**
 * t scaled by its degrees of freedom, s = |t|/√ν, as s itself while it is below
 * {@link T_FAR} and as ln s beyond (where s may not even be representable: a
 * t near the largest double with ν below 1).
 */
function scaledT(t: number, df: number): { s: number; logS: number | null } {
	const abs = Math.abs(t);
	const s = abs / Math.sqrt(df);
	if (s <= T_FAR) return { s, logS: null };
	return { s, logS: Math.log(abs) - 0.5 * Math.log(df) };
}

/**
 * Student's t density with ν degrees of freedom,
 * Γ((ν+1)/2) / (Γ(ν/2) √(νπ)) · (1 + t²/ν)^(-(ν+1)/2).
 * The ratio of gammas is written as Stirling remainders and a deviance term,
 * which stays accurate for a large ν where two log-gammas would cancel.
 */
export function studentTPdf(t: number, df: number): number {
	if (Number.isNaN(t)) return NaN;
	if (!Number.isFinite(t)) return 0;
	const a = df / 2;
	const b = (df + 1) / 2;
	const ratio = Math.exp(stirlingError(b) - stirlingError(a) - deviance(a, b)) / SQRT_2PI;
	// ln(1 + t²/ν), which past T_FAR is 2 ln s to the last place.
	const { s, logS } = scaledT(t, df);
	const log = logS === null ? Math.log1p(s * s) : 2 * logS;
	return ratio * Math.exp(-b * log);
}

/**
 * From here up, the t functions use {@link studentTLargeDf} rather than the
 * incomplete beta function. The beta continued fraction with one parameter at
 * ν/2 and the other at 1/2 subtracts numbers that agree to about 1/ν, so its
 * error grows in proportion to ν: a part in 10¹² at ν = 10⁴, 3% at ν = 10¹⁵.
 */
const T_LARGE_DF = 1e4;

/**
 * The coefficients of (sinh(v/2)/(v/2))^(-1/2) = Σ cₙ v²ⁿ, exact rationals
 * (-1/48, 1/2560, -61/7741440, ...), for {@link studentTLargeDf}.
 */
const T_EXPANSION = [1, -1 / 48, 1 / 2560, -61 / 7741440, 1261 / 7431782400, -79 / 20761804800];

/**
 * The tail and the centre of Student's t for a large ν, by an expansion of the
 * incomplete beta function in incomplete gamma functions (the method of
 * Temme, and of the BGRAT step of Didonato and Morris, 1992).
 *
 * Writing the tail integral in v = -ln u with T = ν/2 - 1/4,
 *
 *   I_x(ν/2, 1/2) = 1/(B T^(1/2)) ∫_w^∞ e^(-Tv) v^(-1/2) φ(v) dv,
 *   φ(v) = (sinh(v/2)/(v/2))^(-1/2) = Σ cₙ v²ⁿ,   w = ln(1 + t²/ν),
 *
 * and integrating term by term gives Σ cₙ Γ(1/2 + 2n, Tw) / T^(2n): upper
 * incomplete gammas for the tail and lower ones for the centre, each built up
 * from erfc or erf by the recurrence Γ(s + 1, u) = sΓ(s, u) ± uˢe^(-u). Every
 * term is a sum of positives, and with T ≥ 5000 six terms reach double
 * precision everywhere the tail has not already underflowed.
 */
function studentTLargeDf(t: number, df: number): { tail: number; centre: number } {
	const a = df / 2;
	const T = a - 0.25;
	const { s, logS } = scaledT(t, df);
	const u = T * (logS === null ? Math.log1p(s * s) : 2 * logS);
	if (u === Infinity) return { tail: 0, centre: 0.5 };
	// 1/(B(a, 1/2) √T) = Γ(a + 1/2) / (Γ(a) √π √T), the ratio of gammas in the
	// same Stirling-remainder form as the density.
	const scale = Math.sqrt(a / T) * Math.exp(stirlingError(a + 0.5) - stirlingError(a) - deviance(a, a + 0.5)) / SQRT_PI;
	const root = Math.sqrt(u);
	let upper = SQRT_PI * erfc(root);
	let lower = SQRT_PI * erf(root);
	let tailSum = upper;
	let centreSum = lower;
	let power = 1;
	let order = 0.5;
	for (let n = 1; n < T_EXPANSION.length; n++) {
		// Two steps of the recurrence take the order from 1/2 + 2(n - 1) to 1/2 + 2n.
		for (let step = 0; step < 2; step++) {
			const edge = Math.exp(order * Math.log(u) - u);
			upper = order * upper + edge;
			lower = order * lower - edge;
			order += 1;
		}
		power /= T * T;
		tailSum += T_EXPANSION[n] * upper * power;
		centreSum += T_EXPANSION[n] * lower * power;
	}
	return { tail: 0.5 * scale * tailSum, centre: 0.5 * scale * centreSum };
}

/**
 * The tail beyond |t|, P(T > |t|) = I_x(ν/2, 1/2) / 2 with x = ν/(ν + t²).
 * Far out, x is below the smallest double although the tail need not be
 * negligible (a heavy tail falls only as |t|^-ν), so there the leading term of
 * the fraction, xᵃ / (a B(a, 1/2)), is taken in logarithms.
 */
function studentTTail(t: number, df: number): number {
	if (!Number.isFinite(t)) return 0;
	if (df >= T_LARGE_DF) return studentTLargeDf(t, df).tail;
	const a = df / 2;
	const { s, logS } = scaledT(t, df);
	if (logS !== null) {
		const logBeta = logGamma(a) + logGamma(0.5) - logGamma(a + 0.5);
		return 0.5 * Math.exp(-2 * a * logS - logBeta) / a;
	}
	const s2 = s * s;
	return 0.5 * regularisedBeta(1 / (1 + s2), s2 / (1 + s2), a, 0.5);
}

/**
 * The probability mass between the median and t, P(0 < T < |t|) =
 * I_y(1/2, ν/2) / 2 with y = t²/(ν + t²), computed directly so it keeps its
 * digits when t is near zero.
 */
function studentTCentre(t: number, df: number): number {
	if (df >= T_LARGE_DF && Number.isFinite(t)) return studentTLargeDf(t, df).centre;
	const { s, logS } = scaledT(t, df);
	if (logS !== null || !Number.isFinite(t)) return 0.5 - studentTTail(t, df);
	const s2 = s * s;
	return 0.5 * regularisedBeta(s2 / (1 + s2), 1 / (1 + s2), 0.5, df / 2);
}

/** Student's t cumulative probability P(T ≤ t) with ν degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
	if (Number.isNaN(t)) return NaN;
	if (t === 0) return 0.5;
	const tail = studentTTail(t, df);
	return t < 0 ? tail : 1 - tail;
}

/**
 * Student's t quantile: the t with P(T ≤ t) = p, for 0 < p < 1 and ν > 0, the
 * critical value of a t-test (studentTInv(0.975, 10) is 2.228). One and two
 * degrees of freedom have closed forms; otherwise the Cornish-Fisher expansion
 * around the normal quantile starts a Newton iteration.
 */
export function studentTInv(p: number, df: number): number {
	if (!(p > 0 && p < 1)) return NaN;
	if (p === 0.5) return 0;
	if (p > 0.5) return -studentTInv(1 - p, df);
	// One degree of freedom is the Cauchy distribution, t = tan(π(p - 1/2)).
	// Near the middle p - 1/2 is exact; in the tail the reciprocal keeps the
	// digits that π(p - 1/2), rounded next to -π/2, would lose.
	if (df === 1) return p > 0.25 ? Math.tan(Math.PI * (p - 0.5)) : -1 / Math.tan(Math.PI * p);
	if (df === 2) return (2 * p - 1) / Math.sqrt(2 * p * (1 - p));
	const z = normalInv(p);
	let guess = z;
	if (df >= 1) {
		// Abramowitz and Stegun 26.7.5, to the fourth power of 1/ν.
		const z2 = z * z;
		const g1 = (z2 + 1) * z / 4;
		const g2 = ((5 * z2 + 16) * z2 + 3) * z / 96;
		const g3 = (((3 * z2 + 19) * z2 + 17) * z2 - 15) * z / 384;
		const g4 = ((((79 * z2 + 776) * z2 + 1482) * z2 - 1920) * z2 - 945) * z / 92160;
		guess = z + (g1 + (g2 + (g3 + g4 / df) / df) / df) / df;
	}
	if (!(guess < 0) || !Number.isFinite(guess)) guess = z;
	return lowerQuantile(
		p,
		guess,
		(t) => studentTCdf(t, df),
		(t) => -studentTCentre(t, df),
		(t) => studentTPdf(t, df),
	);
}

// ── Solving for a quantile ─────────────────────────────────────────────────────

/**
 * The x < 0 at which a symmetric distribution's CDF reaches p < 1/2, by a
 * bracketed Newton iteration.
 *
 * Two formulations, chosen by p, so that the equation being solved never takes
 * the difference of two nearly equal numbers:
 *
 * - In the tail (p ≤ 1/4), ln F(x) = ln p. The logarithm keeps a p of 1e-300 as
 *   well resolved as one of 0.01, and makes a heavy tail (F falling as a power
 *   of x) nearly linear, so Newton steps across it in a few moves.
 * - Near the middle (p > 1/4), F(x) - 1/2 = p - 1/2, where p - 1/2 is exact and
 *   F(x) - 1/2 is supplied directly (for the normal, erf(x/√2)/2), so a p of
 *   0.5 + 1e-12 still gives an answer with all its digits.
 *
 * The bracket starts as (-∞, 0) and closes on each evaluation; a Newton step
 * that would leave it is replaced by bisection (or by doubling, while the lower
 * end is still open), so the iteration cannot diverge.
 *
 * @param p - The lower-tail probability, 0 < p < 1/2.
 * @param guess - A starting point below zero.
 * @param cdf - F(x).
 * @param centred - F(x) - 1/2, computed without subtracting.
 * @param pdf - F'(x), the density.
 */
function lowerQuantile(
	p: number,
	guess: number,
	cdf: (x: number) => number,
	centred: (x: number) => number,
	pdf: (x: number) => number,
): number {
	const inTail = p <= 0.25;
	const target = inTail ? Math.log(p) : p - 0.5;
	let lo = -Infinity;
	let hi = 0;
	let x = guess;
	for (let i = 0; i < 2000; i++) {
		const density = pdf(x);
		let value: number;
		let slope: number;
		if (inTail) {
			const f = cdf(x);
			value = Math.log(f);
			slope = density / f;
		} else {
			value = centred(x);
			slope = density;
		}
		if (Number.isNaN(value)) return NaN;
		const diff = value - target;
		if (diff === 0) return x;
		if (diff < 0) lo = x;
		else hi = x;
		let next = x - diff / slope;
		if (next > lo && next < hi) {
			// Newton converges quadratically, so once a step is this small the
			// point it lands on is as close as the function's own rounding allows.
			if (Math.abs(next - x) <= 1e-13 * Math.abs(next)) return next;
		} else if (lo === -Infinity) {
			next = 2 * x;
			if (!Number.isFinite(next)) return next;
		} else {
			next = lo + (hi - lo) / 2;
			if (next === lo || next === hi) return next;
		}
		x = next;
	}
	return x;
}
