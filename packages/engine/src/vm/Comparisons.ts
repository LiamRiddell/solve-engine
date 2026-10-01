import { Value, ValueType, boolValue, errorValue, faultedOperand, type MatrixData } from "@solve-js/vm/Value";
import { compareUom, incomparableUnitsError, compareBigIntOperands, compareRationalOperands, ipEqual, ipv6Order, colourEqual, colourRefused, valueKindName } from "@solve-js/vm/VMConversion";
import { unitListCompare } from "@solve-js/vm/MatrixUnits";
import { bigBaseInteger } from "@solve-js/vm/ExactIntegers";
import { zoneAnswerEqualsText } from "@solve-js/vm/ZoneAnswers";
import { listAgainstOne } from "@solve-js/vm/ListComparison";

/**
 * The six comparison opcodes past their plain-number fast path.
 *
 * Each opcode keeps its two-double compare inline in the dispatch loop, where
 * nearly every comparison ends; everything else, the faulted operand, the
 * exact sidecars, the bigint, the quantity, the list, the address and the
 * colour, is decided here. The four ordering opcodes were four copies of one
 * chain with a different operator, and EQ and NEQ two copies of another, and
 * each type check a batch added (#745, #748) was added six times to
 * `executeBytecode`, which V8 stops optimising past 61,440 bytes of bytecode.
 * One module-level function per family keeps the loop's case to a call.
 *
 * @module Comparisons
 */

/**
 * An ordering operator as the opcodes pass it: 0 for `<`, 1 for `<=`, 2 for
 * `>` and 3 for `>=`. A number rather than an enum, so the call in the
 * dispatch loop loads a constant and nothing else.
 */
export type Order = 0 | 1 | 2 | 3;

/** The cell comparisons a list compare reads, one per operator, built once. */
const ORDER_CELLS: readonly ((a: number, b: number) => boolean)[] = [
	(a, b) => a < b,
	(a, b) => a <= b,
	(a, b) => a > b,
	(a, b) => a >= b,
];
const EQUAL_CELLS = (a: number, b: number): boolean => a === b;
const UNEQUAL_CELLS = (a: number, b: number): boolean => a !== b;

/** One cell of a list beside one value, read by the rule one value follows, one per operator, built once. */
const CELL_ORDERS: readonly ((l: Value, r: Value) => Value)[] = [
	(l, r) => valuesOrdered(l, r, 0),
	(l, r) => valuesOrdered(l, r, 1),
	(l, r) => valuesOrdered(l, r, 2),
	(l, r) => valuesOrdered(l, r, 3),
];
const cellsEqual = (l: Value, r: Value): Value => valuesEqual(l, r, false);
const cellsUnequal = (l: Value, r: Value): Value => valuesEqual(l, r, true);

/**
 * Whether either side carries an exact value to compare on: a fraction or an
 * exact decimal sidecar, or a whole number past 2^53 held by a value written
 * in a base (see bigBaseInteger()). `(2^100 + 1) in hex == (2^100) in hex`
 * compared the two nearest doubles, which are the same.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 */
export function hasExactSide(l: Value, r: Value): boolean {
	return l.rational !== undefined || r.rational !== undefined || l.exact !== undefined || r.exact !== undefined
		|| bigBaseInteger(l) !== null || bigBaseInteger(r) !== null;
}

/**
 * Whether an operator holds between two doubles. A NaN on either side holds
 * for none of them, as the JavaScript operators give.
 *
 * @param op - The operator.
 * @param a - The left number.
 * @param b - The right number.
 */
export function orderHolds(op: Order, a: number, b: number): boolean {
	switch (op) {
		case 0: return a < b;
		case 1: return a <= b;
		case 2: return a > b;
		default: return a >= b;
	}
}

/**
 * Whether an operator holds for an order already decided (-1, 0 or 1), as a
 * bigint, a fraction or an address compare gives it.
 *
 * @param op - The operator.
 * @param order - The order of the left value against the right.
 */
export function orderHoldsFor(op: Order, order: -1 | 0 | 1): boolean {
	return orderHolds(op, order, 0);
}

/**
 * `l == r` (or `l != r` when `negate` is set) for any pair the plain-number
 * fast path passed over. A faulted operand propagates; two IP values compare
 * on their family, address, prefix and zone (see ipEqual()); an exact fraction
 * or decimal compares on its exact value; a bigint digit for digit; two pieces
 * of text as text; two quantities once put in one unit; two lists cell by cell
 * (a list of answers, so NEQ is not EQ negated there), and a list beside one
 * value cell by cell (see vm/ListComparison.ts); two colours on their
 * channels; and a colour or an IP value never equals anything else. Text
 * never equals a value that is not text, however alike the two read (see
 * {@link textAgainstOther}), with one exception: a time-zone answer equals
 * the English text it was answered as before it was a value (see
 * `vm/ZoneAnswers.ts`).
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @param negate - True for `!=`.
 * @returns A boolean Value, a list of them when either side is a list, or the fault.
 */
export function valuesEqual(l: Value, r: Value, negate: boolean): Value {
	const fault = faultedOperand(l, r);
	if (fault) return fault;
	// A time-zone answer was text before it was a value (#757), and a note
	// that compared it with that text keeps its answer.
	const zoneText = zoneAnswerEqualsText(l, r);
	if (zoneText !== null) return boolValue(zoneText !== negate);
	if (textAgainstOther(l, r)) return boolValue(negate);
	// A list beside one value is asked of each cell (see vm/ListComparison.ts).
	if (l.type === ValueType.Matrix || r.type === ValueType.Matrix) {
		const cells = listAgainstOne(l, r, negate ? cellsUnequal : cellsEqual);
		if (cells !== null) return cells;
	}
	const ip = ipEqual(l, r);
	if (ip !== null) return boolValue(ip !== negate);
	if (hasExactSide(l, r)) {
		const cmp = compareRationalOperands(l, r);
		if (cmp !== null) return boolValue((cmp === 0) !== negate);
	}
	let equal: boolean;
	if (l.type === ValueType.Number && r.type === ValueType.Number) {
		// A NaN is unequal to everything, itself included, so `!=` is true for it.
		equal = (l.value as number) === (r.value as number);
	} else if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
		// Comparing through toNumber() rounds a bigint to the nearest double
		// first, so two giants a single digit apart landed on the same double.
		const cmp = compareBigIntOperands(l, r);
		equal = cmp === null ? l.toNumber() === r.toNumber() : cmp === 0;
	} else if (l.type === ValueType.String && r.type === ValueType.String) {
		// Through toNumber() every non-numeric string reads as 0, so `"a" == "b"` answered true.
		equal = (l.value as string) === (r.value as string);
	} else if (l.type === ValueType.Uom && r.type === ValueType.Uom) {
		const { equal: same, sameMeasure } = compareUom(l, r);
		equal = sameMeasure && same;
	} else if (l.type === ValueType.Matrix && r.type === ValueType.Matrix) {
		return unitListCompare(l.value as MatrixData, r.value as MatrixData, negate ? UNEQUAL_CELLS : EQUAL_CELLS);
	} else {
		const colour = colourEqual(l, r);
		equal = colour ?? l.toNumber() === r.toNumber();
	}
	return boolValue(equal !== negate);
}

/**
 * Whether one side is text and the other is not.
 *
 * Text and a number are two kinds of thing even when they read alike, and a
 * comparison read the text through `toNumber()`, so `255 == "255"` was true
 * while `check 255 == "255"` refused the pair, and `"abc" == 0` was true
 * because text that is not a number read as 0. `==` now answers false for
 * such a pair and `!=` true, as it does for a length beside a mass; an order
 * between them is refused (see {@link textOrderRefused}).
 *
 * @param l - The left operand.
 * @param r - The right operand.
 */
export function textAgainstOther(l: Value, r: Value): boolean {
	return (l.type === ValueType.String) !== (r.type === ValueType.String);
}

/** The operators an order comparison is written with, by {@link Order}. */
const ORDER_SYMBOLS: readonly string[] = ["<", "<=", ">", ">="];

/** Text that `as number` reads, decimal or after a base prefix, for the hint a refusal gives. */
const NUMBER_AS_TEXT = /^\s*[-+]?(?:\d[\d,]*(?:\.\d+)?(?:e[-+]?\d+)?|0x[0-9a-f]+|0b[01]+|0o[0-7]+)\s*$/i;

/** The longest piece of text a refusal quotes back. */
const MOST_QUOTED = 40;

/**
 * The refusal for an order (`<`, `<=`, `>`, `>=`) with text on either side.
 *
 * Text has no order a note would mean, and it was read through `toNumber()`:
 * `"5" > 3` was true, `"abc" < 1` was true because the text read as 0, and
 * `"a" < "b"` and `"b" > "a"` were both false. Between two pieces of text the
 * message says they can only be equal or not; between text and a value of
 * another kind it says which side is text, and when the text holds a number
 * it points at `as number`, as a check's refusal does.
 *
 * @param l - The left operand.
 * @param r - The right operand; one of the two is text.
 * @param op - The operator.
 * @returns The `TEXT_COMPARISON` error Value.
 */
export function textOrderRefused(l: Value, r: Value, op: Order): Value {
	const symbol = ORDER_SYMBOLS[op] ?? ">";
	if (l.type === ValueType.String && r.type === ValueType.String) {
		return errorValue("TEXT_COMPARISON", `Text has no order: two pieces of text can only be compared with == or !=, not ${symbol}.`);
	}
	const [text, other] = l.type === ValueType.String ? [l, r] : [r, l];
	const side = l.type === ValueType.String ? "left" : "right";
	const written = String(text.value);
	const quoted = `"${written.length > MOST_QUOTED ? `${written.slice(0, MOST_QUOTED)}...` : written}"`;
	const hint = NUMBER_AS_TEXT.test(written) ? `. To read the text as a number, write ${quoted} as number` : "";
	return errorValue("TEXT_COMPARISON", `${quoted} on the ${side} is text and the other side is ${valueKindName(other)}, so they cannot be put in order${hint}.`);
}

/**
 * `l < r`, `l <= r`, `l > r` or `l >= r` for any pair the plain-number fast
 * path passed over. A faulted operand propagates; two IPv6 addresses order by
 * their 128 bits and one against anything else is refused (see ipv6Order()); a
 * colour has no order and is refused by name (see colourRefused()); an exact
 * fraction or decimal, a bigint, two quantities put in one unit, two lists
 * cell by cell and a list beside one value cell by cell (see
 * vm/ListComparison.ts) each compare on their own terms. Two quantities that share no
 * measure cannot be ordered, and say so.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @param op - The operator.
 * @returns A boolean Value, a list of them when either side is a list, or the refusal.
 */
export function valuesOrdered(l: Value, r: Value, op: Order): Value {
	const fault = faultedOperand(l, r);
	if (fault) return fault;
	if (l.type === ValueType.String || r.type === ValueType.String) return textOrderRefused(l, r, op);
	// A list beside one value is asked of each cell (see vm/ListComparison.ts).
	if (l.type === ValueType.Matrix || r.type === ValueType.Matrix) {
		const cells = listAgainstOne(l, r, CELL_ORDERS[op]);
		if (cells !== null) return cells;
	}
	const ipv6 = ipv6Order(l, r);
	if (ipv6 !== null) return ipv6 instanceof Value ? ipv6 : boolValue(orderHoldsFor(op, ipv6));
	if (l.type === ValueType.Colour || r.type === ValueType.Colour) return colourRefused("put in order");
	if (hasExactSide(l, r)) {
		const cmp = compareRationalOperands(l, r);
		if (cmp !== null) return boolValue(orderHoldsFor(op, cmp));
	}
	if (l.type === ValueType.Number && r.type === ValueType.Number) {
		return boolValue(orderHolds(op, l.value as number, r.value as number));
	}
	if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
		// Digit-exact, for the reason given in valuesEqual().
		const cmp = compareBigIntOperands(l, r);
		return boolValue(cmp === null ? orderHolds(op, l.toNumber(), r.toNumber()) : orderHoldsFor(op, cmp));
	}
	if (l.type === ValueType.Uom && r.type === ValueType.Uom) {
		// `equal` is a tolerance, so a pair EQ calls equal is one `<` and `>`
		// both call false and `<=` and `>=` both call true.
		const { lv, rv, equal, sameMeasure } = compareUom(l, r);
		if (!sameMeasure) return incomparableUnitsError(l, r);
		const strict = op === 0 || op === 2;
		return boolValue(strict ? !equal && orderHolds(op, lv, rv) : equal || orderHolds(op, lv, rv));
	}
	if (l.type === ValueType.Matrix && r.type === ValueType.Matrix) {
		return unitListCompare(l.value as MatrixData, r.value as MatrixData, ORDER_CELLS[op]);
	}
	return boolValue(orderHolds(op, l.toNumber(), r.toNumber()));
}
