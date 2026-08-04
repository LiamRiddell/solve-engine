/**
 * Symbolic indefinite integration.
 *
 * ## Failing loudly is the feature
 *
 * Integration, unlike differentiation, has no algorithm that always succeeds:
 * plenty of perfectly ordinary expressions have no elementary antiderivative at
 * all, `exp(x^2)` and `sin(x)/x` among them. So this handles polynomials
 * exactly, plus a small table of standard forms with a linear inner argument,
 * and **reports what it cannot do rather than approximating**.
 *
 * A CAS that quietly returns something wrong for `integral(exp(x^2), x)` is
 * worse than one that says it cannot, because the wrong answer is
 * indistinguishable from a right one at the point of use.
 *
 * The constant of integration is omitted, as is conventional for a calculator.
 */

import {
	type SymbolicNode,
	constNode,
	varNode,
	powNode,
	callNode,
	freeVariables,
} from "@solve-js/symbolic/SymbolicNode";
import {
	type Rational,
	rationalDiv,
	isRationalZero,
} from "@solve-js/symbolic/Rational";
import { toPolynomial, polyCoefficients, polyDegree } from "@solve-js/symbolic/Polynomial";
import { simplifySymbolic } from "@solve-js/symbolic/Simplify";

/** The result of an integration attempt, which may legitimately fail. */
export type IntegralResult =
	/** An antiderivative was found. */
	| { readonly ok: true; readonly value: SymbolicNode }
	/** None was found, with the reason stated so the caller can pass it on. */
	| { readonly ok: false; readonly reason: string };

/** `a*x + b` decomposed, or `null` when the expression is not linear in `variable`. */
interface LinearArgument {
	readonly slope: Rational;
	readonly intercept: Rational;
}

/** Reads `a*x + b` out of an expression, which is the only inner-argument shape the table below handles. */
function asLinear(node: SymbolicNode, variable: string): LinearArgument | null {
	const polynomial = toPolynomial(node);
	if (polynomial === null) return null;
	const others = polynomial.vars.filter(name => name !== variable);
	if (others.length > 0) return null;
	if (polyDegree(polynomial, variable) > 1) return null;

	const ascending = polyCoefficients(polynomial, variable);
	const intercept = ascending[0] ?? { n: 0n, d: 1n };
	const slope = ascending[1] ?? { n: 0n, d: 1n };
	return isRationalZero(slope) ? null : { slope, intercept };
}

/**
 * Integrates a polynomial term by term with the power rule.
 *
 * `x^-1` is deliberately excluded here and handled by the table instead, since
 * its antiderivative is a logarithm rather than a power. In practice the
 * polynomial form cannot carry a negative exponent anyway, but stating the
 * boundary keeps the two paths from overlapping silently.
 */
function integratePolynomial(node: SymbolicNode, variable: string): IntegralResult | null {
	const polynomial = toPolynomial(node);
	if (polynomial === null) return null;
	const others = polynomial.vars.filter(name => name !== variable);
	if (others.length > 0) {
		return { ok: false, reason: `it involves more than one unknown (${others.join(", ")})` };
	}

	const ascending = polyCoefficients(polynomial, variable);
	let result: SymbolicNode = constNode(0);
	ascending.forEach((coeff, power) => {
		if (isRationalZero(coeff)) return;
		const nextPower = power + 1;
		const scaled = rationalDiv(coeff, { n: BigInt(nextPower), d: 1n });
		const term: SymbolicNode = {
			kind: "mul",
			left: constNode(scaled),
			right: nextPower === 1 ? varNode(variable) : powNode(varNode(variable), constNode(nextPower)),
		};
		result = { kind: "add", left: result, right: term };
	});
	return { ok: true, value: simplifySymbolic(result) };
}

/**
 * The standard-form table, for a function of a linear argument.
 *
 * Every entry divides by the inner slope, which is the linear-substitution rule
 * `integral f(ax+b) dx = F(ax+b)/a`.
 */
function integrateStandardForm(node: SymbolicNode, variable: string): IntegralResult | null {
	if (node.kind !== "call" || node.args.length !== 1) return null;
	const linear = asLinear(node.args[0], variable);
	if (linear === null) return null;

	const inner = node.args[0];
	const divideBySlope = (value: SymbolicNode): SymbolicNode =>
		simplifySymbolic({ kind: "div", left: value, right: constNode(linear.slope) });

	switch (node.name) {
		case "exp":
			return { ok: true, value: divideBySlope(callNode("exp", [inner])) };
		case "sin":
			return { ok: true, value: divideBySlope({ kind: "neg", operand: callNode("cos", [inner]) }) };
		case "cos":
			return { ok: true, value: divideBySlope(callNode("sin", [inner])) };
		case "log":
			// integral ln(u) du = u*ln(u) - u, then divided by the inner slope.
			return {
				ok: true,
				value: divideBySlope({
					kind: "sub",
					left: { kind: "mul", left: inner, right: callNode("log", [inner]) },
					right: inner,
				}),
			};
		default:
			return null;
	}
}

/** `1/x` and `1/(1+x^2)`, whose antiderivatives are a logarithm and an arctangent rather than powers. */
function integrateReciprocalForms(node: SymbolicNode, variable: string): IntegralResult | null {
	if (node.kind !== "div") return null;
	if (node.left.kind !== "const" || !isRationalOneNode(node.left.value)) return null;

	const linear = asLinear(node.right, variable);
	if (linear !== null) {
		// integral 1/(ax+b) dx = ln(|ax+b|)/a. Written without the absolute value
		// bars, matching how the rest of this engine treats log's domain.
		return {
			ok: true,
			value: simplifySymbolic({
				kind: "div",
				left: callNode("log", [node.right]),
				right: constNode(linear.slope),
			}),
		};
	}

	// integral 1/(1+x^2) dx = atan(x), the one non-linear denominator worth a
	// table entry because it turns up constantly.
	const denominator = toPolynomial(node.right);
	if (denominator !== null && denominator.vars.length === 1 && denominator.vars[0] === variable) {
		const ascending = polyCoefficients(denominator, variable);
		const isOnePlusSquare =
			ascending.length === 3 &&
			isRationalOneNode(ascending[0]) &&
			isRationalZero(ascending[1]) &&
			isRationalOneNode(ascending[2]);
		if (isOnePlusSquare) return { ok: true, value: callNode("atan", [varNode(variable)]) };
	}
	return null;
}

/** Whether a rational is exactly one. */
function isRationalOneNode(value: Rational): boolean {
	return value.n === 1n && value.d === 1n;
}

/**
 * Finds an indefinite integral, or reports that it could not.
 *
 * @param node - The expression to integrate.
 * @param variable - The variable of integration.
 * @returns The antiderivative, without a constant of integration, or a stated
 * reason for declining.
 */
export function integrate(node: SymbolicNode, variable: string): IntegralResult {
	const simplified = simplifySymbolic(node);

	// A constant integrates to itself times the variable, including the case
	// where the expression involves other unknowns but not this one.
	if (!freeVariables(simplified).has(variable)) {
		return { ok: true, value: simplifySymbolic({ kind: "mul", left: simplified, right: varNode(variable) }) };
	}

	const polynomial = integratePolynomial(simplified, variable);
	if (polynomial !== null) return polynomial;

	const standard = integrateStandardForm(simplified, variable);
	if (standard !== null) return standard;

	const reciprocal = integrateReciprocalForms(simplified, variable);
	if (reciprocal !== null) return reciprocal;

	// A sum is integrable term by term whenever each term is, which covers the
	// common "polynomial plus a standard form" shape.
	if (simplified.kind === "add" || simplified.kind === "sub") {
		const left = integrate(simplified.left, variable);
		if (!left.ok) return left;
		const right = integrate(simplified.right, variable);
		if (!right.ok) return right;
		return {
			ok: true,
			value: simplifySymbolic({ kind: simplified.kind, left: left.value, right: right.value }),
		};
	}

	// A constant multiple comes out front.
	if (simplified.kind === "mul" && simplified.left.kind === "const") {
		const inner = integrate(simplified.right, variable);
		if (!inner.ok) return inner;
		return { ok: true, value: simplifySymbolic({ kind: "mul", left: simplified.left, right: inner.value }) };
	}

	return {
		ok: false,
		reason: "no elementary antiderivative is known for this expression",
	};
}

