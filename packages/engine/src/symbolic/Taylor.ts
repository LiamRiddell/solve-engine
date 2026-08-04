/**
 * Taylor series expansion, and the Jacobian matrix.
 *
 * Both are built directly on {@link differentiate}, so both are exact wherever
 * differentiation is. A Taylor coefficient is `f^(n)(a) / n!`, which needs the
 * n-th derivative evaluated *at a point*, and that evaluation is the one place
 * this can fail: a derivative that does not reduce to a plain number at the
 * point has no exact rational coefficient, and this reports that rather than
 * approximating one.
 *
 * That is why the exact values of the standard functions at zero (`sin(0)`,
 * `cos(0)`, `exp(0)`, and so on) matter to the simplifier's own folding: they
 * are what makes the familiar series around the origin come out exactly.
 */

import {
	type SymbolicNode,
	constNode,
	varNode,
	powNode,
	substitute,
} from "@solve-js/symbolic/SymbolicNode";
import { type Rational, RATIONAL_ZERO, rationalDiv, isRationalZero } from "@solve-js/symbolic/Rational";
import { simplifySymbolic } from "@solve-js/symbolic/Simplify";
import { differentiate } from "@solve-js/symbolic/Derivative";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * Highest Taylor degree accepted.
 *
 * Each term needs one more derivative than the last, so cost grows with the
 * square of the degree once the expressions themselves start growing.
 */
export const TAYLOR_MAX_DEGREE = 16;

/**
 * Expands an expression as a Taylor series about a point.
 *
 * @param node - The expression to expand.
 * @param variable - The variable to expand in.
 * @param point - The point to expand about, `0` giving a Maclaurin series.
 * @param degree - The highest power to include.
 * @returns The series as an expression.
 * @throws {EngineError} `SYMBOLIC_TAYLOR_DEGREE_LIMIT` past
 * {@link TAYLOR_MAX_DEGREE}, or `SYMBOLIC_TAYLOR_INEXACT` when a coefficient
 * does not reduce to an exact number at the point.
 */
export function taylorSeries(node: SymbolicNode, variable: string, point: Rational, degree: number): SymbolicNode {
	if (degree < 0 || !Number.isInteger(degree) || degree > TAYLOR_MAX_DEGREE) {
		throw ErrorFactory.execution(
			"SYMBOLIC_TAYLOR_DEGREE_LIMIT",
			`A Taylor degree must be a whole number from 0 to ${TAYLOR_MAX_DEGREE}.`,
			{ limit: TAYLOR_MAX_DEGREE },
		);
	}

	const pointNode = constNode(point);
	let factorial = 1n;
	let result: SymbolicNode = constNode(RATIONAL_ZERO);

	for (let order = 0; order <= degree; order++) {
		if (order > 0) factorial *= BigInt(order);

		const derivative = differentiate(node, variable, order);
		const atPoint = simplifySymbolic(substitute(derivative, variable, pointNode));
		if (atPoint.kind !== "const") {
			throw ErrorFactory.execution(
				"SYMBOLIC_TAYLOR_INEXACT",
				`The derivative of order ${order} does not reduce to an exact number at the expansion point, so this series cannot be computed exactly.`,
				{ order },
			);
		}

		const coefficient = rationalDiv(atPoint.value, { n: factorial, d: 1n });
		if (isRationalZero(coefficient)) continue;

		// (x - a)^order, collapsing to 1 and to (x - a) at the low orders so the
		// series reads the way it is written rather than carrying `^1` and `^0`.
		const shifted: SymbolicNode = isRationalZero(point)
			? varNode(variable)
			: { kind: "sub", left: varNode(variable), right: pointNode };
		const power: SymbolicNode =
			order === 0 ? constNode(1) : order === 1 ? shifted : powNode(shifted, constNode(order));

		result = { kind: "add", left: result, right: { kind: "mul", left: constNode(coefficient), right: power } };
	}

	return simplifySymbolic(result);
}

/**
 * The Jacobian: each row is one function's gradient.
 *
 * @param functions - The functions, in row order.
 * @param variables - The variables, in column order.
 * @returns A row-major grid of partial derivatives, entry `[i][j]` being the
 * derivative of `functions[i]` with respect to `variables[j]`.
 */
export function jacobian(functions: readonly SymbolicNode[], variables: readonly string[]): SymbolicNode[][] {
	return functions.map(fn => variables.map(variable => differentiate(fn, variable)));
}
