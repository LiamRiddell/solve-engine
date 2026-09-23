/**
 * The probability distributions (#517), pinned twice: the maths in
 * DistributionMath.ts against reference values computed independently, and the
 * call forms through the engine, with every refusal pinned by its code.
 *
 * The reference values come from mpmath 1.3.0 at 40 significant digits, taking
 * each input as the exact double the engine sees: its erf, erfc, ncdf, npdf,
 * gamma and loggamma directly; the binomial and Poisson masses from loggamma,
 * and their cumulative probabilities by summing the masses over the lower tail
 * (or 1 minus the upper tail); Student's t through the positive-term series of
 * the regularised incomplete beta function; and each quantile by bisecting
 * mpmath's own CDF 200 times. None of it shares code or method with the engine's
 * implementation, which is the point: a shared mistake would pass.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";
import * as D from "@solve-js/packages/statistics/DistributionMath";

/** `actual` within a relative `tolerance` of `expected` (absolute when it is 0). */
function expectRelative(actual: number, expected: number, tolerance: number, label = ""): void {
	const error = expected === 0 ? Math.abs(actual) : Math.abs((actual - expected) / expected);
	if (!(error <= tolerance)) {
		throw new Error(`${label}: expected ${expected}, got ${actual} (relative error ${error.toExponential(2)} > ${tolerance})`);
	}
}

type Fn = "erf" | "erfc" | "normalCdf" | "normalPdf" | "normalInv" | "gamma" | "logGamma"
	| "binomialPmf" | "binomialCdf" | "poissonPmf" | "poissonCdf"
	| "studentTPdf" | "studentTCdf" | "studentTInv";

/** [function, arguments, the mpmath value]. */
const REFERENCE: [Fn, number[], number][] = [
	["erf", [0.5], 0.5204998778130465],
	["erf", [1], 0.8427007929497149],
	["erf", [2], 0.9953222650189527],
	["erf", [-0.3], -0.3286267594591274],
	["erf", [3.5], 0.9999992569016276],
	["erfc", [0.5], 0.4795001221869535],
	["erfc", [2], 0.004677734981047266],
	["erfc", [5], 1.537459794428035e-12],
	["erfc", [10], 2.088487583762545e-45],
	["erfc", [26], 5.663192408856143e-296],
	["erfc", [-1], 1.842700792949715],
	["normalCdf", [-1.96], 0.024997895148220435],
	["normalCdf", [1.96], 0.9750021048517795],
	["normalCdf", [-5], 2.866515718791939e-07],
	["normalCdf", [-10], 7.619853024160525e-24],
	["normalCdf", [-37], 5.725571222524577e-300],
	["normalCdf", [0.3], 0.6179114221889527],
	["normalPdf", [0], 0.3989422804014327],
	["normalPdf", [1], 0.24197072451914334],
	["normalPdf", [-2.5], 0.017528300493568537],
	["normalInv", [0.975], 1.9599639845400538],
	["normalInv", [0.025], -1.9599639845400543],
	["normalInv", [0.500000000001], 2.5065728237018607e-12],
	["normalInv", [1e-10], -6.361340902404057],
	["normalInv", [1e-300], -37.0470962993612],
	["normalInv", [0.999], 3.090232306167813],
	["gamma", [0.5], 1.772453850905516],
	["gamma", [1.5], 0.886226925452758],
	["gamma", [10.5], 1133278.3889487856],
	["gamma", [-0.5], -3.544907701811032],
	["gamma", [-2.5], -0.9453087204829419],
	["gamma", [170.5], 5.56209241456e305],
	["gamma", [0.001], 999.4237724845955],
	["logGamma", [0.5], 0.5723649429247001],
	["logGamma", [10], 12.80182748008147],
	["logGamma", [100.5], 361.4355404677776],
	["logGamma", [1000], 5905.220423209181],
	["logGamma", [1e10], 220258509288.81058],
	["binomialPmf", [20, 0.3, 5], 0.17886305056987975],
	["binomialPmf", [100, 0.01, 1], 0.3697296376497268],
	["binomialPmf", [1000, 0.5, 450], 0.00016939724527711568],
	["binomialPmf", [51, 0.5, 20], 0.03443252599806712],
	["binomialPmf", [1e6, 0.5, 499000], 0.00010798197801891516],
	["binomialCdf", [20, 0.3, 5], 0.41637082944748144],
	["binomialCdf", [1000, 0.5, 450], 0.0008652680424881588],
	["binomialCdf", [51, 0.5, 20], 0.08038980090599424],
	["binomialCdf", [1e6, 0.5, 499000], 0.02280414993269104],
	["binomialCdf", [50, 0.5, 39], 0.9999880693341616],
	["binomialCdf", [100, 0.01, 1], 0.7357619789229563],
	["poissonPmf", [2, 3], 0.18044704431548358],
	["poissonPmf", [10, 20], 0.0018660813139987594],
	["poissonPmf", [100, 50], 1.2231421635188734e-08],
	["poissonPmf", [0.5, 0], 0.6065306597126334],
	["poissonCdf", [2, 3], 0.857123460498547],
	["poissonCdf", [10, 20], 0.998411739338142],
	["poissonCdf", [100, 50], 2.4015922356168156e-08],
	["poissonCdf", [1e6, 1e6], 0.5002659614862837],
	["studentTPdf", [0, 10], 0.38910838396603104],
	["studentTPdf", [2, 3], 0.0675096606638929],
	["studentTPdf", [-40, 0.5], 0.0006336924404767642],
	["studentTCdf", [2.228, 10], 0.9749941140914443],
	["studentTCdf", [-3, 1], 0.10241638234956674],
	["studentTCdf", [-2, 0.5], 0.22275744509156561],
	["studentTCdf", [-10, 100], 4.9508444922970696e-17],
	["studentTCdf", [-2, 1e15], 0.02275013194817934],
	["studentTCdf", [-1e200, 0.1], 4.173803137173207e-21],
	["studentTCdf", [1.5, 20000], 0.9331849063311575],
	["studentTInv", [0.975, 10], 2.2281388519862744],
	["studentTInv", [0.975, 1], 12.706204736174692],
	["studentTInv", [0.975, 2], 4.302652729749462],
	["studentTInv", [0.995, 30], 2.749995653567225],
	["studentTInv", [1e-10, 5], -156.82559270889433],
	["studentTInv", [0.975, 1e6], 1.9599663568141068],
	["studentTInv", [0.4999999999, 1], -3.1415929135263347e-10],
	["studentTInv", [0.95, 2.5], 2.5582186141359355],
];

describe("the maths against independent reference values", () => {
	test.each(REFERENCE)("%s(%j)", (fn, args, expected) => {
		const f = D[fn] as (...a: number[]) => number;
		expectRelative(f(...args), expected, 1e-12, `${fn}(${args.join(", ")})`);
	});
});

describe("exact where exactness is possible", () => {
	test("a fair coin's binomial answers are exact to the last digit", () => {
		// C(10, 3) / 2^10 = 120/1024, and 1 + 10 + 45 + 120 = 176 of 1024.
		expect(D.binomialPmf(10, 0.5, 3)).toBe(0.1171875);
		expect(D.binomialCdf(10, 0.5, 3)).toBe(0.171875);
		expect(D.binomialPmf(50, 0.5, 25)).toBe(126410606437752 / 2 ** 50);
	});

	test("gamma of a whole number is the exact factorial below it", () => {
		expect(D.gamma(5)).toBe(24);
		expect(D.gamma(1)).toBe(1);
		expect(D.gamma(21)).toBe(2432902008176640000);
	});

	test("the medians and the centre are exact", () => {
		expect(D.normalInv(0.5)).toBe(0);
		expect(D.studentTInv(0.5, 7)).toBe(0);
		expect(D.studentTCdf(0, 7)).toBe(0.5);
		expect(D.erf(0)).toBe(0);
	});
});

describe("the tails keep their significant digits", () => {
	test("normalcdf far into the lower tail is not 0", () => {
		// The Abramowitz and Stegun 7.1.26 formula this replaces had an absolute
		// error of 1.5e-7: it answered 2.871e-7 at z = -5 (0.16% out) and 0 at -10.
		expectRelative(D.normalCdf(-5), 2.866515718791939e-7, 1e-14);
		expectRelative(D.normalCdf(-10), 7.619853024160525e-24, 1e-14);
	});

	test("erfc is computed directly, not as 1 - erf", () => {
		expect(1 - D.erf(10)).toBe(0);
		expectRelative(D.erfc(10), 2.088487583762545e-45, 1e-13);
	});

	test("a probability so small it has no double is 0, not NaN", () => {
		// e^-1000 is about 5e-435, below the smallest double.
		expect(D.poissonPmf(1000, 0)).toBe(0);
		expect(D.normalCdf(-40)).toBe(0);
	});
});

describe("the inverses invert", () => {
	// A round trip can be no better than the probability in the middle of it.
	// Near the median p is 1/2 plus a sliver, and in the upper tail it is 1 minus
	// one, and a double near 1/2 or 1 keeps only a few digits of the sliver; so
	// the round trips stay a little way from the median and below the upper tail.
	// (The upper tail itself is reached exactly, by symmetry, from the lower.)
	test("normalInv undoes normalCdf across the whole range", () => {
		for (const z of [-37, -20, -8, -3, -1, -0.01, 0.5, 2]) {
			expectRelative(D.normalInv(D.normalCdf(z)), z, 1e-10, `z = ${z}`);
		}
	});

	test("studentTInv undoes studentTCdf, for light and heavy tails", () => {
		for (const df of [0.3, 1, 2, 3.5, 10, 50, 1e5]) {
			for (const t of [-100, -5, -1.5, -0.01, 0.3, 4]) {
				const p = D.studentTCdf(t, df);
				// Past about t = -38 with 100,000 degrees of freedom the tail is
				// below the smallest double: 0, with no quantile to return to.
				if (p === 0) continue;
				expectRelative(D.studentTInv(p, df), t, 1e-10, `t = ${t}, df = ${df}`);
			}
		}
	});

	test("a quantile beyond the largest double is Infinity, for the package to refuse", () => {
		expect(D.studentTInv(1e-300, 0.1)).toBe(-Infinity);
	});
});

describe("the distributions agree with each other", () => {
	test("each cumulative probability is the sum of the masses", () => {
		let binomial = 0;
		let poisson = 0;
		for (let k = 0; k <= 30; k++) {
			binomial += D.binomialPmf(200, 0.1, k);
			poisson += D.poissonPmf(12.5, k);
			expectRelative(D.binomialCdf(200, 0.1, k), binomial, 1e-13, `binomial k = ${k}`);
			expectRelative(D.poissonCdf(12.5, k), poisson, 1e-13, `poisson k = ${k}`);
		}
	});

	test("the term-by-term binomial and the incomplete-beta binomial meet at 50 trials", () => {
		// 50 trials is summed term by term, 51 goes through the incomplete beta;
		// one more trial of a fair coin halves each tail term, so the two must
		// agree through the identity P51(X <= k) = P50(X <= k) - P50(X = k)/2.
		for (const k of [10, 20, 25, 30, 40]) {
			const expected = D.binomialCdf(50, 0.5, k) - D.binomialPmf(50, 0.5, k) / 2;
			expectRelative(D.binomialCdf(51, 0.5, k), expected, 1e-13, `k = ${k}`);
		}
	});

	test("t with one degree of freedom is the Cauchy distribution", () => {
		// P(T <= t) = 1/2 + atan(t)/π, written as atan(-1/t)/π below zero so the
		// reference does not itself cancel away the tail's digits.
		for (const t of [-1e6, -30, -1, -0.2]) {
			expectRelative(D.studentTCdf(t, 1), Math.atan(-1 / t) / Math.PI, 1e-13, `t = ${t}`);
			expectRelative(D.studentTCdf(-t, 1), 1 - Math.atan(-1 / t) / Math.PI, 1e-13, `t = ${-t}`);
		}
	});

	test("t with many degrees of freedom is the normal", () => {
		for (const t of [-8, -2, -0.5, 1, 3]) {
			expectRelative(D.studentTCdf(t, 1e17), D.normalCdf(t), 1e-13, `t = ${t}`);
			expectRelative(D.studentTPdf(t, 1e17), D.normalPdf(t), 1e-13, `t = ${t}`);
		}
	});

	test("the large-df expansion and the beta fraction meet at 10,000", () => {
		// Just below 10,000 is the continued fraction, at it the expansion. A
		// change of 1e-9 in the degrees of freedom moves the t = -30 tail by about
		// 2e-12 of itself, well inside the tolerance.
		for (const t of [-30, -6, -2, -0.2, 1]) {
			expectRelative(D.studentTCdf(t, 9999.999999999), D.studentTCdf(t, 10000), 1e-10, `t = ${t}`);
			expectRelative(D.studentTPdf(t, 9999.999999999), D.studentTPdf(t, 10000), 1e-10, `t = ${t}`);
		}
	});

	test("erf is the normal CDF rescaled", () => {
		for (const x of [-2.5, -0.7, 0.1, 1.3, 4]) {
			expectRelative(D.erf(x), 2 * D.normalCdf(x * Math.SQRT2) - 1, 1e-13, `x = ${x}`);
		}
	});

	test("gamma satisfies its recurrence and reflection", () => {
		for (const x of [0.3, 1.7, 4.2, 12.5, 60.1]) {
			expectRelative(D.gamma(x + 1), x * D.gamma(x), 1e-13, `x = ${x}`);
			expectRelative(D.logGamma(x), Math.log(D.gamma(x)), 1e-13, `x = ${x}`);
		}
		for (const x of [0.25, 0.4, 0.9]) {
			expectRelative(D.gamma(x) * D.gamma(1 - x), Math.PI / Math.sin(Math.PI * x), 1e-13, `x = ${x}`);
		}
	});

	test("lgamma keeps its significant digits beside its zeros at 1 and 2", () => {
		// ln Γ(1 + ε) = -γε + (π²/12)ε² - ..., and ln Γ(2 + ε) = (1 - γ)ε +
		// ((π²/6 - 1)/2)ε² - ..., so near ε = 0 a formula accurate to decimal
		// places alone would lose every significant digit. The ε is the one the
		// double actually holds, (1 + 1e-10) - 1, not 1e-10 itself.
		const euler = 0.5772156649015329;
		const zeta2 = Math.PI ** 2 / 6;
		const e1 = (1 + 1e-10) - 1;
		expectRelative(D.logGamma(1 + 1e-10), -euler * e1 + (zeta2 / 2) * e1 * e1, 1e-14);
		const e2 = (2 - 1e-10) - 2;
		expectRelative(D.logGamma(2 - 1e-10), (1 - euler) * e2 + ((zeta2 - 1) / 2) * e2 * e2, 1e-14);
	});
});

// ── Through the engine ─────────────────────────────────────────────────────────

const value = (source: string) => newTrackedEngine().evaluateExpression(source);
const num = (source: string) => {
	const v = value(source);
	expect({ source, type: v.type }).toEqual({ source, type: ValueType.Number });
	return v.toNumber();
};
const code = (source: string) => value(source).errorCode;

describe("the call forms", () => {
	// mpmath values, as in the table above.
	test("the issue's own examples", () => {
		expectRelative(num("normalinv(0.975)"), 1.9599639845400538, 1e-14);
		expect(num("binompdf(10, 0.5, 3)")).toBe(0.1171875);
	});

	test("every function answers through the grammar", () => {
		expectRelative(num("normalinv(0.9, 100, 15)"), 100 + 15 * 1.2815515655446006, 1e-14);
		expect(num("binomcdf(10, 0.5, 3)")).toBe(0.171875);
		expectRelative(num("poissonpdf(2, 3)"), 0.18044704431548358, 1e-14);
		expectRelative(num("poissoncdf(2, 3)"), 0.857123460498547, 1e-14);
		expectRelative(num("tpdf(0, 10)"), 0.38910838396603104, 1e-14);
		expectRelative(num("erf(0.5)"), 0.5204998778130465, 1e-14);
		expectRelative(num("erfc(3)"), 2.209049699858544e-5, 1e-14);
		expect(num("gamma(5)")).toBe(24);
		expectRelative(num("gamma(0.5)"), Math.sqrt(Math.PI), 1e-14);
		expectRelative(num("lgamma(200)"), 857.9336698258575, 1e-14);
		expectRelative(num("tcdf(tinv(0.975, 10), 10)"), 0.975, 1e-14);
	});

	test("the graphing-calculator spellings are the same functions", () => {
		expect(num("invnorm(0.3)")).toBe(num("normalinv(0.3)"));
		expect(num("invNorm(0.3, 5, 2)")).toBe(num("normalinv(0.3, 5, 2)"));
		expect(num("invt(0.9, 4)")).toBe(num("tinv(0.9, 4)"));
		expect(num("invT(0.9, 4)")).toBe(num("tinv(0.9, 4)"));
	});

	test("a probability can be written as a percentage", () => {
		expect(num("normalinv(97.5%)")).toBe(num("normalinv(0.975)"));
		expect(num("binompdf(20, 5%, 0)")).toBe(num("binompdf(20, 0.05, 0)"));
		expect(num("tinv(95%, 3)")).toBe(num("tinv(0.95, 3)"));
	});

	test("the results are ordinary numbers that flow into arithmetic", () => {
		expectRelative(num("normalinv(0.975) * 15 / sqrt(100)"), 1.9599639845400538 * 1.5, 1e-14);
		// The two-sided p-value subtracts from 1, so it keeps absolute, not
		// relative, precision: about 1e-16 of 1.
		expectRelative(num("2 * (1 - tcdf(2.5, 12))"), 0.02791539957132525, 1e-13);
	});

	test("the normal functions keep their answers from #527, now to more digits", () => {
		expectRelative(num("normalcdf(110, 100, 15)"), 0.7475074624530771, 1e-14);
		expect(num("normalcdf(110, 100, 15)")).toBe(num("normalcdf(10 / 15)"));
		expectRelative(num("normalpdf(110, 100, 15)"), 0.021296533701490147, 1e-14);
	});
});

describe("every refusal is named", () => {
	const refused: [string, string][] = [
		// Argument counts.
		["normalinv()", "STAT_ARGUMENT_COUNT"],
		["normalinv(0.9, 100)", "STAT_ARGUMENT_COUNT"],
		["binompdf(10, 0.5)", "STAT_ARGUMENT_COUNT"],
		["binomcdf(10, 0.5, 3, 4)", "STAT_ARGUMENT_COUNT"],
		["poissonpdf(2)", "STAT_ARGUMENT_COUNT"],
		["tcdf(-1, 2, 10)", "STAT_ARGUMENT_COUNT"],
		["tinv(0.975)", "STAT_ARGUMENT_COUNT"],
		["erf(1, 2)", "STAT_ARGUMENT_COUNT"],
		["gamma()", "STAT_ARGUMENT_COUNT"],
		["lgamma(1, 2)", "STAT_ARGUMENT_COUNT"],
		// Probabilities.
		["normalinv(0)", "STAT_PROBABILITY_RANGE"],
		["normalinv(1)", "STAT_PROBABILITY_RANGE"],
		["normalinv(100%)", "STAT_PROBABILITY_RANGE"],
		["tinv(1.2, 5)", "STAT_PROBABILITY_RANGE"],
		["binompdf(10, 1.5, 3)", "STAT_PROBABILITY_RANGE"],
		["binompdf(10, -0.1, 3)", "STAT_PROBABILITY_RANGE"],
		// A spreadsheet's BINOM.DIST order, successes first, fails on its p.
		["binompdf(3, 10, 0.5)", "STAT_PROBABILITY_RANGE"],
		// Counts.
		["binompdf(10, 0.5, 2.5)", "STAT_NOT_WHOLE"],
		["binompdf(10.5, 0.5, 2)", "STAT_NOT_WHOLE"],
		["poissonpdf(2, 1.5)", "STAT_NOT_WHOLE"],
		["binompdf(10, 0.5, 11)", "STAT_COUNT_RANGE"],
		["binomcdf(10, 0.5, -1)", "STAT_COUNT_RANGE"],
		["binompdf(-1, 0.5, 0)", "STAT_COUNT_RANGE"],
		["poissoncdf(2, -1)", "STAT_COUNT_RANGE"],
		["binompdf(2^60, 0.5, 3)", "STAT_COUNT_RANGE"],
		// Scales.
		["normalinv(0.9, 100, 0)", "STAT_SD_NOT_POSITIVE"],
		["normalinv(0.9, 100, -15)", "STAT_SD_NOT_POSITIVE"],
		["poissonpdf(0, 3)", "STAT_MEAN_NOT_POSITIVE"],
		["poissoncdf(-2, 3)", "STAT_MEAN_NOT_POSITIVE"],
		["tcdf(2, 0)", "STAT_DF_NOT_POSITIVE"],
		["tinv(0.9, -3)", "STAT_DF_NOT_POSITIVE"],
		["tpdf(0, 1/0)", "STAT_DF_NOT_POSITIVE"],
		["lgamma(0)", "STAT_NOT_POSITIVE"],
		["lgamma(-1.5)", "STAT_NOT_POSITIVE"],
		// Gamma's poles and its overflow.
		["gamma(0)", "STAT_GAMMA_POLE"],
		["gamma(-3)", "STAT_GAMMA_POLE"],
		["gamma(172)", "STAT_OVERFLOW"],
		// A quantile past the largest double, and a count past the iteration budget.
		["tinv(1e-300, 0.1)", "STAT_OVERFLOW"],
		["poissoncdf(1e12, 1e12)", "STAT_NO_CONVERGENCE"],
		// Not a plain number.
		["normalinv(0.9, 100 kg, 15)", "STAT_EXPECTED_VALUE"],
		["binompdf(10 kg, 0.5, 3)", "STAT_EXPECTED_VALUE"],
		["tcdf(2 m, 10)", "STAT_EXPECTED_VALUE"],
		["erf(50%)", "STAT_EXPECTED_VALUE"],
		["gamma(asin(2))", "STAT_EXPECTED_VALUE"],
	];
	test.each(refused)("%s is refused with %s", (source, expected) => {
		const v = value(source);
		expect({ source, type: v.type, code: v.errorCode }).toEqual({ source, type: ValueType.Error, code: expected });
	});

	test("the message names the argument and the rule", () => {
		expect(value("binompdf(10, 0.5, 11)").errorMessage).toBe(
			"binompdf: the number of successes cannot be more than the number of trials (10), but was 11",
		);
		expect(value("normalinv(1)").errorMessage).toBe(
			"normalinv: the probability must be greater than 0 and less than 1, but was 1",
		);
		expect(value("invnorm(1)").errorMessage).toContain("invnorm");
		expect(value("gamma(200)").errorMessage).toContain("lgamma(200)");
	});

	test("a probability of exactly 0 or 1 is fine where it has an answer", () => {
		expect(num("binompdf(10, 0, 0)")).toBe(1);
		expect(num("binompdf(10, 1, 10)")).toBe(1);
		expect(num("binomcdf(10, 1, 9)")).toBe(0);
		expect(num("binompdf(0, 0.3, 0)")).toBe(1);
	});

	test("an Error is returned, never thrown", () => {
		for (const [source] of refused) expect(() => value(source)).not.toThrow();
		expect(code("normalinv(1)")).toBe("STAT_PROBABILITY_RANGE");
	});
});

describe("the names are calls, and only with brackets", () => {
	test("gamma without brackets is still a variable", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "gamma = 5");
		expect(engine.evaluateLine(2, "gamma * 2").toNumber()).toBe(10);
	});

	test("without the statistics package the calls are not known", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-statistics") });
		let answered = false;
		try {
			answered = slim.evaluateLine(1, "binompdf(10, 0.5, 3)").type === ValueType.Number;
		} catch {
			answered = false;
		}
		expect(answered).toBe(false);
		slim.clear();
	});
});
