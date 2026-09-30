import { Value, ValueType, errorValue, stringValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Named scenarios kept in a note (#744): `scenario bull with growth = 8%,
 * price = $120` declares one, and `line 5 under bull` reads line 5 with its
 * inputs in force.
 *
 * A scenario is a what-if with a name, so it is read as one: the engine finds
 * the declaration among the lines above the asking line and answers what `line
 * 5 with growth = 8%, price = $120` would (see
 * `LineExecutionContext.readScenario`). Every refusal a what-if gives is
 * therefore a scenario's too: a line in the span that sets a `global :name`, a
 * goal seek or another what-if inside the span, live data not yet fetched, an
 * input no line uses.
 */

/** The package-local name the declaration plugin function is registered and emitted under. */
export const SCENARIO_DECLARE_FN_NAME = "scenariodeclare";

/** The package-local name the scenario-read plugin function is registered and emitted under. */
export const SCENARIO_READ_FN_NAME = "scenarioread";

/**
 * `scenario <name> with <overrides>`: the declaration line itself, which
 * answers a summary of the inputs it sets (`bull: growth = 8.00%, price =
 * $120.00`) so the reader sees what the scenario holds. A value that is an
 * error, or still waiting on live data, is reported instead.
 *
 * @param args - The scenario's name, then each override as a name and a value.
 */
export function scenarioDeclareHandler(args: Value[]): Value {
	const name = String(args[0]?.value ?? "");
	const parts: string[] = [];
	for (let i = 1; i + 1 < args.length; i += 2) {
		const input = String(args[i].value);
		const value = args[i + 1];
		if (value.type === ValueType.Error) return value;
		if (value.type === ValueType.Pending) {
			return errorValue("WHAT_IF_INPUT_PENDING", `The value given for ${input} is still waiting on live data, so there is nothing to keep in the scenario yet.`);
		}
		parts.push(`${input} = ${formatValue(value).replace(/^=\s*/, "")}`);
	}
	return stringValue(`${name}: ${parts.join(", ")}`);
}

/**
 * `line N under <name>`: what line N says with scenario `<name>`'s inputs in
 * force, or the error that stops it.
 *
 * @param args - The target line (-1 for a deleted one) and the scenario's name.
 * @param context - The asking line's context, which finds and runs the scenario.
 */
export function scenarioReadHandler(args: Value[], context?: LineExecutionContext): Value {
	const targetLine = args[0].toNumber();
	const name = String(args[1]?.value ?? "");
	if (targetLine === -1) return errorValue("LINE_REFERENCE_DELETED", "This reference pointed at a line that has been deleted");
	if (!context?.readScenario) {
		return errorValue(
			"WHAT_IF_NO_DOCUMENT",
			`A scenario only works inside a document, since it re-runs the lines above the one it names. The single-expression entry point has no document to re-run.`,
		);
	}
	return context.readScenario(name, targetLine);
}
