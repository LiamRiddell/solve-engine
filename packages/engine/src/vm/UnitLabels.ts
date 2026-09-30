import { Value, ValueType } from "@solve-js/vm/Value";

/**
 * The index of the builtin that names a quantity for display
 * (`CALL_BUILTIN 116`), emitted by the unit-label parselet after a unit a
 * reader wrote under another name. Not callable by name.
 */
export const UNIT_LABEL_BUILTIN = 116;

/**
 * A quantity shown under the name the reader wrote for its unit (#762).
 *
 * The quantity is unchanged: its number and its own unit stay as they are, so
 * it converts and adds as that unit does, and only {@link Value.unitLabel}
 * is set, on a copy. Anything that is not a quantity, an error included, is
 * handed back as it came, so a conversion that failed keeps its refusal.
 *
 * @param value - What the unit, or the conversion into it, produced.
 * @param name - The word the reader wrote (`Meile`, `sprints`).
 * @param per - How many of the value's own unit one of `name` is; a value that
 *   is not a positive finite number leaves the quantity unlabelled, since no
 *   count could be shown in it.
 * @returns The labelled copy, or `value` itself.
 */
export function labelQuantity(value: Value, name: string, per: number): Value {
	if (value.type !== ValueType.Uom || value.unit === undefined) return value;
	if (name.length === 0 || !Number.isFinite(per) || per <= 0) return value;
	const labelled = value.clone();
	labelled.unitLabel = { name, per };
	return labelled;
}
