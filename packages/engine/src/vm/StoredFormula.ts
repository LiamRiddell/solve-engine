/**
 * Reading a name that holds a formula written before its unknowns had values.
 *
 * A document may define a name from another it has not defined yet:
 * `y = x + 1` above `x = 5`. The assignment keeps `x + 1` as a formula, which
 * is what line 1 shows. When a later line reads `y`, `x` has a value, and the
 * formula is read with it: `y + x` below both lines is 11, as it is when the
 * lines come in the other order. Without this step the formula was read
 * unchanged and met the value of `x` in the same line, so `y + x` gave `x+6`,
 * holding `x` as 5 in one term and as an unknown in the other (#732).
 */

import { Value, ValueType, numberValue, errorValue } from "@solve-js/vm/Value";
import { symbolicToValue } from "@solve-js/vm/SymbolicOps";
import { describeQuantity, nonNumericKind } from "@solve-js/vm/VMConversion";
import { evaluateConstant } from "@solve-js/symbolic/NumericEvaluate";
import { type SymbolicNode, constNode, freeVariables, rationalFromNumber, substituteAll } from "@solve-js/symbolic";

/**
 * How many names deep a formula is followed through other formulas: `y` in
 * `x`, `x` in `z`, and so on. Past it a name is left as an unknown, which is
 * what it was before this reading existed, so a document with a very long
 * chain of formulas defined in reverse costs a bounded walk per read.
 */
export const STORED_FORMULA_MAX_DEPTH = 64;

/** What one name in a formula is read as: an expression to put in its place, a value that ends the read, or nothing (the name stays an unknown). */
type NameReading = { node: SymbolicNode } | { value: Value } | null;

/**
 * A stored value as a line reads it now: a formula with every unknown that has
 * since been given a value replaced by that value.
 *
 * A name bound to a plain finite number is replaced by it. A name bound to
 * another formula is replaced by that formula, itself read the same way, so a
 * chain of names defined in reverse order resolves; a name whose formula
 * mentions itself, or that is met again on its own chain (`y = x + 1`, then
 * `x = y * 2`), stays an unknown, since a circular pair has no value to give. A name with no value stays an unknown. A name that holds
 * something a formula cannot take (money, a quantity in a unit, a date, text)
 * refuses the read by name rather than guessing at a unit the formula never
 * had, and a name holding an error or a pending value passes that value on.
 *
 * @param stored - The value the name holds. Anything but a formula is returned
 * unchanged.
 * @param name - The name being read, for the refusal's wording.
 * @param lookup - The current value of a name, or `undefined` when it has none.
 * @returns A number when every unknown now has one, a formula in the unknowns
 * that remain, or an error Value.
 */
export function resolveStoredFormula(stored: Value, name: string, lookup: (name: string) => Value | undefined): Value {
	if (stored.type !== ValueType.Symbolic) return stored;
	const visiting = new Set<string>([name]);
	const resolved = resolveTree(stored.value as SymbolicNode, name, lookup, visiting, 0);
	if (resolved instanceof Value) return resolved;
	if (resolved === stored.value) return stored;
	const value = symbolicToValue(resolved);
	if (value.type !== ValueType.Symbolic) return value;
	// A tree with no unknown left that the simplifier kept exact (`sin(5)`) is
	// the number it stands for, as `x = 5` then `sin(x)` is. A complex result
	// (`sqrt(-1)` is `i`) has no real value and stays as the simplifier left it.
	const tree = value.value as SymbolicNode;
	if (freeVariables(tree).size > 0) return value;
	const approx = evaluateConstant(tree);
	return approx !== null && Number.isFinite(approx) ? numberValue(approx) : value;
}

/**
 * One formula with its known names put in, or an error Value that ends the read.
 *
 * @param owner - The name the formula belongs to, for a refusal's wording.
 */
function resolveTree(
	tree: SymbolicNode,
	owner: string,
	lookup: (name: string) => Value | undefined,
	visiting: Set<string>,
	depth: number,
): SymbolicNode | Value {
	const replacements = new Map<string, SymbolicNode>();
	for (const free of freeVariables(tree)) {
		if (visiting.has(free)) continue;
		const reading = readName(free, owner, lookup, visiting, depth);
		if (reading === null) continue;
		if ("value" in reading) return reading.value;
		replacements.set(free, reading.node);
	}
	return substituteAll(tree, replacements);
}

/** What one free name of `owner`'s formula reads as, under {@link resolveStoredFormula}'s rules. */
function readName(
	free: string,
	owner: string,
	lookup: (name: string) => Value | undefined,
	visiting: Set<string>,
	depth: number,
): NameReading {
	const bound = lookup(free);
	if (bound === undefined) return null;
	switch (bound.type) {
		case ValueType.Number: {
			const n = bound.toNumber();
			if (!Number.isFinite(n)) {
				return { value: errorValue("SYMBOLIC_NONFINITE_OPERAND", `${owner} is a formula in ${free}, and ${free} is not a finite number, so ${owner} has no value.`) };
			}
			return { node: constNode(rationalFromNumber(n)) };
		}
		case ValueType.Symbolic: {
			if (depth >= STORED_FORMULA_MAX_DEPTH) return null;
			// A formula that mentions its own name (`x = y * 2` stored while `y`
			// was `x + 1`) is circular: it has no value to give, so the name stays.
			if (freeVariables(bound.value as SymbolicNode).has(free)) return null;
			visiting.add(free);
			const inner = resolveTree(bound.value as SymbolicNode, free, lookup, visiting, depth + 1);
			visiting.delete(free);
			return inner instanceof Value ? { value: inner } : { node: inner };
		}
		case ValueType.Error:
		case ValueType.Pending:
			return { value: bound };
		default:
			return { value: formulaCannotTake(owner, free, bound) };
	}
}

/**
 * The refusal for a formula whose unknown now holds something it cannot take.
 *
 * @param owner - The name holding the formula.
 * @param free - The unknown in it that now has a value.
 * @param bound - That value.
 */
export function formulaCannotTake(owner: string, free: string, bound: Value): Value {
	const kind = bound.type === ValueType.Uom && typeof bound.unit === "string" && bound.unit !== ""
		? describeQuantity(bound.unit)
		: bound.type === ValueType.Percentage
			? "a percentage"
			: nonNumericKind(bound) ?? "a value that is not a plain number";
	return errorValue(
		"SYMBOLIC_FORMULA_VALUE_UNSUPPORTED",
		`${owner} was written as a formula in ${free} before ${free} had a value, and ${free} now holds ${kind}, which the formula cannot take. Define ${free} above the line that defines ${owner}.`,
	);
}
