/**
 * Numeric integration over a finite interval, with a stated error.
 *
 * The rule is 15-point Gauss-Kronrod, the one QUADPACK's `qk15` uses. A Gauss
 * rule samples a function at carefully chosen points and weights the samples
 * so that it integrates a polynomial of high degree exactly; the Kronrod
 * extension adds points to a 7-point Gauss rule so that the same samples give
 * two estimates of different accuracy, and the gap between them is an estimate
 * of the error. That is what makes this verifiable rather than a guess: every
 * answer comes with a bound on how wrong it can be, and an answer whose bound is
 * not small enough is not given.
 *
 * The interval is divided adaptively. Whichever piece has the largest estimated
 * error is halved and re-estimated, so the samples gather where the function is
 * hard (near a peak, a kink or a jump) and stay sparse where it is smooth. The
 * run stops when the total estimated error is within
 * {@link QUADRATURE_RELATIVE_TOLERANCE} of the answer, or declines when it cannot
 * get there within {@link QUADRATURE_MAX_INTERVALS} pieces, which is what an
 * integrand that grows without bound inside the interval does.
 *
 * The rule never samples an interval's own ends, so an integrand with no value
 * at a bound can still be integrated when it has a finite limit there; the
 * caller decides whether that is allowed. A sample that is not finite is handed
 * to {@link QuadratureOptions.atNonFinite}, which may supply the value the
 * function tends to there (the `0/0` of `sin(x)/x` at zero) or refuse.
 *
 * What it cannot see: a feature narrower than every sample spacing, a spike
 * that falls between all fifteen points of every piece it lies in. The first
 * pass divides the interval into {@link QUADRATURE_INITIAL_PIECES} pieces to
 * make that less likely, but no finite sampling can rule it out.
 */

import type { RealFunction } from "@solve-js/symbolic/NumericEvaluate";

/** The target error, as a fraction of the answer. */
export const QUADRATURE_RELATIVE_TOLERANCE = 1e-10;

/**
 * The target error as a fraction of the integral of the absolute value, which
 * is what applies when positive and negative parts cancel and the answer itself
 * is near zero, so a tolerance relative to it could never be met.
 */
export const QUADRATURE_CANCELLATION_TOLERANCE = 1e-12;

/** How many pieces the adaptive division may reach before the integral is declared unsettled. */
export const QUADRATURE_MAX_INTERVALS = 2000;

/** How many equal pieces the interval starts as. */
export const QUADRATURE_INITIAL_PIECES = 8;

/** How many non-finite samples may be repaired before the integrand is treated as having no finite value. */
const MAX_REPAIRS = 16;

/**
 * Kronrod nodes on [-1, 1], positive half, descending. The odd entries are the
 * 7-point Gauss nodes. QUADPACK's 33-digit values, written at the precision a
 * double holds.
 */
const XGK = [0.9914553711208126, 0.9491079123427585, 0.8648644233597691, 0.7415311855993945, 0.5860872354676911, 0.4058451513773972, 0.20778495500789848, 0];

/** Kronrod weights, matching {@link XGK}. */
const WGK = [
	0.022935322010529224, 0.06309209262997856, 0.10479001032225019, 0.14065325971552592, 0.1690047266392679, 0.19035057806478542,
	0.20443294007529889, 0.20948214108472782,
];

/** 7-point Gauss weights for the nodes XGK[1], XGK[3], XGK[5] and the centre. */
const WG = [0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694];

/** Options for {@link integrateNumerically}. */
export interface QuadratureOptions {
	/**
	 * Called with a point where the integrand was not finite. Returns the finite
	 * value to use there instead, or `null` to refuse, which ends the run with a
	 * `nonfinite` outcome naming that point.
	 */
	readonly atNonFinite?: (x: number) => number | null;
}

/** The outcome of a numeric integration. */
export type QuadratureResult =
	/** The integral, its estimated error, and the integral of the absolute value. */
	| { readonly ok: true; readonly value: number; readonly error: number; readonly magnitude: number }
	/** The integrand had no finite value at a point inside the interval. */
	| { readonly ok: false; readonly kind: "nonfinite"; readonly at: number }
	/** The estimates did not settle, with the point where the error was concentrated. */
	| { readonly ok: false; readonly kind: "unsettled"; readonly near: number };

/** One piece of the adaptive division. */
interface Piece {
	readonly a: number;
	readonly b: number;
	readonly value: number;
	readonly error: number;
	readonly magnitude: number;
	/** False once the piece is two neighbouring doubles and cannot be halved. */
	splittable: boolean;
}

/** Raised inside a run when a sample cannot be repaired, and caught at its entry point. */
class NonFiniteSample extends Error {
	constructor(readonly at: number) {
		super("non-finite sample");
	}
}

/**
 * Integrates `f` from `a` to `b`.
 *
 * @param f - The integrand.
 * @param a - Lower bound, finite.
 * @param b - Upper bound, finite. May be below `a`, which negates the result.
 * @param options - See {@link QuadratureOptions}.
 * @returns The outcome.
 */
export function integrateNumerically(f: RealFunction, a: number, b: number, options: QuadratureOptions = {}): QuadratureResult {
	if (a === b) return { ok: true, value: 0, error: 0, magnitude: 0 };
	if (a > b) {
		const flipped = integrateNumerically(f, b, a, options);
		return flipped.ok ? { ...flipped, value: -flipped.value } : flipped;
	}

	let repairs = 0;
	const sample: RealFunction = x => {
		const y = f(x);
		if (Number.isFinite(y)) return y;
		if (options.atNonFinite !== undefined && repairs < MAX_REPAIRS) {
			repairs++;
			const replacement = options.atNonFinite(x);
			if (replacement !== null && Number.isFinite(replacement)) return replacement;
		}
		throw new NonFiniteSample(x);
	};

	try {
		return adapt(sample, a, b);
	} catch (e) {
		if (e instanceof NonFiniteSample) return { ok: false, kind: "nonfinite", at: e.at };
		throw e;
	}
}

/** The adaptive loop, over a sampler that throws {@link NonFiniteSample} rather than returning a non-finite value. */
function adapt(f: RealFunction, a: number, b: number): QuadratureResult {
	const pieces: Piece[] = [];
	const width = (b - a) / QUADRATURE_INITIAL_PIECES;
	for (let i = 0; i < QUADRATURE_INITIAL_PIECES; i++) {
		const left = a + width * i;
		const right = i === QUADRATURE_INITIAL_PIECES - 1 ? b : a + width * (i + 1);
		pieces.push(kronrod(f, left, right));
	}

	for (;;) {
		let value = 0;
		let error = 0;
		let magnitude = 0;
		for (const piece of pieces) {
			value += piece.value;
			error += piece.error;
			magnitude += piece.magnitude;
		}
		const tolerance = Math.max(QUADRATURE_RELATIVE_TOLERANCE * Math.abs(value), QUADRATURE_CANCELLATION_TOLERANCE * magnitude);
		if (error <= tolerance) return { ok: true, value, error, magnitude };

		let worst = -1;
		let worstOverall = 0;
		for (let i = 0; i < pieces.length; i++) {
			if (pieces[i].error > pieces[worstOverall].error) worstOverall = i;
			if (pieces[i].splittable && (worst === -1 || pieces[i].error > pieces[worst].error)) worst = i;
		}
		if (worst === -1 || pieces.length >= QUADRATURE_MAX_INTERVALS) {
			const at = pieces[worstOverall];
			return { ok: false, kind: "unsettled", near: at.a + (at.b - at.a) / 2 };
		}

		const piece = pieces[worst];
		const mid = piece.a + (piece.b - piece.a) / 2;
		if (mid <= piece.a || mid >= piece.b) {
			piece.splittable = false;
			continue;
		}
		pieces.splice(worst, 1, kronrod(f, piece.a, mid), kronrod(f, mid, piece.b));
	}
}

/**
 * The 15-point Gauss-Kronrod estimate over one piece, with QUADPACK's error
 * estimate.
 *
 * The raw error is the gap between the Kronrod and Gauss results. QUADPACK
 * rescales it against how much the integrand varies across the piece, which
 * makes it pessimistic for a rough piece and realistic for a smooth one, and
 * floors it at the rounding error of the sum itself.
 */
function kronrod(f: RealFunction, a: number, b: number): Piece {
	const centre = a + (b - a) / 2;
	const half = (b - a) / 2;
	const fc = f(centre);
	let gauss = fc * WG[3];
	let kron = fc * WGK[7];
	let absolute = Math.abs(kron);
	const f1: number[] = new Array(7);
	const f2: number[] = new Array(7);

	for (let j = 0; j < 3; j++) {
		const index = 2 * j + 1;
		const offset = half * XGK[index];
		const v1 = f(centre - offset);
		const v2 = f(centre + offset);
		f1[index] = v1;
		f2[index] = v2;
		gauss += WG[j] * (v1 + v2);
		kron += WGK[index] * (v1 + v2);
		absolute += WGK[index] * (Math.abs(v1) + Math.abs(v2));
	}
	for (let j = 0; j < 4; j++) {
		const index = 2 * j;
		const offset = half * XGK[index];
		const v1 = f(centre - offset);
		const v2 = f(centre + offset);
		f1[index] = v1;
		f2[index] = v2;
		kron += WGK[index] * (v1 + v2);
		absolute += WGK[index] * (Math.abs(v1) + Math.abs(v2));
	}

	const mean = kron * 0.5;
	let spread = WGK[7] * Math.abs(fc - mean);
	for (let j = 0; j < 7; j++) spread += WGK[j] * (Math.abs(f1[j] - mean) + Math.abs(f2[j] - mean));

	const scale = Math.abs(half);
	const value = kron * half;
	absolute *= scale;
	spread *= scale;
	let error = Math.abs((kron - gauss) * half);
	if (spread !== 0 && error !== 0) error = spread * Math.min(1, Math.pow((200 * error) / spread, 1.5));
	error = Math.max(50 * Number.EPSILON * absolute, error);

	return { a, b, value, error, magnitude: absolute, splittable: true };
}
