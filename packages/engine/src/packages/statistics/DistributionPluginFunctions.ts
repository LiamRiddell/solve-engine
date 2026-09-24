/**
 * The engine-facing layer over DistributionMath.ts: read each call's arguments
 * off the engine's values, check that every one is in the distribution's
 * domain, and return a Number. An argument outside it (a probability of 1.5, a
 * standard deviation of zero, 2.5 successes, 11 successes in 10 trials) is
 * answered with a structured Error that names the argument and the rule, never
 * with a number the formula would produce anyway.
 *
 * Argument order follows a graphing calculator's: a continuous distribution
 * takes the value first and its parameters after (`normalcdf(x, mean, sd)`,
 * `tcdf(t, df)`), a discrete one takes its parameters first and the count last
 * (`binompdf(n, p, k)`, `poissonpdf(mean, k)`).
 */
import { Value, numberValue, errorValue, ValueType } from "@solve-js/vm/Value";
import { argumentCount } from "./StatisticsPluginFunctions";
import {
	normalCdf, normalPdf, normalInv,
	binomialPmf, binomialCdf, poissonPmf, poissonCdf,
	studentTPdf, studentTCdf, studentTInv,
	erf, erfc, gamma, logGamma, GAMMA_MAX,
} from "./DistributionMath";

/** A plugin function: the call's arguments in, a Value out. */
type Handler = (args: Value[]) => Value;

/**
 * Argument `i` as a plain number, or the Error naming its role. A quantity with
 * a unit, a percentage, text or a list is not a plain number here, and neither
 * is NaN (what `asin(2)` gives), which no distribution has a value at.
 */
function readNumber(name: string, args: readonly Value[], i: number, role: string): number | Value {
	const arg = args[i];
	if (arg.type === ValueType.Number && !Number.isNaN(arg.value as number)) return arg.value as number;
	return errorValue("STAT_EXPECTED_VALUE", `${name} expects a number for its ${role}`);
}

/**
 * Argument `i` as a probability: a plain number or a percentage (`97.5%` is
 * 0.975). `open` excludes the ends, for the quantiles, where a probability of
 * exactly 0 or 1 has no finite answer.
 */
function readProbability(name: string, args: readonly Value[], i: number, role: string, open: boolean): number | Value {
	const arg = args[i];
	const p = arg.value as number;
	if ((arg.type !== ValueType.Number && arg.type !== ValueType.Percentage) || Number.isNaN(p)) {
		return errorValue("STAT_EXPECTED_VALUE", `${name} expects a number for its ${role}`);
	}
	if (open ? !(p > 0 && p < 1) : !(p >= 0 && p <= 1)) {
		const range = open ? "greater than 0 and less than 1" : "from 0 to 1";
		return errorValue("STAT_PROBABILITY_RANGE", `${name}: the ${role} must be ${range}, but was ${p}`);
	}
	return p;
}

/**
 * Argument `i` as a count: a whole number from 0 up to the largest whole number
 * a double holds exactly. 2.5 successes is refused by name rather than rounded,
 * since rounding would answer a question that was not asked.
 */
function readCount(name: string, args: readonly Value[], i: number, role: string): number | Value {
	const k = readNumber(name, args, i, role);
	if (k instanceof Value) return k;
	if (!Number.isInteger(k)) return errorValue("STAT_NOT_WHOLE", `${name}: the ${role} must be a whole number, but was ${k}`);
	if (k < 0) return errorValue("STAT_COUNT_RANGE", `${name}: the ${role} cannot be negative, but was ${k}`);
	if (k > Number.MAX_SAFE_INTEGER) {
		return errorValue("STAT_COUNT_RANGE", `${name}: the ${role} must be at most ${Number.MAX_SAFE_INTEGER}, but was ${k}`);
	}
	return k;
}

/** Argument `i` as a positive, finite number, or `code` naming the rule. */
function readPositive(name: string, args: readonly Value[], i: number, role: string, code: string): number | Value {
	const x = readNumber(name, args, i, role);
	if (x instanceof Value) return x;
	if (!(x > 0) || !Number.isFinite(x)) {
		return errorValue(code, `${name}: the ${role} must be a finite number greater than zero, but was ${x}`);
	}
	return x;
}

/**
 * The answer as a Number, or the Error for the two ways a computation can fail
 * to have one: NaN, where an iteration did not settle within its budget (a
 * Poisson average in the tens of billions), and a result past the largest
 * double.
 */
function answer(name: string, x: number): Value {
	if (Number.isNaN(x)) {
		return errorValue("STAT_NO_CONVERGENCE", `${name} could not reach an accurate answer for arguments this large`);
	}
	if (!Number.isFinite(x)) {
		return errorValue("STAT_OVERFLOW", `${name}: the answer is beyond the largest number that can be represented`);
	}
	return numberValue(x);
}

// ── The normal distribution ─────────────────────────────────────────────────

/**
 * Read a normal-distribution call's arguments as its first argument and a mean
 * and standard deviation, or the Error that refuses them.
 *
 * One argument is on the standard normal (mean 0, standard deviation 1), the
 * form that has always shipped. Three are that argument, a mean and a standard
 * deviation, the order a spreadsheet's `NORM.DIST` and `NORM.INV` use. Two are
 * refused: a mean with no standard deviation has no scale, and guessing one is
 * the silent wrong answer this exists to remove. A standard deviation must be a
 * positive, finite number, since a normal with no spread (or a negative one)
 * has no curve.
 */
function readNormal(
	name: string,
	args: readonly Value[],
	usage: string,
	first: () => number | Value,
): { first: number; mean: number; sd: number } | Value {
	const count = argumentCount(name, args, [1, 3], usage);
	if (count) return count;
	const x = first();
	if (x instanceof Value) return x;
	if (args.length === 1) return { first: x, mean: 0, sd: 1 };
	const mean = readNumber(name, args, 1, "mean");
	if (mean instanceof Value) return mean;
	const sd = readNumber(name, args, 2, "standard deviation");
	if (sd instanceof Value) return sd;
	if (!(sd > 0) || !Number.isFinite(sd)) {
		return errorValue("STAT_SD_NOT_POSITIVE", `${name}: a standard deviation must be greater than zero, but was ${sd}`);
	}
	return { first: x, mean, sd };
}

/** The role of a normal CDF or density's first argument: a z-score alone, a value beside a mean. */
function normalValue(name: string, args: readonly Value[]): () => number | Value {
	return () => readNumber(name, args, 0, args.length === 1 ? "z-score" : "value");
}

/** `normalcdf(z)` or `normalcdf(x, mean, sd)`: the share of the curve at or below. */
function normalCdfHandler(name: string): Handler {
	return (args) => {
		const normal = readNormal(name, args, `${name}(1.96) or ${name}(110, 100, 15)`, normalValue(name, args));
		return normal instanceof Value ? normal : numberValue(normalCdf((normal.first - normal.mean) / normal.sd));
	};
}

/** `normalpdf(z)` or `normalpdf(x, mean, sd)`: the height of the curve. */
function normalPdfHandler(name: string): Handler {
	return (args) => {
		const normal = readNormal(name, args, `${name}(1.96) or ${name}(110, 100, 15)`, normalValue(name, args));
		// The density is per unit of x, so standardising divides it by the sd.
		return normal instanceof Value ? normal : numberValue(normalPdf((normal.first - normal.mean) / normal.sd) / normal.sd);
	};
}

/** `normalinv(p)` or `normalinv(p, mean, sd)`: the value with a share p at or below it. */
function normalInvHandler(name: string): Handler {
	return (args) => {
		const usage = `${name}(0.975) or ${name}(0.975, 100, 15)`;
		const normal = readNormal(name, args, usage, () => readProbability(name, args, 0, "probability", true));
		return normal instanceof Value ? normal : answer(name, normal.mean + normal.sd * normalInv(normal.first));
	};
}

// ── The binomial distribution ────────────────────────────────────────────────

/**
 * `(n, p, k)`: n trials, each succeeding with probability p, and k successes.
 * k must be from 0 to n; more successes than trials is refused rather than
 * answered 0, because it is far more often the arguments in another order (a
 * spreadsheet's `BINOM.DIST` puts k first) than a real question.
 */
function readBinomial(name: string, args: readonly Value[]): { n: number; p: number; k: number } | Value {
	const count = argumentCount(name, args, [3], `${name}(10, 0.5, 3)`);
	if (count) return count;
	const n = readCount(name, args, 0, "number of trials");
	if (n instanceof Value) return n;
	const p = readProbability(name, args, 1, "probability of success", false);
	if (p instanceof Value) return p;
	const k = readCount(name, args, 2, "number of successes");
	if (k instanceof Value) return k;
	if (k > n) {
		return errorValue("STAT_COUNT_RANGE", `${name}: the number of successes cannot be more than the number of trials (${n}), but was ${k}`);
	}
	return { n, p, k };
}

// ── The Poisson distribution ─────────────────────────────────────────────────

/** `(mean, k)`: events at an average of `mean` per interval, and k of them. */
function readPoisson(name: string, args: readonly Value[]): { mean: number; k: number } | Value {
	const count = argumentCount(name, args, [2], `${name}(2, 3)`);
	if (count) return count;
	const mean = readPositive(name, args, 0, "average number of events", "STAT_MEAN_NOT_POSITIVE");
	if (mean instanceof Value) return mean;
	const k = readCount(name, args, 1, "number of events");
	if (k instanceof Value) return k;
	return { mean, k };
}

// ── Student's t distribution ─────────────────────────────────────────────────

/** `(t, df)` or `(p, df)`: the first argument, then positive degrees of freedom. */
function readT(
	name: string,
	args: readonly Value[],
	usage: string,
	first: () => number | Value,
): { first: number; df: number } | Value {
	const count = argumentCount(name, args, [2], usage);
	if (count) return count;
	const x = first();
	if (x instanceof Value) return x;
	const df = readPositive(name, args, 1, "degrees of freedom", "STAT_DF_NOT_POSITIVE");
	if (df instanceof Value) return df;
	return { first: x, df };
}

/** `tinv(p, df)` / `invt(p, df)`: the t with a share p at or below it. */
function tInvHandler(name: string): Handler {
	return (args) => {
		const t = readT(name, args, `${name}(0.975, 10)`, () => readProbability(name, args, 0, "probability", true));
		return t instanceof Value ? t : answer(name, studentTInv(t.first, t.df));
	};
}

// ── The special functions ────────────────────────────────────────────────────

/** A one-argument function of any real number. */
function unary(name: string, fn: (x: number) => number): Handler {
	return (args) => {
		const count = argumentCount(name, args, [1], `${name}(0.5)`);
		if (count) return count;
		const x = readNumber(name, args, 0, "value");
		return x instanceof Value ? x : answer(name, fn(x));
	};
}

/** The probability-distribution plugin functions, keyed by the names the call parselet emits. */
export const DISTRIBUTION_PLUGIN_FUNCTIONS: Record<string, Handler> = {
	statNormalCdf: normalCdfHandler("normalcdf"),
	statNormalPdf: normalPdfHandler("normalpdf"),
	statNormalInv: normalInvHandler("normalinv"),
	statInvNorm: normalInvHandler("invnorm"),

	statBinomPdf: (args) => {
		const b = readBinomial("binompdf", args);
		return b instanceof Value ? b : answer("binompdf", binomialPmf(b.n, b.p, b.k));
	},
	statBinomCdf: (args) => {
		const b = readBinomial("binomcdf", args);
		return b instanceof Value ? b : answer("binomcdf", binomialCdf(b.n, b.p, b.k));
	},

	statPoissonPdf: (args) => {
		const p = readPoisson("poissonpdf", args);
		return p instanceof Value ? p : answer("poissonpdf", poissonPmf(p.mean, p.k));
	},
	statPoissonCdf: (args) => {
		const p = readPoisson("poissoncdf", args);
		return p instanceof Value ? p : answer("poissoncdf", poissonCdf(p.mean, p.k));
	},

	statTPdf: (args) => {
		const t = readT("tpdf", args, "tpdf(2, 10)", () => readNumber("tpdf", args, 0, "value"));
		return t instanceof Value ? t : answer("tpdf", studentTPdf(t.first, t.df));
	},
	statTCdf: (args) => {
		const t = readT("tcdf", args, "tcdf(2.23, 10)", () => readNumber("tcdf", args, 0, "value"));
		return t instanceof Value ? t : answer("tcdf", studentTCdf(t.first, t.df));
	},
	statTInv: tInvHandler("tinv"),
	statInvT: tInvHandler("invt"),

	statErf: unary("erf", erf),
	statErfc: unary("erfc", erfc),
	statGamma: (args) => {
		const count = argumentCount("gamma", args, [1], "gamma(5)");
		if (count) return count;
		const x = readNumber("gamma", args, 0, "value");
		if (x instanceof Value) return x;
		if (Number.isInteger(x) && x <= 0) {
			return errorValue("STAT_GAMMA_POLE", `gamma is undefined at zero and the negative whole numbers, but was given ${x}`);
		}
		if (x > GAMMA_MAX) {
			return errorValue("STAT_OVERFLOW", `gamma(${x}) is too large to represent (gamma is finite up to about 171.6), but lgamma(${x}) gives its natural logarithm`);
		}
		return answer("gamma", gamma(x));
	},
	statLGamma: (args) => {
		const count = argumentCount("lgamma", args, [1], "lgamma(200)");
		if (count) return count;
		const x = readPositive("lgamma", args, 0, "value", "STAT_NOT_POSITIVE");
		return x instanceof Value ? x : answer("lgamma", logGamma(x));
	},
};
