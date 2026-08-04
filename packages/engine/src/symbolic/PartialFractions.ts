/**
 * Partial-fraction decomposition of a rational function.
 *
 * `(3x+5)/(x^2-1)` becomes `4/(x-1) - 1/(x+1)`. Two quite different things want
 * this. A person reading a rational function wants to see what it is made of,
 * and the integrator needs it, because a rational function has no general
 * antiderivative rule but every one of these pieces does.
 *
 * ## How the coefficients are found
 *
 * By undetermined coefficients, solved as an exact linear system. The
 * alternative, the cover-up or residue method, is shorter but only handles
 * distinct linear factors directly and needs separate machinery for repeated
 * factors and irreducible quadratics. One linear solve covers all three, and
 * over exact rationals it is answering a question with a definite answer rather
 * than converging on one.
 *
 * ## The one thing it inherits
 *
 * Decomposition is only as fine as the factorization behind it. `Factor.ts`
 * finds rational roots, so it splits off every linear factor, but it does not
 * split a quartic into two irreducible quadratics. When that happens the
 * quartic stays as one denominator with a cubic numerator over it. The result
 * is still correct, just less decomposed than a textbook would write it, and
 * `Integral.ts` then declines rather than guessing.
 */

import { type SymbolicNode, constNode, powNode } from "@solve-js/symbolic/SymbolicNode";
import {
	type Rational,
	RATIONAL_ZERO,
	RATIONAL_ONE,
	rationalAdd,
	rationalSub,
	rationalMul,
	rationalDiv,
	rationalNeg,
	isRationalZero,
} from "@solve-js/symbolic/Rational";
import { toPolynomial, fromPolynomial, polyCoefficients, polyUnivariateVar } from "@solve-js/symbolic/Polynomial";
import { polynomialDivide, coefficientGcd, isZeroPolynomial } from "@solve-js/symbolic/Gcd";
import { factorUnivariate } from "@solve-js/symbolic/Factor";
import { simplifySymbolic } from "@solve-js/symbolic/Simplify";

/**
 * Highest denominator degree {@link partialFractions} will decompose.
 *
 * The linear system is one unknown per degree, so the solve is cubic in this
 * number. Twelve keeps a pathological input from turning into a long exact
 * elimination, and matches the degree ceiling factoring already works under.
 */
export const APART_MAX_DEGREE = 12;

/** One `numerator / base^power` piece of a decomposition. */
export interface PartialFractionTerm {
	/** Ascending coefficients of the numerator, of lower degree than the base. */
	readonly numerator: readonly Rational[];
	/** Ascending coefficients of the irreducible denominator factor, monic. */
	readonly base: readonly Rational[];
	/** Which power of the base this piece sits over, counting from one. */
	readonly power: number;
}

/** A rational function written as a polynomial plus a sum of simple fractions. */
export interface PartialFractionDecomposition {
	/** Ascending coefficients of the polynomial part, empty when the fraction was already proper. */
	readonly polynomial: readonly Rational[];
	/** The fraction pieces, in the order the denominator's factors were found. */
	readonly terms: readonly PartialFractionTerm[];
}

/** Multiplies two ascending coefficient lists. */
function multiply(a: readonly Rational[], b: readonly Rational[]): Rational[] {
	if (a.length === 0 || b.length === 0) return [];
	const product: Rational[] = new Array(a.length + b.length - 1).fill(RATIONAL_ZERO);
	a.forEach((left, i) => {
		b.forEach((right, j) => {
			product[i + j] = rationalAdd(product[i + j], rationalMul(left, right));
		});
	});
	return product;
}

/** Raises an ascending coefficient list to a non-negative integer power. */
function power(base: readonly Rational[], exponent: number): Rational[] {
	let result: Rational[] = [RATIONAL_ONE];
	for (let i = 0; i < exponent; i++) result = multiply(result, base);
	return result;
}

/** Scales an ascending coefficient list. */
function scale(coefficients: readonly Rational[], factor: Rational): Rational[] {
	return coefficients.map(coefficient => rationalDiv(coefficient, factor));
}

/**
 * The irreducible factors of a monic denominator, as ascending coefficient
 * lists with multiplicity.
 *
 * Routed through {@link factorUnivariate} rather than repeating its rational
 * root search, at the cost of a round trip through the expression tree.
 *
 * The one thing done here first is pulling out the powers of the variable
 * itself. The rational-root theorem needs a non-zero constant term to have any
 * candidates at all, so `x^3-x` comes back from {@link factorUnivariate}
 * unfactored, and a decomposition over `1/(x^3-x)` would then be no
 * decomposition. `factorSymbolic` extracts the common monomial before calling
 * it for the same reason.
 *
 * @param ascending - Ascending coefficients of the monic denominator.
 * @param variable - The variable it is written in.
 * @returns The factors, or `null` when one cannot be read back as a polynomial.
 */
function denominatorFactors(
	ascending: readonly Rational[],
	variable: string,
): { base: Rational[]; power: number }[] | null {
	const factors: { base: Rational[]; power: number }[] = [];

	let lowest = 0;
	while (lowest < ascending.length && isRationalZero(ascending[lowest])) lowest++;
	if (lowest > 0) factors.push({ base: [RATIONAL_ZERO, RATIONAL_ONE], power: lowest });

	const remaining = ascending.slice(lowest);
	if (remaining.length > 1) {
		const factorization = factorUnivariate([...remaining].reverse(), variable);
		for (const factor of factorization.factors) {
			const polynomial = toPolynomial(factor.base);
			if (polynomial === null) return null;
			factors.push({ base: [...polyCoefficients(polynomial, variable)], power: factor.power });
		}
	}
	return factors.length > 0 ? factors : null;
}

/** One unknown in the linear system: which factor, which power of it, and which coefficient of that numerator. */
interface Unknown {
	readonly factor: number;
	readonly power: number;
	readonly degree: number;
}

/**
 * Enumerates the unknowns a decomposition needs.
 *
 * A factor of degree `d` appearing to the power `m` contributes `m` numerators
 * of degree below `d`, so `m*d` unknowns. Summed over the factorization that is
 * exactly the degree of the denominator, which is why the system below is
 * square.
 */
function enumerateUnknowns(factors: readonly { base: Rational[]; power: number }[]): Unknown[] {
	const unknowns: Unknown[] = [];
	factors.forEach((factor, index) => {
		const factorDegree = factor.base.length - 1;
		for (let p = 1; p <= factor.power; p++) {
			for (let degree = 0; degree < factorDegree; degree++) {
				unknowns.push({ factor: index, power: p, degree });
			}
		}
	});
	return unknowns;
}

/**
 * The polynomial each unknown multiplies once the identity is cleared of
 * denominators.
 *
 * Multiplying `N/(f^p)` by the whole denominator leaves `N` times everything
 * except `f^p`, so the column for the coefficient of `x^k` in `N` is `x^k`
 * times that cofactor.
 */
function unknownColumn(
	unknown: Unknown,
	factors: readonly { base: Rational[]; power: number }[],
	denominator: readonly Rational[],
): Rational[] | null {
	const divisor = power(factors[unknown.factor].base, unknown.power);
	const { quotient, remainder } = polynomialDivide(denominator, divisor);
	// The divisor is a factor of the denominator by construction, so a remainder
	// here would mean the factorization did not multiply back and the answer
	// would be silently wrong.
	if (!isZeroPolynomial(remainder)) return null;

	const shift: Rational[] = new Array(unknown.degree).fill(RATIONAL_ZERO);
	shift.push(RATIONAL_ONE);
	return multiply(quotient, shift);
}

/**
 * Solves a square linear system over the rationals by Gaussian elimination.
 *
 * @param matrix - Row-major coefficients, modified in place.
 * @param target - The right-hand side, modified in place.
 * @returns The solution, or `null` when the system is singular.
 */
function solveLinearSystem(matrix: Rational[][], target: Rational[]): Rational[] | null {
	const size = target.length;
	for (let column = 0; column < size; column++) {
		let pivot = -1;
		for (let row = column; row < size; row++) {
			if (!isRationalZero(matrix[row][column])) {
				pivot = row;
				break;
			}
		}
		if (pivot === -1) return null;
		[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
		[target[column], target[pivot]] = [target[pivot], target[column]];

		for (let row = 0; row < size; row++) {
			if (row === column || isRationalZero(matrix[row][column])) continue;
			const factor = rationalDiv(matrix[row][column], matrix[column][column]);
			for (let k = column; k < size; k++) {
				matrix[row][k] = rationalSub(matrix[row][k], rationalMul(factor, matrix[column][k]));
			}
			target[row] = rationalSub(target[row], rationalMul(factor, target[column]));
		}
	}
	return target.map((value, index) => rationalDiv(value, matrix[index][index]));
}

/**
 * Decomposes a rational function into partial fractions.
 *
 * @param numerator - Ascending coefficients of the numerator.
 * @param denominator - Ascending coefficients of the denominator.
 * @param variable - The variable both are written in.
 * @returns The decomposition, or `null` when the denominator is constant, above
 * {@link APART_MAX_DEGREE}, or does not factor into pieces this can solve over.
 */
export function partialFractions(
	numerator: readonly Rational[],
	denominator: readonly Rational[],
	variable: string,
): PartialFractionDecomposition | null {
	if (denominator.length < 2 || denominator.length - 1 > APART_MAX_DEGREE) return null;

	// Cancel first, so a fraction that is secretly a polynomial does not get
	// decomposed over a factor that is not really there.
	const shared = coefficientGcd(numerator, denominator);
	const reducedNumerator = shared.length > 1 ? polynomialDivide(numerator, shared).quotient : [...numerator];
	const reducedDenominator = shared.length > 1 ? polynomialDivide(denominator, shared).quotient : [...denominator];
	// Cancelling can leave no denominator at all, as it does for
	// `(x^2-1)/(x-1)`. That is a polynomial and an answer, not a failure.
	if (reducedDenominator.length === 1) {
		return { polynomial: scale(reducedNumerator, reducedDenominator[0]), terms: [] };
	}
	if (reducedDenominator.length === 0) return null;

	// Made monic, so the factorization carries no content and every factor below
	// is monic too.
	const leading = reducedDenominator[reducedDenominator.length - 1];
	const monicDenominator = scale(reducedDenominator, leading);
	const scaledNumerator = scale(reducedNumerator, leading);

	const { quotient, remainder } = polynomialDivide(scaledNumerator, monicDenominator);
	if (isZeroPolynomial(remainder)) return { polynomial: quotient, terms: [] };

	const factors = denominatorFactors(monicDenominator, variable);
	if (factors === null) return null;

	const terms = solveForNumerators(factors, monicDenominator, remainder);
	return terms === null ? null : { polynomial: quotient, terms };
}

/**
 * Builds and solves the undetermined-coefficient system, then groups the
 * solution back into one numerator per piece.
 */
function solveForNumerators(
	factors: readonly { base: Rational[]; power: number }[],
	denominator: readonly Rational[],
	remainder: readonly Rational[],
): PartialFractionTerm[] | null {
	const unknowns = enumerateUnknowns(factors);
	const size = denominator.length - 1;
	if (unknowns.length !== size) return null;

	const columns: Rational[][] = [];
	for (const unknown of unknowns) {
		const column = unknownColumn(unknown, factors, denominator);
		if (column === null) return null;
		columns.push(column);
	}

	// Row `i` is the coefficient of `x^i`, which is what makes the system square.
	const matrix: Rational[][] = [];
	for (let row = 0; row < size; row++) {
		matrix.push(columns.map(column => column[row] ?? RATIONAL_ZERO));
	}
	const target: Rational[] = [];
	for (let row = 0; row < size; row++) target.push(remainder[row] ?? RATIONAL_ZERO);

	const solution = solveLinearSystem(matrix, target);
	if (solution === null) return null;
	return groupSolution(unknowns, solution, factors);
}

/** Collects the solved coefficients back into one numerator per `base^power` piece. */
function groupSolution(
	unknowns: readonly Unknown[],
	solution: readonly Rational[],
	factors: readonly { base: Rational[]; power: number }[],
): PartialFractionTerm[] {
	const grouped = new Map<string, Rational[]>();
	unknowns.forEach((unknown, index) => {
		const key = `${unknown.factor}:${unknown.power}`;
		const existing = grouped.get(key) ?? [];
		existing[unknown.degree] = solution[index];
		grouped.set(key, existing);
	});

	const terms: PartialFractionTerm[] = [];
	for (const [key, coefficients] of grouped) {
		const [factorIndex, termPower] = key.split(":").map(Number);
		const filled = [...coefficients].map(value => value ?? RATIONAL_ZERO);
		// A piece whose numerator solved to zero is not part of the answer.
		if (filled.every(isRationalZero)) continue;
		terms.push({ numerator: filled, base: factors[factorIndex].base, power: termPower });
	}
	return terms;
}

/** Rebuilds an ascending coefficient list as an expression in one variable. */
export function coefficientsToNode(coefficients: readonly Rational[], variable: string): SymbolicNode {
	const terms = new Map<string, Rational>();
	coefficients.forEach((coefficient, exponent) => {
		if (isRationalZero(coefficient)) return;
		terms.set(exponent === 0 ? "" : exponent === 1 ? variable : `${variable}^${exponent}`, coefficient);
	});
	if (terms.size === 0) return constNode(RATIONAL_ZERO);
	return fromPolynomial({ terms, vars: coefficients.length > 1 ? [variable] : [] });
}

/**
 * Decomposes a quotient of polynomials into partial fractions.
 *
 * @param node - The expression to decompose.
 * @returns The decomposed sum, or `node` unchanged when it is not a rational
 * function in one variable or has nothing to decompose.
 */
export function apartSymbolic(node: SymbolicNode): SymbolicNode {
	const parts = asRationalFunction(node);
	if (parts === null) return node;

	const decomposition = partialFractions(parts.numerator, parts.denominator, parts.variable);
	if (decomposition === null || decomposition.terms.length === 0) return node;

	let result: SymbolicNode | null = decomposition.polynomial.length > 0
		? coefficientsToNode(decomposition.polynomial, parts.variable)
		: null;

	for (const term of decomposition.terms) {
		const base = coefficientsToNode(term.base, parts.variable);
		const denominator = term.power === 1 ? base : powNode(base, constNode({ n: BigInt(term.power), d: 1n }));
		// A wholly negative numerator becomes a subtraction rather than the
		// addition of a negative, which is how partial fractions are written and
		// which avoids the literal `+-1/(x+1)`.
		const negative = isNegativeNumerator(term.numerator);
		const numerator = negative ? term.numerator.map(coefficient => rationalNeg(coefficient)) : term.numerator;
		const piece: SymbolicNode = {
			kind: "div",
			left: coefficientsToNode(numerator, parts.variable),
			right: denominator,
		};
		if (result === null) result = negative ? { kind: "neg", operand: piece } : piece;
		else result = { kind: negative ? "sub" : "add", left: result, right: piece };
	}
	return result === null ? node : simplifySymbolic(result);
}

/** Whether every coefficient of a numerator is at most zero, so the whole piece reads better subtracted. */
function isNegativeNumerator(coefficients: readonly Rational[]): boolean {
	return coefficients.some(coefficient => coefficient.n < 0n)
		&& coefficients.every(coefficient => coefficient.n <= 0n);
}

/** A quotient split into ascending numerator and denominator coefficients over one variable. */
export interface RationalFunctionParts {
	readonly numerator: readonly Rational[];
	readonly denominator: readonly Rational[];
	readonly variable: string;
}

/**
 * Reads a quotient of univariate polynomials out of an expression.
 *
 * @param node - The expression to read.
 * @returns The two coefficient lists and the variable, or `null` when the
 * expression is not such a quotient.
 */
export function asRationalFunction(node: SymbolicNode): RationalFunctionParts | null {
	if (node.kind !== "div") return null;

	const numerator = toPolynomial(node.left);
	const denominator = toPolynomial(node.right);
	if (numerator === null || denominator === null) return null;

	// The variable has to come from the denominator: a numerator can legitimately
	// be a constant, and a constant denominator is not a rational function at all.
	const variable = polyUnivariateVar(denominator);
	if (variable === null) return null;
	if (numerator.vars.some(name => name !== variable)) return null;

	return {
		numerator: polyCoefficients(numerator, variable),
		denominator: polyCoefficients(denominator, variable),
		variable,
	};
}

/** Multiplies two ascending coefficient lists, exposed so a caller can rebuild a decomposition and check it. */
export function multiplyCoefficients(a: readonly Rational[], b: readonly Rational[]): Rational[] {
	return multiply(a, b);
}

/** Raises an ascending coefficient list to a power, exposed alongside {@link multiplyCoefficients}. */
export function powerCoefficients(base: readonly Rational[], exponent: number): Rational[] {
	return power(base, exponent);
}
