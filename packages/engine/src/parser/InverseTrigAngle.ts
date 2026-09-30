import type { Token } from "@solve-js/lexer/Token";
import { getMeasure } from "@solve-js/uom/UomConverter";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * Reading an inverse trigonometric function's answer as the angle it is, when
 * a line converts it to an angle unit: `asin(0.5) in degrees` is 30 degrees.
 *
 * `asin`, `acos`, `atan` and `atan2` answer in radians, as a plain number, the
 * convention every calculator and programming language shares. A plain number
 * converted to a unit is given that unit, which is right for `5 in km` and
 * wrong here: `asin(0.5) in degrees` answered `0.52 degrees`, the radians with
 * a degrees label (#829). A conversion to an angle unit whose left side opens
 * with one of these calls now reads the number as radians first, so the
 * conversion converts.
 *
 * The boundary is what the parser can see. The rule looks at the call the left
 * side begins with, so `asin(0.5) * 2 in degrees` (still an angle) converts,
 * while a name holding the answer (`a = asin(0.5)`, then `a in degrees`) is a
 * plain number like any other and is labelled; `asind` and `radtodeg` answer
 * in degrees directly for that case.
 */

/** The inverse trigonometric functions whose plain-number answer is an angle in radians. */
const INVERSE_TRIG_NAMES: ReadonlySet<string> = new Set([
	"asin", "acos", "atan", "atan2", "arcsin", "arccos", "arctan",
]);

/**
 * Whether a conversion should read its left side as radians: the left side
 * opens with an inverse trigonometric call and the target is an angle unit.
 *
 * @param left - The token the left side of the conversion begins with.
 * @param targetUnit - The unit being converted to, as written.
 */
export function readsAsRadians(left: Token | undefined, targetUnit: string): boolean {
	if (left === undefined || left.type !== "FUNC") return false;
	if (!INVERSE_TRIG_NAMES.has(String(left.value).toLowerCase())) return false;
	return getMeasure(targetUnit) === "angle";
}

/**
 * Emits the step that gives the plain number on the stack its unit of
 * radians, so the conversion after it converts rather than labels.
 *
 * @param builder - The builder the conversion is being emitted into.
 */
export function emitRadiansTag(builder: BytecodeBuilder): void {
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString("rad");
	builder.emitOpcode(OpCode.UOM_CONVERT_IN);
}
