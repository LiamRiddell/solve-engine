import { Value, ValueType, errorValue, numberValue } from "@solve-js/vm/Value";
import { valueToSymbolic, exactResultToValue, readRealOperand } from "@solve-js/vm/SymbolicOps";
import { limitOf } from "@solve-js/symbolic/Limit";

/**
 * The package-local name `limit(...)` is emitted under. Specific rather than
 * `limit`, so a host's own `defineFunction("limit")` cannot collide with it.
 */
export const SYMBOLIC_LIMIT_FN = "symbolicLimit";

/**
 * `limit(expr, variable, point)`, the plugin function behind `LimitParselet`.
 *
 * The three arguments arrive in the order the parselet pushes them: the
 * expression, evaluated with its unknown bound to itself; the unknown's name as
 * a String; and the point. The mathematics is in `symbolic/Limit.ts`; this reads
 * the arguments and renders the outcome.
 *
 * An exact limit keeps its exact form, a fraction included. A numeric one is an
 * ordinary number. Every way a limit can fail to exist is its own named error:
 * the two sides disagreeing, the expression growing without bound, the values
 * never settling, and the expression having no real value near the point.
 *
 * @param args - The expression, the unknown's name and the point.
 * @returns The limit, or an error Value naming why there is none.
 */
export function limitHandler(args: Value[]): Value {
	const [target, variableValue, pointValue] = args;
	if (variableValue?.type !== ValueType.String) {
		return errorValue("SYMBOLIC_REQUIRES_VARIABLE_NAME", "limit needs the name of an unknown.");
	}
	const variable = variableValue.value as string;
	const expression = target === undefined ? null : valueToSymbolic(target);
	if (expression === null) return errorValue("SYMBOLIC_NONFINITE_OPERAND", "limit needs an expression with an exact value.");
	if (pointValue === undefined) return errorValue("SYMBOLIC_BOUND_INVALID", "limit needs the point the unknown approaches.");

	const point = readRealOperand(pointValue, "limit's point");
	if (point instanceof Value) return point;
	if (point.exact === null) {
		return errorValue("SYMBOLIC_BOUND_INVALID", "limit's point must be finite: a limit at infinity is not evaluated.");
	}

	const outcome = limitOf(expression, variable, point.exact);
	switch (outcome.kind) {
		case "exact":
			return exactResultToValue(outcome.value);
		case "numeric":
			return numberValue(outcome.value);
		case "diverges":
			return errorValue("SYMBOLIC_LIMIT_DIVERGES", `The limit does not exist: ${outcome.reason}.`);
		case "sidesDisagree":
			return errorValue("SYMBOLIC_LIMIT_SIDES_DISAGREE", `The limit does not exist: ${outcome.reason}.`);
		case "unsettled":
			return errorValue("SYMBOLIC_LIMIT_UNSETTLED", `The limit does not exist: ${outcome.reason}.`);
		case "undefined":
			return errorValue("SYMBOLIC_LIMIT_UNDEFINED", `The limit does not exist: ${outcome.reason}.`);
		case "unsupported":
			return errorValue("SYMBOLIC_LIMIT_UNSUPPORTED", `Cannot take this limit: ${outcome.reason}.`);
	}
}
