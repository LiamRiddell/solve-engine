import { Value, ValueType, numberValue, numberValueRational, numberValueUncertain, bigIntValue, uomValue, uomValueExact, matrixValue, errorValue, symbolicValue, percentageValue, isTimecodeUnit, boolValue, type MatrixData, type MatrixEntry, type IpCidrData, type ColourData } from "@solve-js/vm/Value";
import { convertUnit, convertRate, getMeasure, accelerationSize, unitForMessage } from "@solve-js/uom/UomConverter";
import { lookupUnit } from "@solve-js/uom/UnitConversion";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { decimalAdd, decimalSubtract, decimalMultiply, decimalDivide, decimalIsZero, decimalToNumber, decimalFromNumberIfExact, decimalCompare, type DecimalData } from "@solve-js/decimal";
import { sameShape } from "@solve-js/vm/MatrixOps";
import { type SymbolicNode, type Rational, simplifySymbolic, rational, rationalAdd, rationalSub, rationalMul, rationalDiv, rationalToNumber, rationalCompare, isRationalZero, dividesByZero } from "@solve-js/symbolic";
import { valueToSymbolic, symbolicDivisionByZero } from "@solve-js/vm/SymbolicOps";
import { rationalOfExactDecimal, exactDecimalDivide, compareExactDecimals } from "@solve-js/vm/ExactDecimals";
import { exactIntegerOf, bigBaseInteger, exactIntegerValue, exactIntegerArithmetic, exactIntegerRemainder, wholeFromBase } from "@solve-js/vm/ExactIntegers";
import { ErrorFactory, type EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import { combineSources, sourcesOfValues, type ValueSource } from "@solve-js/vm/Provenance";
import { valueInUnit } from "@solve-js/vm/MoneyExact";
import { nearestNames, didYouMeanSentence, NameIndex } from "@solve-js/errors/DidYouMean";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { isKnownUnit } from "@solve-js/lexer/units";

/**
 * The provenance record of the exchange rate an operation between two
 * currencies used, or `undefined` when no rate was involved.
 *
 * {@link unifyUom} reads the right operand in the left's currency, so this asks
 * the exchange for the same pair in the same direction, and the record names
 * the table that actually served it. Two amounts in one currency, or anything
 * that is not two amounts of money, involve no rate and answer `undefined`
 * after at most two comparisons, which is why callers can ask unconditionally
 * on their unit-bearing paths.
 *
 * @param l - The left operand, whose currency the result is read in.
 * @param r - The right operand, converted into the left's currency.
 * @returns The rate's one-record list, or `undefined`.
 */
export function currencyRateSources(l: Value, r: Value): readonly ValueSource[] | undefined {
    if (l.type !== ValueType.Uom || r.type !== ValueType.Uom) return undefined;
    if (l.unit === r.unit || l.unit === undefined || r.unit === undefined) return undefined;
    if (!sharedCurrencyExchange.isCurrency(l.unit) || !sharedCurrencyExchange.isCurrency(r.unit)) return undefined;
    return sharedCurrencyExchange.rateSourcesSync(r.unit, l.unit);
}

/**
 * Unify two Value operands that may carry units of measurement.
 * Returns numeric values in a common unit (or undefined unit if incompatible).
 */
export function unifyUom(l: Value, r: Value): { lv: number; rv: number; unit: string | undefined; sameMeasure: boolean } {
    if (l.type === ValueType.Uom && r.type === ValueType.Uom) {
        if (l.unit === r.unit) {
            return { lv: l.toNumber(), rv: r.toNumber(), unit: l.unit, sameMeasure: true };
        }
        const lMeasure = getMeasure(l.unit!);
        const rMeasure = getMeasure(r.unit!);
        const isCurrency = sharedCurrencyExchange.isCurrency(l.unit!) && sharedCurrencyExchange.isCurrency(r.unit!);

        if (lMeasure && lMeasure === rMeasure) {
            const rvConverted = convertUnit(r.toNumber(), r.unit!, l.unit!);
            return { lv: l.toNumber(), rv: rvConverted, unit: l.unit, sameMeasure: true };
        }
        // Two accelerations have no measure in the tables, but are one quantity
        // in two units: `9.81 m/s^2 + 1 ft/s^2` (#737).
        const lAcceleration = accelerationSize(l.unit!);
        const rAcceleration = accelerationSize(r.unit!);
        if (lAcceleration !== undefined && rAcceleration !== undefined) {
            return { lv: l.toNumber(), rv: (r.toNumber() * rAcceleration) / lAcceleration, unit: l.unit, sameMeasure: true };
        }
        if (isCurrency) {
            const rvConverted = sharedCurrencyExchange.convertSync(r.toNumber(), r.unit!, l.unit!);
            if (rvConverted !== null) {
                return { lv: l.toNumber(), rv: rvConverted, unit: l.unit, sameMeasure: true };
            }
        }
        // Two rates of one kind (two speeds, two densities, two prices per
        // kilogram) have no single measure in the tables either, but one
        // converts into the other: `10 m/s + 36 km/h` is 20 m/s. The same
        // conversion `in` makes, so an addition, a comparison and a total
        // agree with it; two rates that do not convert stay apart.
        if (!isCurrency) {
            const asRate = convertRate(r.toNumber(), r.unit!, l.unit!);
            if (asRate !== null) {
                return { lv: l.toNumber(), rv: asRate, unit: l.unit, sameMeasure: true };
            }
        }
        return { lv: l.toNumber(), rv: r.toNumber(), unit: undefined, sameMeasure: false };
    }
    if (l.type === ValueType.Uom) {
        return { lv: l.toNumber(), rv: r.toNumber(), unit: l.unit, sameMeasure: true };
    }
    if (r.type === ValueType.Uom) {
        return { lv: l.toNumber(), rv: r.toNumber(), unit: r.unit, sameMeasure: true };
    }
    return { lv: l.toNumber(), rv: r.toNumber(), unit: undefined, sameMeasure: true };
}

/**
 * The kinds of value with no numeric reading an aggregate could use, named the
 * way a reader would name them.
 *
 * Each of these reads as a number only by accident: text through `parseFloat`,
 * which makes `"Travel"` 0; a date as its epoch milliseconds; a bracketed list,
 * a colour or an unknown as 0. An aggregate that took those readings answered
 * `total of "Travel"` with 0 and `average of 1:3` (a clock time) with a
 * thirteen-digit number, and neither is an answer to the question.
 */
const NON_NUMERIC_KINDS: Partial<Record<ValueType, string>> = {
    [ValueType.String]: "text",
    [ValueType.Datetime]: "a date or time",
    [ValueType.Matrix]: "a bracketed list",
    [ValueType.Range]: "a range",
    [ValueType.Colour]: "a colour",
    [ValueType.IpCidr]: "an IP address",
    [ValueType.Chart]: "a chart",
    [ValueType.Split]: "a split",
    [ValueType.Symbolic]: "an unknown",
};

/**
 * How a reader would name a value with no numeric reading ("text", "a
 * bracketed list"), or undefined when the value reads as a number honestly.
 * The same set {@link nonNumericOperand} refuses in an aggregate, for the other
 * places that must not take the accidental reading or that word their own
 * refusal: a conversion, a list cell, a section total that names the line.
 *
 * @param v - The value to name.
 */
export function nonNumericKind(v: Value): string | undefined {
    return NON_NUMERIC_KINDS[v.type];
}

/**
 * How a reader would name any value, for a refusal that says what it was given
 * instead ("expects two dates, but got a number and a number"): the words of
 * {@link nonNumericKind}, and for the numeric kinds "a number", "an amount in
 * m", "a percentage" or "true or false". It replaces the internal type names
 * (`Number`, `Uom`) such refusals used to print, which the reader never wrote.
 *
 * @param v - The value to name.
 * @returns A short phrase with its article, never an internal name.
 */
export function valueKindName(v: Value): string {
    const kind = NON_NUMERIC_KINDS[v.type];
    if (kind !== undefined) return kind;
    switch (v.type) {
        case ValueType.Number:
        case ValueType.Hex:
            return "a number";
        case ValueType.BigInt:
            return "a whole number";
        case ValueType.Percentage:
            return "a percentage";
        case ValueType.Uom:
            return v.unit === undefined ? "a number" : `an amount in ${v.unit}`;
        case ValueType.Boolean:
            return "true or false";
        case ValueType.Pending:
            return "a value still loading";
        case ValueType.Error:
            return "an error";
        default:
            return "a value of another kind";
    }
}

/**
 * Refuses an aggregate's operand that has no numeric reading, or null when
 * every operand has one.
 *
 * Numbers, quantities, percentages, booleans (1 and 0), hex and big integers
 * pass. Everything in {@link NON_NUMERIC_KINDS} is refused by name, with a
 * pointer to what was probably meant: a quoted name is not a set of lines, and
 * a bracketed list is one value rather than several.
 *
 * @param values - The aggregate's operands.
 * @param verb - What the aggregate does, completing "cannot be ...", e.g. "added".
 */
export function nonNumericOperand(values: readonly Value[], verb: string): Value | null {
    for (const v of values) {
        const kind = NON_NUMERIC_KINDS[v.type];
        if (kind === undefined) continue;
        // A quoted name in a total or an average is most likely a section the
        // reader wanted to add up: the lines under a heading of that name, or
        // the lines carrying a tag.
        const opener = verb === "added" ? "total" : verb === "averaged" ? "average" : undefined;
        const hint = v.type === ValueType.String && opener !== undefined
            ? ` To gather the lines under a heading, write ${opener} of section "${String(v.value)}"; to gather tagged lines, use "${opener} of #tag".`
            : v.type === ValueType.Matrix
                ? ` List the values with commas instead, as in "total of 1, 2, 3".`
                : "";
        return errorValue(
            "AGGREGATE_NON_NUMERIC",
            `${kind[0].toUpperCase()}${kind.slice(1)} cannot be ${verb}: only numbers and quantities can.${hint}`,
        );
    }
    return null;
}

/**
 * The magnitudes of a list of values, read in one unit so they can be added.
 *
 * The unit is the first one written, and everything after it converts into
 * that: `total of 1.2 km, 3 km, 800 m` is `5.00 km` because the list opened in
 * kilometres. A value with no unit contributes its bare magnitude, which is
 * what a list mixing a count into a column of quantities has always done.
 *
 * Returned as `{ magnitudes, unit }`, or as an Error value when two of the
 * values measure different things, since there is no unit both can be read in
 * and adding the magnitudes would answer confidently and wrongly. The sentence
 * names the two dimensions the way the ordering opcodes and `min`/`max` do. A
 * value with no numeric reading at all (text, a date, a bracketed list) is
 * refused the same way; see {@link nonNumericOperand}.
 *
 * `sources` is every provenance record the values carry, plus the record of
 * any exchange rate used to read one currency in another, so an aggregate
 * built from rate-dependent lines can say it is rate-dependent too. Undefined
 * when nothing in the list came from a live figure.
 */
export function unifyQuantities(values: readonly Value[], verb: string): { magnitudes: number[]; unit: string | undefined; sources: readonly ValueSource[] | undefined } | Value {
    const nonNumeric = nonNumericOperand(values, verb);
    if (nonNumeric) return nonNumeric;
    const magnitudes: number[] = new Array(values.length);
    let sources = sourcesOfValues(values);
    let anchor: Value | undefined;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v.type !== ValueType.Uom || v.unit === undefined) {
            magnitudes[i] = v.toNumber();
            continue;
        }
        if (anchor === undefined) {
            anchor = v;
            magnitudes[i] = v.toNumber();
            continue;
        }
        // unifyUom always reads the right operand in the left's unit, so
        // anchoring on the first value written is what makes its unit the
        // answer's unit.
        const { rv, sameMeasure } = unifyUom(anchor, v);
        if (!sameMeasure) {
            const named = describeMeasureMismatch(anchor.unit, v.unit, verb);
            return errorValue(
                "INCOMPATIBLE_UNITS",
                named ?? `Cannot combine incompatible units: ${anchor.unit ?? "?"} and ${v.unit ?? "?"}`,
            );
        }
        magnitudes[i] = rv;
        const rate = currencyRateSources(anchor, v);
        if (rate !== undefined) sources = combineSources(sources, rate);
    }
    return { magnitudes, unit: anchor?.unit, sources };
}

/** A kind ("a bracketed list") at the start of a sentence ("A bracketed list"). */
function sentenceCase(kind: string): string {
    return `${kind[0].toUpperCase()}${kind.slice(1)}`;
}

/**
 * The refusal for a value with no single amount written with a unit or
 * converted into one, or null when it has one.
 *
 * A list read as the zero `toNumber()` reports for it and came back labelled
 * with the unit: `[1, 2] in km` answered `0.00 km` until #547, and `[1, 2, 3]
 * km` and `$[4, 5]`, which give the unit straight after the list, went on doing
 * it until #640. Both spellings are refused with the one sentence.
 *
 * @param v - The value given the unit.
 * @param unit - The unit, for the message.
 * @returns The `CONVERT_NON_NUMERIC` error Value, or null.
 */
export function noSingleAmount(v: Value, unit: string): Value | null {
    const kind = nonNumericKind(v);
    if (kind === undefined) return null;
    return errorValue(
        "CONVERT_NON_NUMERIC",
        `${sentenceCase(kind)} has no single amount to convert to ${unit}: only a number or a quantity can be converted.`,
    );
}

/**
 * The refusal for a value carrying a tolerance given a unit or converted into
 * one (#639).
 *
 * A tolerance is read without the unit of the value it is on, as the
 * uncertainty page documents: `5 m +/- 1 cm` is the plain `5 ± 0.01`. So by the
 * time `in mm` runs there is no unit to convert from, and `(5 m +/- 1 cm) in mm`
 * labelled the bare 5 as 5.00 mm, a thousandth of the length, with the spread
 * gone too. The engine cannot tell a centre whose unit was dropped from one that
 * never had one, so `(5 +/- 0.1) in km` is refused the same way.
 *
 * @param unit - The unit asked for, for the message.
 * @returns The `UNCERTAINTY_WITHOUT_UNIT` error Value.
 */
export function toleranceHasNoUnit(unit: string): Value {
    return errorValue(
        "UNCERTAINTY_WITHOUT_UNIT",
        `A value with a tolerance cannot be converted to ${unit}: a tolerance is read without its unit, so 5 m +/- 1 cm is the plain 5 ± 0.01. Convert the value first and give the tolerance after, as in (5 m in mm) +/- 10.`,
    );
}

/**
 * The refusal for a value carrying a tolerance meeting a quantity in `+`, `-`,
 * `*` or `/` (#639).
 *
 * The tolerance is on a plain number (see {@link toleranceHasNoUnit}), and the
 * quadrature rules in {@link uncertainOp} take only plain numbers, so the pair
 * fell through to the unit arithmetic, which gave the number the quantity's
 * unit and discarded the spread: `(5 m +/- 1 cm) + 2 m` answered 7.00 m.
 *
 * @param unit - The quantity's unit.
 * @param op - The operation, for the message.
 * @returns The `UNCERTAINTY_WITHOUT_UNIT` error Value.
 */
export function toleranceMeetsQuantity(unit: string, op: "add" | "sub" | "mul" | "div"): Value {
    return errorValue(
        "UNCERTAINTY_WITHOUT_UNIT",
        `A value with a tolerance and a quantity in ${unit} cannot be ${combineVerb(op)}: a tolerance is read without its unit, so 5 m +/- 1 cm is the plain 5 ± 0.01, and the two are not in the same terms. Keep both sides plain numbers, as in (5 +/- 0.01) + 2.`,
    );
}

/**
 * The refusal for a physical constant whose unit the engine cannot spell yet
 * meeting another unit, or null when `v` is not one (#648).
 *
 * `planck` is joule-seconds and `elementary charge` is coulombs, and the engine
 * has no spelling for either, so each is a plain number (see
 * `Value.unspelledUnit`). A plain number takes the unit of whatever quantity it
 * meets, so `planck * 5e14 Hz` answered in hertz and `planck in J` in joules,
 * each a confident label for the wrong measure.
 *
 * @param v - The operand that may be such a constant.
 * @param unit - The unit it would be given, for the message.
 * @param op - The arithmetic, or undefined for a conversion.
 * @returns The `CONSTANT_UNIT_UNSUPPORTED` error Value, or null.
 */
export function unspelledUnitRefused(v: Value, unit: string, op?: "add" | "sub" | "mul" | "div"): Value | null {
    const own = v.unspelledUnit;
    if (own === undefined) return null;
    return errorValue(
        "CONSTANT_UNIT_UNSUPPORTED",
        op === undefined
            ? `A constant measured in ${own} cannot be converted to ${unit}: the engine cannot spell ${own} yet, so the constant is a plain number.`
            : `A constant measured in ${own} and a quantity in ${unit} cannot be ${combineVerb(op)}: the engine cannot spell ${own} yet, so the answer would wrongly be in ${unit}. Leave the unit off the other side and read the result in the unit it should have.`,
    );
}

/**
 * The refusal for arithmetic between a quantity and an operand that cannot be
 * put in its terms, or null when there is nothing to refuse.
 *
 * Two kinds of operand are refused. A value with no single amount (a list, a
 * range, a colour) read as the zero `toNumber()` reports and took the
 * quantity's unit: `[1, 2] * 1 km` answered `0.00 km` and `[1, 2] + 1 km`
 * answered `1.00 km` (#640). A physical constant in a unit the engine cannot
 * spell took the other operand's unit (#648, see {@link unspelledUnitRefused}).
 * Called from `binaryOp` and ahead of the multiply and divide helpers in the VM,
 * so every path a quantity can meet one of these asks it first.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @param op - The operation, for the message; a remainder passes none.
 * @returns The error Value, or null.
 */
export function quantityOperandRefused(l: Value, r: Value, op?: "add" | "sub" | "mul" | "div"): Value | null {
    const leftQuantity = l.type === ValueType.Uom;
    if (leftQuantity === (r.type === ValueType.Uom)) return null;
    const quantity = leftQuantity ? l : r;
    const other = leftQuantity ? r : l;
    const unit = quantity.unit ?? "?";
    // An unknown is a formula, which the symbolic arithmetic handles before any
    // unit is looked at, and text and a date have refusals of their own
    // (TEXT_ARITHMETIC, INVALID_DATETIME_OP) that say more than this one can.
    const kind = other.type === ValueType.Symbolic || other.type === ValueType.String || other.type === ValueType.Datetime
        ? undefined
        : nonNumericKind(other);
    if (kind !== undefined) {
        return errorValue(
            "QUANTITY_NON_NUMERIC",
            `${sentenceCase(kind)} and a quantity in ${unit} cannot be ${combineVerb(op)}: ${kind} has no single amount to put in ${unit}.`,
        );
    }
    return op === undefined ? null : unspelledUnitRefused(other, unit, op);
}

/**
 * Whether two unit spellings are one unit: the same text, or two aliases of one
 * table entry (`km` and `kilometres`, `°C` and `C`).
 *
 * @param a - One spelling.
 * @param b - The other.
 */
export function sameUnit(a: string, b: string): boolean {
    if (a === b) return true;
    const entry = lookupUnit(a);
    return entry !== undefined && entry === lookupUnit(b);
}

/** Every unit spelling, indexed once on first use for a "did you mean". */
let unitNames: NameIndex | null = null;

/**
 * Every unit spelling as a {@link NameIndex}, built once on first use, which is
 * what a "did you mean" searches when a unit or a variable is not found.
 *
 * @returns The shared index.
 */
export function unitNameIndex(): NameIndex {
    return unitNames ??= new NameIndex(Object.keys(UNIT_TABLE));
}

/** The unit spellings a reader can type after a number, indexed once on first use. */
let typeableUnitNames: NameIndex | null = null;

/**
 * The unit spellings the lexer reads as a unit, as a {@link NameIndex}: what a
 * "did you mean" searches when a word typed in an expression is not defined.
 *
 * The full table is the right index for a conversion target, where a word
 * such as `points` is read as a unit however the lexer treats it. In place of
 * a name it is not: `turn` and `turns` are both in the table and both left
 * out of the vocabulary as ordinary English (see lexer/units.ts), so `1 turn`
 * suggested `turns`, which fails the same way, and `1 turns` suggested `turn`
 * (#825). A spelling the lexer does not claim is never offered here.
 *
 * @returns The shared index.
 */
export function typeableUnitNameIndex(): NameIndex {
    return typeableUnitNames ??= new NameIndex(Object.keys(UNIT_TABLE).filter(isKnownUnit));
}

/**
 * The refusal for a word that is not a unit where one was asked for: `"banana"
 * is not a unit.`, with the nearest real units named when there are any.
 *
 * Converting from a unit, the suggestions that measure what it measures are the
 * ones named, when there are any: `5 km in mies` offers `miles` and not
 * `mins`, which is as close a spelling but a time (#666).
 *
 * @param unit - The word, as written.
 * @param from - The unit being converted from, when there is one.
 * @returns The `UNKNOWN_UNIT` error Value.
 */
export function unknownUnitError(unit: string, from?: string): Value {
    let near = nearestNames(unit, [], 3, unitNameIndex());
    const measure = from === undefined ? undefined : getMeasure(from);
    if (measure !== undefined) {
        const alike = near.filter((name) => getMeasure(name) === measure);
        if (alike.length > 0) near = alike;
    }
    return errorValue("UNKNOWN_UNIT", `"${unit}" is not a unit.${didYouMeanSentence(near)}`);
}

/**
 * Whether a target names a unit the engine can give a number: a unit in the
 * tables (an extended one such as `furlong` included), a currency, a count of
 * video frames or a timecode, or a rate of such units (`km/h`, `$/kWh`). Case
 * matters, as it does everywhere in the unit system, so `KM` is not a unit.
 *
 * @param unit - The target, as written.
 */
export function namesAUnit(unit: string): boolean {
    // Read into a boolean first: the guard narrows `unit` to never on its false branch.
    const timecode: boolean = isTimecodeUnit(unit);
    if (timecode || describeMeasure(unit) !== undefined || unit === "frames") return true;
    if (!unit.includes("/")) return false;
    const parts = unit.split("/");
    for (let i = 0; i < parts.length; i++) {
        // A rate with no numerator (`/s`) is the reciprocal of its denominator.
        if (i === 0 && parts[i] === "") continue;
        if (describeMeasure(parts[i]) === undefined) return false;
    }
    return true;
}

/**
 * A value that is not a quantity converted into a unit with `in` or `to`: the
 * last branch of `UOM_CONVERT_IN`, after a quantity, a date and a percentage
 * have been taken.
 *
 * A number is given the unit, which is what `5 in km` has always done. Refused
 * by name instead: a value with no single amount (#547, see
 * {@link noSingleAmount}); a value carrying a tolerance, which has lost the unit
 * it had (#639, see {@link toleranceHasNoUnit}); a constant in a unit the engine
 * cannot spell (#648); and a word that is not a unit at all, which labelled the
 * number with it: `5 in widgets` answered `5.00 widgets` and `2024 in roman`
 * `2,024.00 roman` (#646). The last is the refusal a quantity already had
 * (`5 km in banana`).
 *
 * @param v - The value, already checked for a fault.
 * @param unit - The target unit.
 * @returns The value in that unit, or an error Value.
 */
export function plainValueInUnit(v: Value, unit: string): Value {
    return noSingleAmount(v, unit)
        ?? (v.uncertainty !== undefined ? toleranceHasNoUnit(unit) : null)
        ?? unspelledUnitRefused(v, unit)
        ?? (namesAUnit(unit) ? uomValue(v.toNumber(), unit) : unknownUnitError(unit));
}

/**
 * A unit written straight after a value (`UOM_CONVERT`): `5 km`, `$[4, 5]`.
 *
 * The value becomes a quantity in the unit (see `valueInUnit`), except for
 * the values {@link plainValueInUnit} refuses for the same reasons: one with no
 * single amount (`[1, 2, 3] km` was `0.00 km`, #640), one carrying a tolerance
 * (#639) and a constant in a unit the engine cannot spell (#648). An unknown
 * (a formula) is let through unchanged, as it always was: the symbolic forms
 * are outside this change. The unit itself is not checked here: the lexer
 * produced it as a unit.
 *
 * @param v - The value, already checked for a fault, a second unit and a date.
 * @param unit - The unit written after it.
 * @returns The quantity, or an error Value.
 */
export function unitAfterValue(v: Value, unit: string): Value {
    return (v.type === ValueType.Symbolic ? null : noSingleAmount(v, unit))
        ?? (v.uncertainty !== undefined ? toleranceHasNoUnit(unit) : null)
        ?? unspelledUnitRefused(v, unit)
        ?? valueInUnit(v, unit);
}

/**
 * How close two unified magnitudes have to be before a comparison calls them
 * the same number, as a fraction of the magnitudes that produced them.
 *
 * A conversion is arithmetic, and arithmetic rounds. Converting 32 fahrenheit
 * to celsius gives 5.684e-14 rather than the exact zero the two scales are
 * defined to share, because the offset arithmetic runs in binary floating
 * point and five ninths has no finite binary expansion. Comparing that with
 * `===` made `0 C == 32 F` answer false, and with it every other equality that
 * has to cross a temperature scale.
 *
 * 1e-12 sits roughly four decimal digits above the last bit of a double, which
 * is wide enough for the rounding any conversion in the table introduces and
 * far narrower than the gap between two numbers a person meant to be
 * different: at the scale of the 32 in the example above it admits a
 * difference of 3.2e-11, and a user who writes two temperatures apart writes
 * them further apart than that.
 */
const UNIFIED_COMPARISON_TOLERANCE = 1e-12;

/** The largest of three magnitudes, ignoring any that is not finite. */
function largestFiniteMagnitude(a: number, b: number, c: number): number {
    let scale = 0;
    if (Number.isFinite(a) && Math.abs(a) > scale) scale = Math.abs(a);
    if (Number.isFinite(b) && Math.abs(b) > scale) scale = Math.abs(b);
    if (Number.isFinite(c) && Math.abs(c) > scale) scale = Math.abs(c);
    return scale;
}

/**
 * Compare two operands that carry units, in a unit each of them can be read
 * in.
 *
 * Returns the two magnitudes in a common unit plus the two facts a comparison
 * opcode needs that it cannot recover from those magnitudes alone: whether the
 * units share a measure at all, and whether the magnitudes are equal once the
 * conversion's own rounding is allowed for.
 *
 * The tolerance is measured against the ORIGINAL operand magnitudes as well as
 * the converted ones. A converted value sitting near zero has no magnitude of
 * its own to scale against, which is exactly the `0 C == 32 F` case, and yet
 * the arithmetic that produced its rounding worked on numbers the size of the
 * inputs, so those are what the error has to be judged against.
 *
 * NaN is equal to nothing, itself included, which is what makes `0/0 == 0/0`
 * answer false; it falls out of the finiteness check rather than needing its
 * own branch.
 */
export function compareUom(l: Value, r: Value): { lv: number; rv: number; equal: boolean; sameMeasure: boolean } {
    const { lv, rv, sameMeasure } = unifyUom(l, r);
    if (!sameMeasure) return { lv, rv, equal: false, sameMeasure: false };
    // Same-currency money compares on its exact decimals, so "$0.1 + $0.2 ==
    // $0.3" is true on the value rather than on whichever doubles the two sides
    // happen to land on. The returned lv/rv (already the nearest doubles) order
    // the same way, since rounding to nearest is monotonic.
    if (
        l.type === ValueType.Uom && r.type === ValueType.Uom &&
        l.unit !== undefined && l.unit === r.unit &&
        l.exact !== undefined && r.exact !== undefined &&
        sharedCurrencyExchange.isCurrency(l.unit)
    ) {
        return { lv, rv, equal: decimalCompare(l.exact, r.exact) === 0, sameMeasure: true };
    }
    if (lv === rv) return { lv, rv, equal: true, sameMeasure: true };
    if (!Number.isFinite(lv) || !Number.isFinite(rv)) return { lv, rv, equal: false, sameMeasure: true };
    const scale = largestFiniteMagnitude(lv, rv, r.toNumber());
    return { lv, rv, equal: Math.abs(lv - rv) <= scale * UNIFIED_COMPARISON_TOLERANCE, sameMeasure: true };
}

/**
 * The dimension nouns that do not read as their measure-kind name. A quantity
 * of `time` reads as a duration in a sentence ("a duration cannot be converted
 * to a length"), and the measure tables key every two-word kind as one camelCase
 * token (`fuelEconomy`, `dataRate`), which is an identifier rather than a word:
 * "fuelEconomy and length cannot be multiplied" (#571). Every other kind
 * (length, mass, area, ...) already reads as the noun, so it is used unchanged,
 * and a kind added later without an entry here is split into words by
 * {@link measureNoun} rather than printed as its key.
 */
const MEASURE_NOUNS: Readonly<Record<string, string>> = {
    time: "duration",
    luminousIntensity: "luminous intensity",
    dataRate: "data rate",
    cssLength: "CSS length",
    fuelEconomy: "fuel economy",
    fuelConsumption: "fuel consumption",
    volumeFlowRate: "volume flow rate",
    partsPer: "proportion",
    apparentPower: "apparent power",
    reactivePower: "reactive power",
    reactiveEnergy: "reactive energy",
};

/**
 * The noun for a measure kind: its entry in {@link MEASURE_NOUNS}, or the key
 * split into lowercase words, so no key ever reaches a sentence as written.
 */
function measureNoun(measure: string): string {
    return MEASURE_NOUNS[measure] ?? measure.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/**
 * The dimensions that are uncountable, so they take no indefinite article in
 * the conversion sentence: "money", not "a money".
 */
const UNCOUNTABLE_MEASURES: ReadonlySet<string> = new Set(["money", "data", "fuel consumption"]);

/** The past participle each combining op reads as in the mismatch sentence. */
const COMBINE_VERBS: Readonly<Record<string, string>> = {
    add: "added",
    sub: "subtracted",
    mul: "multiplied",
    div: "divided",
};

/**
 * Name the dimension a unit measures, as a noun a message can drop into a
 * sentence: `kg` gives "mass", `hour` gives "duration", `USD` gives "money".
 *
 * Returns undefined when the unit has no single dimension to name (a compound
 * rate such as "km/h", or a currency code the exchange does not recognise), so
 * a caller can fall back to naming the raw unit rather than printing
 * "undefined".
 */
export function describeMeasure(unit: string): string | undefined {
    // Currencies are not in the measure table (getMeasure returns undefined for
    // them), so they are named here before the table lookup.
    if (sharedCurrencyExchange.isCurrency(unit)) return "money";
    // Nor is acceleration, which has a dimension but no measure (uom/Dimensions.ts);
    // unnamed, its internal spelling `mps2` reached the reader (#590).
    // A length over a squared time (`ft/s²`) is one too (#737).
    if (accelerationSize(unit) !== undefined) return "acceleration";
    const measure = getMeasure(unit);
    if (measure === undefined) return undefined;
    return measureNoun(measure);
}

/**
 * A dimension noun with the indefinite article that reads correctly: "a
 * length", "an area", and the uncountable dimensions ("money") left bare.
 */
function withMeasureArticle(noun: string): string {
    if (UNCOUNTABLE_MEASURES.has(noun)) return noun;
    return /^[aeiou]/.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/**
 * What a quantity in `unit` is, with its article, for a sentence that names
 * it ("not a length", "not money"), or "a quantity in <unit>" for a unit with
 * no single dimension to name (a compound rate).
 */
export function describeQuantity(unit: string): string {
    const noun = describeMeasure(unit);
    return noun === undefined ? `a quantity in ${unit}` : withMeasureArticle(noun);
}

/**
 * The mismatch sentence naming the two differing dimensions of a refused
 * `+`/`-`/`*` or comparison: "mass and length cannot be added".
 *
 * Returns undefined when there is no pair of differing dimensions to name: an
 * unknown or compound unit on either side, or two currencies (both money, the
 * missing-rate case rather than a dimension mismatch). The caller then keeps
 * its own fallback, which names the units instead.
 *
 * @param verb - the past participle for the sentence ("added", "compared").
 */
export function describeMeasureMismatch(
    lUnit: string | undefined,
    rUnit: string | undefined,
    verb: string,
): string | undefined {
    const left = lUnit === undefined ? undefined : describeMeasure(lUnit);
    const right = rUnit === undefined ? undefined : describeMeasure(rUnit);
    if (left !== undefined && right !== undefined && left !== right) {
        return `${left} and ${right} cannot be ${verb}`;
    }
    return undefined;
}

/**
 * The past participle for a combining opcode's mismatch sentence. MOD passes no
 * op kind (see {@link binaryOp}), and reads as the neutral "combined".
 */
export function combineVerb(op: string | undefined): string {
    return op !== undefined ? (COMBINE_VERBS[op] ?? "combined") : "combined";
}

/**
 * The mismatch sentence for a conversion the engine cannot make: "a duration
 * cannot be converted to a length".
 *
 * Returns undefined when either side has no dimension to name (a compound rate,
 * or a currency code the exchange does not know), so the caller keeps its own
 * fallback that names the two units instead.
 */
export function describeConversionMismatch(fromUnit: string, toUnit: string): string | undefined {
    const from = describeMeasure(fromUnit);
    const to = describeMeasure(toUnit);
    if (from !== undefined && to !== undefined && from !== to) {
        return `${withMeasureArticle(from)} cannot be converted to ${withMeasureArticle(to)}`;
    }
    return undefined;
}

/**
 * The answer an ordered comparison gives when the two quantities share no
 * measure.
 *
 * `<` between a mass and a length is not false, it is a question with no
 * answer, and answering it with a boolean drawn from the bare magnitudes is
 * the same confidently-wrong shape `binaryOp` refuses below for `+`. Equality
 * is the exception and stays a boolean: a kilogram genuinely is not a metre,
 * so `==` can say false and mean it.
 *
 * The two dimensions are named where both are known and differ ("mass and
 * length cannot be compared"), falling back to naming the units when they are
 * not (see {@link describeMeasureMismatch}).
 */
export function incomparableUnitsError(l: Value, r: Value): Value {
    const lUnit = l.type === ValueType.Uom ? l.unit : undefined;
    const rUnit = r.type === ValueType.Uom ? r.unit : undefined;
    const named = describeMeasureMismatch(lUnit, rUnit, "compared");
    return errorValue("INCOMPATIBLE_UNITS", named ?? `Cannot compare incompatible units: ${lUnit ?? "?"} and ${rUnit ?? "?"}`);
}

/**
 * Read an operand as a bigint without rounding it through a double first.
 *
 * An already-BigInt operand hands over its raw bigint, and so does a Number
 * carrying an exact whole number past 2^53 (`3^40`), whose double is only the
 * nearest one: read through `toNumber()`, `3^40 - 12157665459056928801n`
 * answered -33 (#583). Anything else converts via `toNumber()`, which is
 * lossless because a value that was only ever a double has no extra precision
 * to lose. Going through `toNumber()`
 * unconditionally is what made every bitwise operator, every comparison and
 * `^` destroy the digits that are the whole point of the type, e.g.
 * `12345678901234567891n & 1n` answered 0 because the left operand became
 * 12345678901234567168 on the way in.
 *
 * @throws A recoverable `BIGINT_INEXACT_OPERAND` execution error for an operand
 * with no whole-number form. This used to be a raw `RangeError` straight out of
 * `BigInt()`, which the VM's outer catch relabelled UNEXPECTED_ERROR/INTERNAL:
 * `1n + 0.5`, `1n & 1.5`, `1n << 1.5`, `5n/pi` and `e/8n` all reported an engine
 * bug for what is a typo in the line. The same shape `vm/VMBuiltinArity.ts` was
 * written to fix for `sqrt()`.
 */
export function toBigIntOperand(v: Value): bigint {
    if (v.type === ValueType.BigInt) return v.value as bigint;
    // A value written in a base past 2^53 holds its bigint: `(2^100 + 1) in
    // hex + 1n` read the nearest double and answered 2^100 + 1.
    const inBase = bigBaseInteger(v);
    if (inBase !== null) return inBase;
    const exact = exactIntegerOf(v, false);
    if (exact !== null) return exact;
    const n = v.toNumber();
    if (!Number.isInteger(n)) {
        // Covers NaN and both infinities as well as fractions, all of which
        // `BigInt()` refuses and none of which has a whole-number form.
        const shown = Number.isNaN(n) ? "NaN" : String(n);
        throw ErrorFactory.execution(
            "BIGINT_INEXACT_OPERAND",
            `A whole-number (n) value can only be combined with another whole number, and ${shown} is not one`,
            { operand: shown },
        );
    }
    return BigInt(n);
}

/**
 * What `10n / 0n` and `10n mod 0n` answer.
 *
 * DECIDED, and deliberately NOT the same as `1 / 0`, which is Infinity here.
 * The two numeric types already disagree about division and always did:
 * `7n / 2n` is 3n and `7 / 2` is 3.5, because a bigint division is exact
 * integer division. Every language that has both draws the line in the same
 * place, C, Java, Python and JavaScript's own BigInt included: integer division
 * by zero raises, IEEE-754 division by zero is an infinity. So this is not the
 * two types disagreeing about zero, it is the one difference between them
 * showing up at zero as well as everywhere else, and an infinity is not
 * something exact integer arithmetic has to hand back.
 *
 * What was actually wrong was the reporting, not the decision.
 * `__tests__/hardening/ArithmeticBigInt.spec.ts` already asserted this and its
 * comment already explained it, but nothing implemented it: the test passed
 * because V8's own `RangeError` happens to say "Division by zero", and the VM
 * relabelled that raw exception UNEXPECTED_ERROR/INTERNAL. So a user dividing
 * by zero was told the ENGINE had failed. Now it is the engine's own error,
 * with a code a host can branch on.
 *
 * @returns The error for the caller's `bigOp` to throw.
 */
export function bigIntDivisionByZero(): EngineError {
    return ErrorFactory.execution(
        "BIGINT_DIVISION_BY_ZERO",
        "Division by zero: a whole-number (n) division is exact integer division, which has no answer at zero, unlike 1 / 0 which is Infinity",
    );
}

/**
 * Three-way comparison of two operands, at least one of which is a BigInt,
 * with every digit intact.
 *
 * @returns -1, 0 or 1, or `null` when an operand has no exact bigint image (a
 * fraction, an infinity, a NaN). On null the caller keeps its ordinary double
 * comparison, which is the correct answer for a fractional operand and the
 * only available one for a non-finite operand.
 */
export function compareBigIntOperands(l: Value, r: Value): -1 | 0 | 1 | null {
    const lb = exactBigInt(l);
    const rb = exactBigInt(r);
    if (lb === null || rb === null) return null;
    if (lb < rb) return -1;
    if (lb > rb) return 1;
    return 0;
}

/** An operand's exact bigint image, or null when it has none: an exact whole number past 2^53 gives its own digits, not its double's. */
function exactBigInt(v: Value): bigint | null {
    if (v.type === ValueType.BigInt) return v.value as bigint;
    const exact = exactIntegerOf(v, false);
    if (exact !== null) return exact;
    const n = v.toNumber();
    // Rules out Infinity and NaN as well as fractions.
    return Number.isInteger(n) ? BigInt(n) : null;
}

/**
 * `base` raised to `exponent`, in doubles.
 *
 * DECIDED (1.0.0, differential run 20260811): where ECMAScript and C99/IEEE 754
 * disagree about `pow`, this engine follows C99.
 *
 * They disagree in exactly one family of cases, a base of exactly ±1 with an
 * exponent that is not a finite number. ECMAScript's `**` answers NaN for
 * `1 ** Infinity` and `1 ** NaN`, on the reasoning that 1^infinity is an
 * indeterminate FORM in the calculus of limits. C99 (F.9.4.4), IEEE 754's
 * `pow`, Python and Ruby all answer 1, on the reasoning that this is not a
 * limit: the base here is the number one, not something approaching it, and one
 * multiplied by itself any number of times is one.
 *
 * `1^2^3^4^5` is what made the choice matter. `^` groups right, so that tower
 * is 1^(2^(3^(4^5))); the inner tower overflows a double to Infinity, and the
 * outermost step is 1^Infinity. Under ECMAScript's rule the answer is NaN, so
 * an expression whose every base is 1 answers "not a number", and the reason is
 * a rounding artefact three levels down rather than anything about the
 * question. Under C99's rule it is 1, which is also what it is under exact
 * arithmetic, which settles it: the release that exists to stop the engine
 * answering confidently from an artefact should not itself do that.
 *
 * `NaN ^ 0` is 1 under both rules and needs no branch here.
 */
export function power(base: number, exponent: number): number {
    // The overwhelmingly common case, and the one both standards agree on.
    if (Number.isFinite(exponent)) return Math.pow(base, exponent);
    // pow(1, y) is 1 for every y, a NaN exponent included.
    if (base === 1) return 1;
    // pow(-1, +-infinity) is 1 as well, but pow(-1, NaN) is NaN: C99 extends
    // the rule to a NaN exponent only for the base +1.
    if (base === -1 && !Number.isNaN(exponent)) return 1;
    return Math.pow(base, exponent);
}

/**
 * The exact decimal an operand contributes to a money operation, or null.
 *
 * A currency operand hands over the sidecar its literal or a prior exact result
 * set. A plain scalar (the `3` in `$1.10 * 3`, the `1.10` in `$0.70 * 1.10`)
 * hands over its own exact decimal: a whole number always has one, and a
 * decimal-point literal or an exact decimal result carries one too, which is
 * what lets a fractional multiplier stay exact against money, as the same
 * multiplier stays exact between plain numbers. A fractional double with no sidecar (a
 * `sqrt` result) has no exact decimal and returns null, dropping that operation
 * back to the float path.
 */
function operandExactDecimal(v: Value): DecimalData | null {
    if (v.exact !== undefined) return v.exact;
    return decimalFromNumberIfExact(v.toNumber());
}

/**
 * The exact result of a money arithmetic op, or null when it cannot be exact.
 *
 * Exactness is preserved only when the currency stays put: two amounts in the
 * same currency, or a currency against a plain scalar. A cross-currency
 * combination goes through an exchange rate, which is a double, so it is left
 * to the float path below rather than dressed up as exact. Division falls back
 * for a zero divisor so "$10 / 0" keeps the double's Infinity, and for two
 * currencies (a ratio the VM computes before this is ever reached).
 */
function exactMoneyOp(l: Value, r: Value, op: "add" | "sub" | "mul" | "div"): Value | null {
    const lMoney = l.type === ValueType.Uom && l.unit !== undefined && l.exact !== undefined && sharedCurrencyExchange.isCurrency(l.unit);
    const rMoney = r.type === ValueType.Uom && r.unit !== undefined && r.exact !== undefined && sharedCurrencyExchange.isCurrency(r.unit);
    if (!lMoney && !rMoney) return null;

    let ld: DecimalData | null;
    let rd: DecimalData | null;
    let unit: string;
    if (lMoney && rMoney) {
        // Different currencies reconcile through a rate, which is a double, so
        // only a shared currency stays exact. A ratio (money / money) is the
        // VM's own DIV case and never arrives here.
        if (l.unit !== r.unit || op === "div") return null;
        ld = l.exact!; rd = r.exact!; unit = l.unit!;
    } else if (lMoney && r.type !== ValueType.Uom) {
        // The other side must be a plain scalar. A different-unit Uom ("$100 +
        // 5 kg") is NOT a scalar, and must fall through to the float path so it
        // surfaces the incompatible-units error rather than absorbing the 5 as
        // though it were dollars.
        ld = l.exact!; unit = l.unit!;
        rd = operandExactDecimal(r);
    } else if (rMoney && l.type !== ValueType.Uom) {
        rd = r.exact!; unit = r.unit!;
        ld = operandExactDecimal(l);
    } else {
        return null;
    }
    if (ld === null || rd === null) return null;

    let result: DecimalData;
    switch (op) {
        case "add": result = decimalAdd(ld, rd); break;
        case "sub": result = decimalSubtract(ld, rd); break;
        case "mul": result = decimalMultiply(ld, rd); break;
        case "div":
            if (decimalIsZero(rd)) return null;
            result = decimalDivide(ld, rd);
            break;
    }
    return uomValueExact(decimalToNumber(result), unit, result);
}

/**
 * The exact rational an operand contributes to a fraction operation, or null.
 *
 * A value that already carries a `rational` sidecar hands it over. A plain
 * whole number (the "14" in "2/7 * 14", the "3" in "1/3 * 3") has the exact
 * rational n/1, and a plain number carrying an exact decimal has the fraction
 * that decimal is (0.1 is 1/10), so "1/3 + 0.1" is exactly 13/30 and a fraction
 * compares with a decimal on their values. Everything else has none: a
 * non-integer double with no sidecar (a `sqrt` result) returns null so the
 * operation drops to the float path, money keeps its currency by never
 * converting here, and a bigint returns null so "100n / 3n" stays exact INTEGER
 * division (33n) rather than becoming the fraction 100/3. NaN and the
 * infinities fail the integer test and return null with everything else.
 */
function operandRational(v: Value): Rational | null {
    if (v.rational !== undefined) return v.rational;
    // The exact decimal before the double: past 2^53 the literal
    // 9007199254740993.5 is the whole double 9007199254740994, and reading that
    // whole number first made it equal to 9007199254740994.
    if (v.exact !== undefined) return rationalOfExactDecimal(v);
    if ((v.type === ValueType.Number || v.type === ValueType.Hex) && typeof v.value === "number" && Number.isInteger(v.value)) {
        return rational(BigInt(v.value));
    }
    // A value written in a base past 2^53 holds its whole number as a bigint
    // (see bigBaseInteger()), so `(2^100 + 1) in hex > 2^100` compares it.
    const inBase = bigBaseInteger(v);
    if (inBase !== null) return rational(inBase);
    return null;
}

/**
 * The exact rational result of a fraction operation, or null when it has none.
 *
 * DIV is the producer: "1/3" is two whole numbers, so both operands have a
 * rational image and the quotient 1/3 seeds the sidecar the rest of the system
 * propagates. ADD/SUB/MUL only ever preserve, their call sites reach here only
 * when a `rational` sidecar already rides on an operand, so plain integer sums
 * like "1e16 + 1 - 1e16" never grow one and stay the doubles they must be.
 *
 * The double is recomputed from the reduced result rather than from the operand
 * doubles, which is the whole point: "1/6" six times over is exactly 1, not the
 * 0.9999999999999999 the doubles accumulate to.
 *
 * Returns null (dropping to the float path) rather than throwing when a
 * fraction cannot stay exact: a zero divisor keeps "1/0" as the double Infinity
 * the float path gives, and a value past the rational magnitude ceiling keeps
 * the doubles' answer rather than surfacing a fraction-overflow error for
 * ordinary arithmetic.
 */
export function exactRationalOp(l: Value, r: Value, op: "add" | "sub" | "mul" | "div"): Value | null {
    const lr = operandRational(l);
    if (lr === null) return null;
    const rr = operandRational(r);
    if (rr === null) return null;
    if (op === "div" && isRationalZero(rr)) return null;
    let result: Rational;
    try {
        switch (op) {
            case "add": result = rationalAdd(lr, rr); break;
            case "sub": result = rationalSub(lr, rr); break;
            case "mul": result = rationalMul(lr, rr); break;
            case "div": result = rationalDiv(lr, rr); break;
        }
    } catch {
        // Past RATIONAL_MAX_BITS the rational ops throw. The float answer is
        // always available and always valid, so fall back to it rather than
        // fail a line that only happened to build a very large fraction.
        return null;
    }
    // A result past a double's range keeps the double path's infinity rather
    // than an exact value riding on one, the rule vm/ExactIntegers.ts keeps for
    // whole numbers: `2^1000 * 2^30` is Infinity, as `2^1030` is.
    const approx = rationalToNumber(result);
    if (!Number.isFinite(approx)) return null;
    return numberValueRational(approx, result);
}

/**
 * The exact quotient of two values, or null: the decimal quotient where both
 * are plain numbers and either carries an exact decimal (see
 * vm/ExactDecimals.ts's `exactDecimalDivide`: exact where it terminates, the
 * exact fraction where it does not), and otherwise the fraction division
 * seeds or keeps (see {@link exactRationalOp}). The VM's `/` makes one call
 * here from its plain case and one from its general arm, so its dispatch loop
 * does not grow, and a plain number that reaches the general arm only because
 * it carries its sources (see vm/Provenance.ts) is divided as the plain case
 * divides it. A fraction, a measurement, a currency amount or a number in
 * another base keeps the fraction path it had.
 *
 * @param l - The dividend.
 * @param r - The divisor.
 * @returns The exact quotient, or null to keep the double.
 */
export function exactQuotient(l: Value, r: Value): Value | null {
    if ((l.exact !== undefined || r.exact !== undefined) && isPlainNumber(l) && isPlainNumber(r)) return exactDecimalDivide(l, r);
    return exactRationalOp(l, r, "div");
}

/** A Number carrying neither a fraction nor an uncertainty, the operand the decimal quotient is for. */
function isPlainNumber(v: Value): boolean {
    return v.type === ValueType.Number && v.rational === undefined && v.uncertainty === undefined;
}

/**
 * The spread a `center ± spread` measurement carries, as a magnitude in the
 * center's own terms, or the Error that refuses it.
 *
 * The spread used to be read as a bare number whatever it was written as, which
 * gave two confident wrong answers. `100 ± 5%` became `100 ± 0.05`, because a
 * percentage reads as its proportion; and `5 m ± 1 cm` became `5 ± 1`, a spread
 * a hundred times too wide, because both units were dropped before either was
 * converted. So:
 *
 * - A percentage is a tolerance relative to the value, `100 ± 5%` is `100 ± 5`,
 *   the way a component's "± 5%" is read. On a center that is itself a
 *   percentage it stays absolute, in percentage points, so a poll's
 *   `45% ± 3%` is 0.45 ± 0.03 as it always was.
 * - A spread with a unit is converted into the center's unit first, as an
 *   interval rather than a reading: `convert(s) - convert(0)`, so a tolerance of
 *   1 °F on a Celsius value is 0.56 °C wide, not the -17.2 °C that converting
 *   1 °F as a temperature gives. A unit the center's cannot convert to, or a
 *   center with no unit at all to convert into, is refused by name rather than
 *   having the spread's unit silently discarded.
 * - A plain number is taken as it is, in whatever unit the center is in.
 *
 * The center's own unit is still dropped afterwards, as the uncertainty page
 * documents: carrying units through the quadrature rules is out of scope.
 */
export function toleranceSpread(center: Value, spread: Value): number | Value {
    // An IPv6 address or a colour has no amount to measure a tolerance
    // against; its toNumber() gave NaN or 0 for the centre.
    const opaque = hasNoNumber(center) ? center : hasNoNumber(spread) ? spread : null;
    if (opaque !== null) return noNumberRefused(opaque, "given a tolerance")!;
    if (spread.type === ValueType.Percentage) {
        const proportion = Math.abs(spread.toNumber());
        return center.type === ValueType.Percentage ? proportion : Math.abs(center.toNumber()) * proportion;
    }
    if (spread.type !== ValueType.Uom || spread.unit === undefined) return Math.abs(spread.toNumber());

    const width = Math.abs(spread.toNumber());
    if (center.type !== ValueType.Uom || center.unit === undefined) {
        return errorValue(
            "UNCERTAINTY_UNIT_MISMATCH",
            `A tolerance in ${spread.unit} needs a value measured in a unit it converts to, as in "5 m +/- 1 cm"; this value has no unit to read it in.`,
        );
    }
    if (center.unit === spread.unit) return width;
    if (sharedCurrencyExchange.isCurrency(center.unit) && sharedCurrencyExchange.isCurrency(spread.unit)) {
        const converted = sharedCurrencyExchange.convertSync(width, spread.unit, center.unit);
        if (converted !== null) return Math.abs(converted);
        return errorValue(
            "UNCERTAINTY_UNIT_MISMATCH",
            `A tolerance in ${spread.unit} cannot be read against a value in ${center.unit} without an exchange rate, and none is available.`,
        );
    }
    const measure = getMeasure(center.unit);
    if (measure === undefined || measure !== getMeasure(spread.unit)) {
        return errorValue(
            "UNCERTAINTY_UNIT_MISMATCH",
            `A tolerance in ${spread.unit} cannot be read against a value in ${center.unit}: they do not measure the same thing.`,
        );
    }
    return Math.abs(convertUnit(width, spread.unit, center.unit) - convertUnit(0, spread.unit, center.unit));
}

/**
 * The result of a `+`/`-`/`*`/`/` between operands, at least one of which
 * carries a one-sigma uncertainty, propagated in quadrature. Null when it does
 * not apply.
 *
 * Independent errors combine in quadrature, the common case the feature scopes
 * itself to (correlated terms are a much larger problem and out of scope). The
 * center follows the ordinary arithmetic; the spread follows the standard
 * first-order rules:
 *   add/sub: sigma = sqrt(sigma_a^2 + sigma_b^2)
 *   mul:     sigma = sqrt((b*sigma_a)^2 + (a*sigma_b)^2)
 *   div:     sigma = sqrt((sigma_a/b)^2 + (a*sigma_b/b^2)^2)
 * The mul/div forms are the partial-derivative version of the relative-error
 * rule sigma = |result| * sqrt((sigma_a/a)^2 + (sigma_b/b)^2), algebraically the
 * same but without dividing by a center that may be zero. A plain number is
 * read as an exact operand (uncertainty 0), which is what makes a scalar
 * multiply `(a ± s) * k` come out as `s * |k|`.
 *
 * Returns null unless both operands are plain Numbers, so a matrix or any other
 * typed operand keeps its own path (and drops the uncertainty, as a comparison
 * or a transcendental function does). A quantity is the exception: an uncertain
 * number meeting one is refused (see {@link toleranceMeetsQuantity}), since the
 * unit arithmetic it fell through to gave the number the quantity's unit and
 * discarded the spread (#639). The VM gates the call on an uncertainty actually
 * being present, so a plain `2 * 3` never reaches here.
 */
export function uncertainOp(l: Value, r: Value, op: "add" | "sub" | "mul" | "div"): Value | null {
    if (l.type === ValueType.Uom && r.uncertainty !== undefined) return toleranceMeetsQuantity(l.unit ?? "?", op);
    if (r.type === ValueType.Uom && l.uncertainty !== undefined) return toleranceMeetsQuantity(r.unit ?? "?", op);
    if (l.type !== ValueType.Number || r.type !== ValueType.Number) return null;
    const a = l.value as number;
    const b = r.value as number;
    const sa = l.uncertainty ?? 0;
    const sb = r.uncertainty ?? 0;
    let center: number;
    let sigma: number;
    switch (op) {
        case "add": center = a + b; sigma = Math.hypot(sa, sb); break;
        case "sub": center = a - b; sigma = Math.hypot(sa, sb); break;
        case "mul": center = a * b; sigma = Math.hypot(b * sa, a * sb); break;
        case "div": center = a / b; sigma = Math.hypot(sa / b, (a * sb) / (b * b)); break;
    }
    return numberValueUncertain(center, sigma);
}

/**
 * Three-way comparison of two operands as exact fractions, or null.
 *
 * Mirrors {@link compareBigIntOperands}: when a rational rides on either side
 * the comparison is decided on the fractions rather than on whichever doubles
 * they rounded to, so "1/49 * 49 == 1" is true and two distinct fractions that
 * share a nearest double still compare unequal. Returns null when either side
 * has no rational image, leaving the caller's ordinary double comparison in
 * place. The call sites gate on a rational or an exact decimal actually being
 * present first, so a plain "1 < 2" never reaches here.
 *
 * Where neither side carries a fraction the comparison is on the exact
 * decimals instead (see vm/ExactDecimals.ts's `compareExactDecimals`), so
 * "0.1 + 0.2 == 0.3" is decided on 0.3 against 0.3, and two decimals that share
 * a nearest double still compare on their digits.
 */
export function compareRationalOperands(l: Value, r: Value): -1 | 0 | 1 | null {
    if (l.rational === undefined && r.rational === undefined && bigBaseInteger(l) === null && bigBaseInteger(r) === null) return compareExactDecimals(l, r);
    const lr = operandRational(l);
    if (lr === null) return null;
    const rr = operandRational(r);
    if (rr === null) return null;
    return rationalCompare(lr, rr);
}

/**
 * Whether a value is an IPv6 address or block (issue #748). An IPv6 address is
 * an IP value holding a 128-bit address, which no double holds exactly, so the
 * paths that read a number refuse it by name rather than read the NaN its
 * `toNumber()` reports.
 *
 * @param v - The value.
 */
export function isIpv6Value(v: Value): boolean {
    return v.type === ValueType.IpCidr && (v.value as IpCidrData).addr6 !== undefined;
}

/**
 * The refusal for an IPv6 address where a number is wanted: arithmetic, a
 * numeric function, a comparison with a number, a conversion with no
 * whole-number reading. The message points at `as int`, which gives the
 * address as its exact 128-bit whole number.
 *
 * @param done - What was asked of it, as the end of "cannot be ...": "added", "rounded".
 * @returns The `IPV6_ARITHMETIC` error Value.
 */
export function ipv6Refused(done: string): Value {
    return errorValue(
        "IPV6_ARITHMETIC",
        `An IPv6 address cannot be ${done}: its 128 bits are more than a number holds exactly. For the address as one whole number, write "as int".`,
    );
}

/**
 * An IPv6 address as its whole number: a plain number while a double holds it
 * exactly (`::1` is 1), a bigint past that, so no bit is rounded away.
 *
 * @param v - An IPv6 value (see {@link isIpv6Value}).
 */
export function ipv6WholeNumber(v: Value): Value {
    const addr = (v.value as IpCidrData).addr6 ?? 0n;
    return addr <= BigInt(Number.MAX_SAFE_INTEGER) ? numberValue(Number(addr)) : bigIntValue(addr);
}

/**
 * The refusal for arithmetic with an IPv6 address on either side, or null when
 * neither is one.
 *
 * @param op - The operation, for the message; a remainder passes none.
 */
export function ipv6ArithmeticRefused(l: Value, r: Value, op?: "add" | "sub" | "mul" | "div"): Value | null {
    if (!isIpv6Value(l) && !isIpv6Value(r)) return null;
    const done = op === "add" ? "added" : op === "sub" ? "subtracted" : op === "mul" ? "multiplied" : op === "div" ? "divided" : "used in this arithmetic";
    return ipv6Refused(done);
}

/**
 * Whether two values are equal when either is an IPv6 address, or null when
 * neither is. Two IPv6 values are equal when their address, prefix and zone all
 * are, so `2001:db8::1 == 2001:0db8:0:0:0:0:0:1` is true however each is
 * written; an IPv6 address never equals anything else, as a colour never
 * equals a number.
 */
export function ipv6Equal(l: Value, r: Value): boolean | null {
    if (!isIpv6Value(l) && !isIpv6Value(r)) return null;
    if (!isIpv6Value(l) || !isIpv6Value(r)) return false;
    const a = l.value as IpCidrData, b = r.value as IpCidrData;
    return a.addr6 === b.addr6 && a.prefix === b.prefix && a.zone === b.zone;
}

/**
 * The order of two IPv6 addresses by their 128-bit values (-1, 0 or 1), a
 * refusal when only one side is IPv6, or null when neither is. An address
 * compares by its bits alone, so a prefix or a zone does not break a tie.
 */
export function ipv6Order(l: Value, r: Value): -1 | 0 | 1 | Value | null {
    const left = isIpv6Value(l), right = isIpv6Value(r);
    if (!left && !right) return null;
    if (!left || !right) return ipv6Refused("compared with a number");
    const a = (l.value as IpCidrData).addr6!, b = (r.value as IpCidrData).addr6!;
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * {@link ipv6Order} as the answer to one comparison operator: the boolean, the
 * refusal, or null when neither side is IPv6.
 *
 * @param holds - Whether the operator holds for an order of -1, 0 or 1.
 */
export function ipv6Comparison(l: Value, r: Value, holds: (order: -1 | 0 | 1) => boolean): Value | null {
    const order = ipv6Order(l, r);
    if (order === null) return null;
    return order instanceof Value ? order : boolValue(holds(order));
}

/**
 * The refusal for a colour where a number is wanted: arithmetic, a numeric
 * function, an order, a conversion to a form of a number.
 *
 * A colour is three channels and an alpha, and its `toNumber()` reports 0, so
 * every path that read a number from it answered as though it were zero:
 * `#ff0000 + 2` was 2, `sqrt(#ff0000)` was 0 and `#ff0000 < 3` was true. The
 * colour functions (`lighten`, `mix`, `red`) are what give a colour meaning,
 * and the message points at reading one channel out as a number.
 *
 * @param done - What was asked of it, as the end of "cannot be ...": "added", "given to sqrt".
 * @returns The `COLOUR_ARITHMETIC` error Value.
 */
export function colourRefused(done: string): Value {
    return errorValue(
        "COLOUR_ARITHMETIC",
        `A colour cannot be ${done}: it is three channels (red, green and blue), not one number. To use one channel as a number, read it out first, as in red(#3366cc).`,
    );
}

/**
 * Whether a value has no numeric reading at all and must be refused by name
 * wherever a number is wanted: an IPv6 address (128 bits, see
 * {@link isIpv6Value}) or a colour (three channels, see {@link colourRefused}).
 * Text, a date and a list have refusals of their own, worded for each.
 *
 * @param v - The value.
 */
export function hasNoNumber(v: Value): boolean {
    return v.type === ValueType.Colour || isIpv6Value(v);
}

/**
 * The refusal for a value with no numeric reading, in its own words, or null
 * when `v` has one (see {@link hasNoNumber}).
 *
 * @param v - The value.
 * @param done - What was asked of it, as the end of "cannot be ...".
 */
export function noNumberRefused(v: Value, done: string): Value | null {
    if (v.type === ValueType.Colour) return colourRefused(done);
    return isIpv6Value(v) ? ipv6Refused(done) : null;
}

/**
 * The refusal for arithmetic with a value that has no numeric reading on
 * either side (an IPv6 address or a colour), or null when neither is one. The
 * left operand is named first, matching left-to-right evaluation.
 *
 * @param op - The operation, for the message; a remainder, a power and the bitwise operators pass none.
 */
export function noNumberArithmeticRefused(l: Value, r: Value, op?: "add" | "sub" | "mul" | "div"): Value | null {
    const opaque = hasNoNumber(l) ? l : hasNoNumber(r) ? r : null;
    if (opaque === null) return null;
    const done = op === "add" ? "added" : op === "sub" ? "subtracted" : op === "mul" ? "multiplied" : op === "div" ? "divided" : "used in this arithmetic";
    return noNumberRefused(opaque, done);
}

/**
 * Whether two values are equal when either is an IP address or block, of
 * either family, or null when neither is. Two IP values are equal when their
 * family, address, prefix and zone all are, so `192.168.1.0/24` and
 * `192.168.1.0/25` differ as `2001:db8::/32` and `2001:db8::/48` do. An IP
 * value never equals anything else, as a colour never equals a number: an
 * IPv4 address read as its 32-bit number made `192.168.1.1 == 3232235777` true
 * and the prefix of a block vanish.
 */
export function ipEqual(l: Value, r: Value): boolean | null {
    const left = l.type === ValueType.IpCidr, right = r.type === ValueType.IpCidr;
    if (!left && !right) return null;
    if (!left || !right) return false;
    const a = l.value as IpCidrData, b = r.value as IpCidrData;
    return a.addr === b.addr && a.addr6 === b.addr6 && a.prefix === b.prefix && a.zone === b.zone;
}

/**
 * Whether two values are equal when either is a colour, or null when neither
 * is. A colour equals only another colour with the same channels, however each
 * was written (`#ff0000 == rgb(255, 0, 0)`), and never a number, since its
 * `toNumber()` of 0 made `#000000 == 0` true.
 */
export function colourEqual(l: Value, r: Value): boolean | null {
    const left = l.type === ValueType.Colour, right = r.type === ValueType.Colour;
    if (!left && !right) return null;
    if (!left || !right) return false;
    const a = l.value as ColourData, b = r.value as ColourData;
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

/**
 * The refusal for a date or time in arithmetic that has no meaning for one:
 * multiplying, dividing, a remainder, a power, a negation.
 *
 * A date or time is a moment, not an amount, and it is held as its epoch
 * milliseconds, so reading it as a number gave answers like 5,370,888,600,000
 * for `1:30 * 3`. The message points at the lengths of time the engine reads,
 * since a reader who writes `1:30 * 3` most likely meant ninety minutes.
 *
 * @param op - The operation, for the message; a remainder or a power passes none.
 * @returns The `INVALID_DATETIME_OP` error Value.
 */
export function datetimeArithmeticRefused(op?: "add" | "sub" | "mul" | "div" | "neg"): Value {
    const done = op === "mul" ? "multiplied" : op === "div" ? "divided" : op === "neg" ? "negated" : "used in this arithmetic";
    return errorValue(
        "INVALID_DATETIME_OP",
        `A date or time cannot be ${done}: it is a moment, not an amount. A length of time is written 1h30m, 90 minutes or 1:30:00.`,
    );
}

/**
 * The refusal for a unit written after a date or time: `1:30 hours` read half
 * past one today as 1,790,296,200,000 hours, and `1:30 hours in minutes` went
 * on to convert it. A clock time names a moment, not a length, so it takes no
 * unit, and the message points at the spellings of a length of time.
 *
 * @param unit - The unit written after it, for the message.
 * @returns The `INVALID_DATETIME_OP` error Value.
 */
export function datetimeTakesNoUnit(unit: string): Value {
    return errorValue(
        "INVALID_DATETIME_OP",
        `A date or time cannot take a unit, ${unit}: it is a moment, not an amount. A length of time is written 1h30m, 90 minutes or 1:30:00.`,
    );
}

/**
 * The refusal for a date or time converted to a form of a number that has no
 * reading for it, or null when `v` is not one: `1 Jan 2026 as %` answered
 * 176722560000000.00%. `as number` and `to timestamp` stay, since they ask
 * for the number, and the message points at them.
 *
 * @param v - The value being converted.
 * @param target - The form, for the message ("a percentage").
 * @returns The `INVALID_DATETIME_OP` error Value, or null.
 */
export function datetimeConversionRefused(v: Value, target: string): Value | null {
    if (v.type !== ValueType.Datetime) return null;
    return errorValue(
        "INVALID_DATETIME_OP",
        `A date or time cannot be written as ${target}: it is a moment, not an amount. For its number, write "as number", or "to timestamp" for seconds since 1970.`,
    );
}

/**
 * Whether a unit is on the parts-per scale (ppm, ppb, ppt, permille), the scale
 * a percentage belongs to: 1% is 0.01, 1 permille 0.001 and 1 ppm 0.000001.
 *
 * @param unit - The unit.
 */
export function isPartsPerUnit(unit: string | undefined): boolean {
    return unit !== undefined && getMeasure(unit) === "partsPer";
}

/**
 * The fraction a parts-per quantity names: 100 ppm is 0.0001, 2 permille 0.002.
 *
 * @param value - A quantity whose unit {@link isPartsPerUnit} accepts.
 */
export function partsPerFraction(value: Value): number {
    return convertUnit(value.toNumber(), value.unit!, "ppm") / 1e6;
}

/**
 * A value written as a percentage (TO_PERCENTAGE: `as %`, `in %`, `to %`,
 * `as percent`, and the percentage forms that end in one).
 *
 * A percentage is a point on the parts-per scale (#633), so a parts-per
 * quantity becomes the fraction it names: `100 ppm as %` is 0.01%, where it
 * read the 100 as whole ones and answered 10000.00%. A quantity that is not a
 * proportion (a length, money) has no percentage and is refused, where
 * `5 km as %` answered 500.00%. A number or a ratio is its own fraction, as
 * before; one whose percentage, a hundred times it, cannot be held is refused
 * with the reason it cannot (see {@link percentageRefusal}).
 *
 * @param value - The value, already checked for a fault and a date.
 * @returns The Percentage, or an error Value.
 */
export function toPercentage(value: Value): Value {
    if (value.type === ValueType.Uom && value.unit !== undefined) {
        if (isPartsPerUnit(value.unit)) {
            // A parts-per figure past the largest double converts to an
            // infinite fraction (1e308 permille is 1e311 ppm), though the
            // quantity typed is finite: too large, not a division by zero.
            const fraction = partsPerFraction(value);
            return Number.isFinite(fraction * 100) ? percentageValue(fraction) : percentageTooLarge();
        }
        const what = describeQuantity(value.unit);
        return errorValue(
            "PERCENTAGE_OF_QUANTITY",
            `${what[0].toUpperCase()}${what.slice(1)} is not a proportion, so it has no percentage: only a number, a ratio or a parts-per quantity (ppm, permille) can be written as one.`,
        );
    }
    const fraction = value.toNumber();
    // One multiplication: the percentage is what the formatter writes, and a
    // fraction past about 1.8e306 is finite while a hundred times it is not.
    if (!Number.isFinite(fraction * 100)) return percentageRefusal(value, fraction);
    const percentage = percentageValue(fraction);
    const exact = percentageExact(value);
    if (exact !== undefined) percentage.exact = exact;
    return percentage;
}

/**
 * The places of a percentage a double must be able to hold before a percentage
 * goes without its exact decimal: six, four more than a percentage shows by
 * default, so a host that asks for more places than that still sees exact
 * digits well before the double's run out.
 */
const PERCENTAGE_EXACT_PLACES = 6;

/**
 * The exact decimal a percentage keeps beside its double, or undefined: the
 * exact fraction of a plain number (its exact decimal, or its exact whole
 * number) wherever the double of the percentage cannot hold
 * {@link PERCENTAGE_EXACT_PLACES} places.
 *
 * Past 2^53 a double holds no fraction, so `9007199254740993.5 as percent`
 * showed the double's digits, 900,719,925,474,099,456.00%, though the number
 * kept its exact decimal. The percentage now keeps it too, and the formatter
 * writes the digits from it (see `formatPercentage`), as it does for a plain
 * number. The sidecar is the fraction the percentage stands for, the same
 * value its double holds, so an operation that reads it reads the same number.
 *
 * The boundary: below that magnitude the double already writes the right
 * digits, so a percentage there carries nothing new and every operation on it
 * is unchanged; a quantity (`100 ppm`) and a value with no exact reading (a
 * fraction such as `1/3`, a `sqrt` result) keep their double, since there are
 * no exact digits to show.
 *
 * @param value - The number being written as a percentage.
 * @returns The exact fraction, or undefined.
 */
export function percentageExact(value: Value): DecimalData | undefined {
    if (value.type !== ValueType.Number) return undefined;
    const fraction = value.value as number;
    if (!Number.isFinite(fraction) || Math.abs(fraction * 100) * Number.EPSILON < 0.5 * 10 ** -PERCENTAGE_EXACT_PLACES) return undefined;
    if (value.exact !== undefined) return value.exact;
    const r = value.rational;
    return r !== undefined && r.d === 1n ? { coef: r.n, scale: 0 } : undefined;
}

/**
 * A value converted to a parts-per unit, or null when the conversion is not one
 * this reads: `0.5% in ppm` is 5,000 ppm, where the percentage's bare fraction
 * was labelled with the unit and answered 0.005 ppm (#633).
 *
 * @param value - The value being converted.
 * @param toUnit - The target unit.
 */
export function percentageInPartsPer(value: Value, toUnit: string): Value | null {
    if (value.type !== ValueType.Percentage || !isPartsPerUnit(toUnit)) return null;
    return uomValue(convertUnit(value.toNumber() * 1e6, "ppm", toUnit), toUnit);
}

/**
 * The rate a parts-per quantity names, as a percentage, for `of` (AS_RATE): so
 * `2 permille of $5000` is $10.00, as `0.2% of $5000` is, where the magnitude
 * 2 multiplied the money and answered $10,000.00 (#633). Anything else is
 * returned as it is, so `*` and every other `of` are unchanged.
 *
 * @param value - The rate written before `of`.
 */
export function asRate(value: Value): Value {
    if (value.type === ValueType.Uom && isPartsPerUnit(value.unit)) return percentageValue(partsPerFraction(value));
    return value;
}

/**
 * The refusal for a value whose percentage, a hundred times it, a double
 * cannot hold, with the reason it cannot, in the reader's terms:
 *
 * - NaN, a value that is no number (`(1/0 - 1/0) as %`): not finite, and
 *   named as no number ({@link percentageOfNoNumber}).
 * - An infinity a division by zero gave (`1/0 as %`, `40 is what % of 0`,
 *   marked by the VM's `/`; see `Value.divisionByZero`): not finite, and
 *   named as what dividing by zero gives ({@link percentageNotFinite}).
 * - Any other infinity (`2^2000 as %`, `1e309 as %`): a number that grew past
 *   the largest double, so too large ({@link percentageInfinite}). It used to
 *   be told that it "is what dividing by zero gives", which it is not.
 * - A finite value, or one with a finite exact reading (`1e308 as %`,
 *   `2n^2000 as %`): too large for its percentage ({@link percentageTooLarge}).
 *
 * The double cannot say why it is infinite, so the mark is the only witness:
 * an infinity reached from a division by zero through a step that does not
 * carry it (a function such as `abs`) is called too large.
 *
 * @param value - The value being written as a percentage.
 * @param fraction - Its number, already found to overflow a hundred times over.
 * @returns The error Value.
 */
export function percentageRefusal(value: Value, fraction: number): Value {
    if (fraction !== fraction) return percentageOfNoNumber();
    if (Number.isFinite(fraction) || hasFiniteExactReading(value)) return percentageTooLarge();
    return value.divisionByZero === true ? percentageNotFinite() : percentageInfinite();
}

/**
 * The refusal for a percentage of an infinity a division by zero gave: `40 is
 * what % of 0` divided by zero and printed Infinity% (#636). A percentage is a
 * proportion, and an infinite one names none, so it is refused rather than
 * printed with a percent sign.
 *
 * @returns The `PERCENTAGE_NOT_FINITE` error Value.
 */
export function percentageNotFinite(): Value {
    return errorValue(
        "PERCENTAGE_NOT_FINITE",
        "This has no percentage: its value is not a finite number, which is what dividing by zero gives.",
    );
}

/**
 * The refusal for a percentage of a value that is no number at all (NaN), as
 * an infinity less an infinity is: `0 / 0 as %` printed NaN% (#636) before a
 * zero over a zero was refused on its own.
 *
 * @returns The `PERCENTAGE_NOT_FINITE` error Value.
 */
export function percentageOfNoNumber(): Value {
    return errorValue(
        "PERCENTAGE_NOT_FINITE",
        "This has no percentage: its value is not a number at all, as an infinity less an infinity is not.",
    );
}

/**
 * The refusal for a percentage of a number that is itself past the largest
 * double: `2^2000` and `1e309` are held as an infinity because no double is
 * large enough for them, and a percentage of one was told it "is what
 * dividing by zero gives". It is too large, and says so, with the code a
 * finite number too large for its percentage takes.
 *
 * @returns The `PERCENTAGE_OVERFLOW` error Value.
 */
export function percentageInfinite(): Value {
    return errorValue(
        "PERCENTAGE_OVERFLOW",
        "This is too large to write as a percentage: the number is past about 1.8e308, the largest number that can be held.",
    );
}

/**
 * The refusal for a percentage too large to hold: `1e308 as %` printed
 * Infinity%, though 1e308 is an ordinary number, because a percentage is a
 * hundred times its fraction and a hundred times 1e308 is past the largest
 * double (about 1.8e308). A whole number written with `n` past that
 * (`2n^2000`) is refused the same way, since its double is infinite only for
 * want of room. The value is a real number, so this names its size, where
 * {@link percentageNotFinite} names a division by zero.
 *
 * @returns The `PERCENTAGE_OVERFLOW` error Value.
 */
export function percentageTooLarge(): Value {
    return errorValue(
        "PERCENTAGE_OVERFLOW",
        "This is too large to write as a percentage: a percentage is a hundred times the number, and that is past about 1.8e308, the largest number that can be held.",
    );
}

/**
 * Whether a value whose double is infinite still stands for a finite number:
 * a whole number written with `n` (`2n^2000`), or a number carrying an exact
 * integer, fraction or decimal past where a double reaches. A plain infinity
 * (`1/0`, and `2^2000`, which is computed in doubles) has none of these.
 *
 * @param value - The value.
 */
export function hasFiniteExactReading(value: Value): boolean {
    return value.type === ValueType.BigInt || value.rational !== undefined || value.exact !== undefined;
}

/**
 * A temperature plus a temperature on another scale, the right one read as a
 * step rather than a reading, or null when the sum is not one of those (#645).
 *
 * Adding to a temperature adds a difference: `20 °C + 10 °F` raises twenty
 * degrees Celsius by ten Fahrenheit degrees, which is 5.56 Celsius degrees, so
 * the answer is 25.56 °C. The general sum converted the right operand as a
 * reading (10 °F is -12.22 °C) and answered 7.78 °C, and `20 °C + 10 K` added
 * -263.15 °C. The step is converted the way a tolerance's width is (see
 * {@link toleranceSpread}): `convert(s) - convert(0)`, which cancels the offset
 * between the scales and keeps their ratio. The left operand's scale is the
 * answer's, as it is for every sum of two quantities.
 *
 * Only `+`, and only across scales. A same-scale sum was already right and does
 * not come here. Subtraction keeps the documented reading of both sides as
 * temperatures (`20 °C - 10 °F` is 32.22 °C), a convention held for 3.0.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @returns The sum in the left operand's scale, or null.
 */
export function temperatureStep(l: Value, r: Value): Value | null {
    if (l.type !== ValueType.Uom || r.type !== ValueType.Uom) return null;
    const lUnit = l.unit, rUnit = r.unit;
    if (lUnit === undefined || rUnit === undefined || lUnit === rUnit) return null;
    if (getMeasure(lUnit) !== "temperature" || getMeasure(rUnit) !== "temperature") return null;
    const step = convertUnit(r.toNumber(), rUnit, lUnit) - convertUnit(0, rUnit, lUnit);
    return uomValue(l.toNumber() + step, lUnit);
}

/**
 * Whether a value is a length of time a reader typed in a unit a clock shows
 * without loss: a time quantity in anything but milliseconds.
 *
 * @param v - The value.
 */
function isTypedLengthOfTime(v: Value): boolean {
    return v.type === ValueType.Uom && v.unit !== undefined && v.unit !== "ms" && getMeasure(v.unit) === "time";
}

/** Whether a value can meet a value written in a base in exact arithmetic: a plain number or another value in a base. */
function plainOperand(v: Value): boolean {
    return (v.type === ValueType.Number || v.type === ValueType.Hex) && v.uncertainty === undefined;
}

/**
 * `+`, `-`, `*` or `mod` on two whole numbers when one is past a double's
 * range, as the `n` whole number it has to be, or null. A value written in a
 * base can hold such a number (`(2n^2000) in hex`), where an ordinary number
 * cannot, so its sum was an infinity. Division and powers have no whole-number
 * answer in general and keep the double's; so does a side with no whole value.
 *
 * @param a - The left whole number, or null when it has none.
 * @param b - The right whole number, or null.
 * @param op - The operation.
 */
function pastDoubleArithmetic(a: bigint | null, b: bigint | null, op: "add" | "sub" | "mul" | "div" | "mod" | "pow"): Value | null {
    if (a === null || b === null) return null;
    switch (op) {
        case "add": return wholeFromBase(a + b);
        case "sub": return wholeFromBase(a - b);
        case "mul": return wholeFromBase(a * b);
        case "mod": return b === 0n ? null : wholeFromBase(a % b);
        default: return null;
    }
}

/**
 * Arithmetic with a value written in a base past 2^53 on either side, done on
 * the whole number it holds, or null to keep the ordinary path.
 *
 * `in hex`, `in binary` and `in octal` keep the exact integer inside the value
 * they write (see baseConversionOperand()), and `+`, `-`, `*`, `/`, `mod` and
 * `^` read it through `toNumber()`, the nearest double, so `(2^100 + 1) in hex
 * + 1` answered 1,267,650,600,228,229,400,000,000,000,000. The value is read
 * as the exact integer instead (see exactIntegerValue()) and the operation
 * goes through the exact paths an ordinary large whole number takes: a
 * fraction for `/`, an exact remainder, an exact power. The answer is a plain
 * number, as `0x10 + 1` is 17.
 *
 * Only a plain number or another value in a base on the other side: a
 * quantity, a bigint, a percentage and the rest keep their own paths, and a
 * number carrying a tolerance keeps it. Null too when the exact path has no
 * answer (a zero divisor, a result past a double's range), which leaves the
 * double's answer as it was.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @param op - The operation.
 */
export function bigBaseArithmetic(l: Value, r: Value, op: "add" | "sub" | "mul" | "div" | "mod" | "pow"): Value | null {
    const lb = bigBaseInteger(l), rb = bigBaseInteger(r);
    if (lb === null && rb === null) return null;
    if (!plainOperand(l) || !plainOperand(r)) return null;
    const a = lb === null ? l : exactIntegerValue(lb);
    const b = rb === null ? r : exactIntegerValue(rb);
    if (!Number.isFinite(a.toNumber()) || !Number.isFinite(b.toNumber())) return pastDoubleArithmetic(lb ?? exactIntegerOf(l, false), rb ?? exactIntegerOf(r, false), op);
    if (op === "mod") return exactIntegerRemainder(a, b);
    if (op === "pow") {
        const approx = power(a.toNumber(), b.toNumber());
        return Number.isFinite(approx) ? exactIntegerArithmetic(a, b, approx, "pow") : null;
    }
    return exactRationalOp(a, b, op);
}

/**
 * Apply a numeric binary operation with type-aware dispatch.
 * Handles BigInt, UoM, Vector, Symbolic, and plain Number operands.
 *
 * @param symbolicOp - which SymbolicNode kind to build when either operand
 *   is Symbolic (`symbolic/SymbolicNode.ts`). Only ADD/SUB/MUL/DIV pass this (the
 *   "four arithmetic opcodes" the symbolic-algebra phase scopes itself
 *   to), MOD's own call site passes nothing, so a Symbolic operand there
 *   falls through to the ordinary numeric path (`toNumber()` -> 0), an
 *   explicit, disclosed scope boundary rather than an oversight.
 */
export function binaryOp(
    l: Value, r: Value,
    op: (a: number, b: number) => number,
    bigOp?: (a: bigint, b: bigint) => bigint,
    symbolicOp?: "add" | "sub" | "mul" | "div"
): Value {
    // Error/Pending short-circuit, MUST run before any other branch.
    // Value.toNumber() returns 0 for both Error and Pending (see
    // vm/Value.ts), so without this check, every path below (including
    // the plain-number fast path two lines down) would silently treat an
    // errored or not-yet-resolved operand as the number 0, e.g. an
    // errored cross-line reference (`prev + 1` in packages/lines) would
    // quietly evaluate to 1 instead of surfacing the error. Propagate
    // Error/Pending operands as-is (left operand checked first, matching
    // left-to-right evaluation order) rather than manufacturing a new
    // error, so the original error code/message (or pending query key)
    // reaches the caller unchanged. Confirmed via ADD/SUB/MUL/DIV/MOD in
    // vm/VM.ts: none of their type-specific fast paths (Number/Boolean/
    // Datetime/Uom/Rate) match Error or Pending, so every one of them
    // already funnels here on those operand types.
    if (l.type === ValueType.Error) return l;
    if (r.type === ValueType.Error) return r;
    if (l.type === ValueType.Pending) return l;
    if (r.type === ValueType.Pending) return r;

    // Text in arithmetic. `toNumber()` reads text through `parseFloat`, so a
    // quoted time plus a number, `"11:00 PM" + 2`, answered 13 and `"hello" +
    // 5` answered 5: the text's leading digits, or 0, passed off as its value.
    // Text joins to text in ADD before this point; everything else that
    // reaches here with text on either side is refused by name. Issue #549.
    if (l.type === ValueType.String || r.type === ValueType.String) {
        return errorValue(
            "TEXT_ARITHMETIC",
            symbolicOp === "add"
                ? `Text and a number cannot be added: + joins text only to other text. To add a number held as text, convert it first with "as number".`
                : "Text cannot be used in arithmetic: only numbers and quantities can. To use a number held as text, convert it first with \"as number\".",
        );
    }

    // A date or time in arithmetic. ADD and SUB move a date by a length of time
    // before this point; anything else that reaches here with a date or time
    // on either side read it as its epoch milliseconds, so `1:30 * 3` answered
    // 5,370,888,600,000 on 25 September 2026. Refused by name, as the
    // aggregates already refuse the same values.
    if (l.type === ValueType.Datetime || r.type === ValueType.Datetime) return datetimeArithmeticRefused(symbolicOp);

    // An IPv6 address and a colour have no numeric reading; see hasNoNumber().
    const opaque = noNumberArithmeticRefused(l, r, symbolicOp);
    if (opaque) return opaque;

    // Symbolic dispatch, either operand carries a free-variable formula.
    // Builds the corresponding SymbolicNode (the non-symbolic side, if
    // any, becomes a `const` node via its own numeric value), simplifies
    // it (symbolic/Simplify.ts's deliberately bounded rule set), and wraps the
    // result back as Symbolic. `symbolicOp` is undefined for opcodes that
    // don't support this (currently just MOD), those fall through to the
    // ordinary numeric path below unchanged.
    if (symbolicOp && (l.type === ValueType.Symbolic || r.type === ValueType.Symbolic)) {
        const left = valueToSymbolic(l);
        const right = valueToSymbolic(r);
        // An operand with no exact rational image (NaN, ±Infinity) used to be
        // folded in as a `const` built from a double, which either threw deep
        // inside the simplifier or produced a nonsense coefficient. Report it.
        if (left === null || right === null) {
            return errorValue(
                "SYMBOLIC_NONFINITE_OPERAND",
                "A symbolic expression cannot combine with a value that has no exact number (NaN or infinity).",
            );
        }
        const simplified = simplifySymbolic({ kind: symbolicOp, left, right } satisfies SymbolicNode);
        // A quotient by an exact zero is refused here, where it is written, so
        // no later verb reads it as algebra (see dividesByZero).
        if (dividesByZero(simplified)) return symbolicDivisionByZero();
        return symbolicValue(simplified);
    }

    // Fast path: both operands are plain numbers, skip all type checks.
    // This is the overwhelmingly common case (90%+ of all binary ops).
    // Inlined arithmetic avoids the overhead of helper function dispatch,
    // UoM unification, Vector iteration, BigInt conversion, and NaN guards.
    if (l.type === ValueType.Number && r.type === ValueType.Number) {
        return numberValue(op(l.value as number, r.value as number));
    }

    if (l.type === ValueType.BigInt || r.type === ValueType.BigInt) {
        // Read an already-BigInt operand's raw bigint directly. See
        // toBigIntOperand() above for why, and for the other opcodes that
        // share it.
        const lb = toBigIntOperand(l);
        const rb = toBigIntOperand(r);
        if (bigOp) return bigIntValue(bigOp(lb, rb));
        return bigIntValue(lb + rb);
    }

    // A value written in a base past 2^53 is worked on its whole number; see
    // bigBaseArithmetic().
    if (symbolicOp) {
        const inBase = bigBaseArithmetic(l, r, symbolicOp);
        if (inBase) return inBase;
    }

    if (l.type === ValueType.Uom || r.type === ValueType.Uom) {
        // A list, a range or a colour has no amount to put in the quantity's
        // unit, and a constant whose unit the engine cannot spell has the wrong
        // one: each took the quantity's unit here (#640, #648).
        const refused = quantityOperandRefused(l, r, symbolicOp);
        if (refused) return refused;
        // A temperature added to one on another scale is a step, not a reading
        // (#645); see temperatureStep().
        if (symbolicOp === "add") {
            const step = temperatureStep(l, r);
            if (step) return step;
        }
        // Money in the same currency (or money against a plain scalar) is exact:
        // "$0.10 + $0.20" is "$0.30", not the double's "$0.30000000000000004".
        // Only the four arithmetic ops carry an `op` kind (MOD passes none), and
        // only currencies set the sidecar, so everything else falls straight
        // through to the float unification below unchanged.
        if (symbolicOp) {
            const exactMoney = exactMoneyOp(l, r, symbolicOp);
            if (exactMoney) return exactMoney;
        }
        const { lv, rv, unit, sameMeasure } = unifyUom(l, r);
        // NaN is deliberately NOT intercepted here. A guard used to answer a
        // bare, unitless 0 for it, which turned an operand that means "no
        // answer" into a confident one and threw the unit away as well:
        // `(1 kg / 0 * 0) + 1 kg` reported 0 rather than NaN kg. NaN
        // propagates through the arithmetic below exactly as it does for
        // plain numbers, and the comparison opcodes already report false
        // against it, which is how a caller detects it.
        if (!sameMeasure) {
            // unifyUom couldn't reconcile the two units, either they're
            // genuinely incompatible measures (meters + kilograms), or
            // they're both currencies but no rate was available yet.
            // Silently combining the raw magnitudes here used to produce a
            // confidently-wrong, unitless number (e.g. "0.01 BTC + 1 ETH"
            // → a bare "1.01", the naive 0.01+1 sum with the currency
            // context just dropped) instead of surfacing the failure
            // mirrors the existing UOM_CONVERT_TO/_IN error path in VM.ts.
            const lUnit = l.type === ValueType.Uom ? l.unit : undefined;
            const rUnit = r.type === ValueType.Uom ? r.unit : undefined;
            // Name the two dimensions when they genuinely differ ("mass and
            // length cannot be added"). Two currencies with no cached rate reach
            // here too, and share the money dimension, so there is nothing to
            // contrast: describeMeasureMismatch returns undefined and the
            // unit-naming fallback below keeps the "BTC and ETH" form.
            const named = describeMeasureMismatch(lUnit, rUnit, combineVerb(symbolicOp));
            return errorValue("INCOMPATIBLE_UNITS", named ?? `Cannot combine incompatible units: ${unitForMessage(lUnit ?? "?")} and ${unitForMessage(rUnit ?? "?")}`);
        }
        const combined = uomValue(op(lv, rv), unit!);
        // Two currencies met through an exchange rate, so the answer depends
        // on it. The operands' own records are merged by the VM, which does
        // that for every opcode in one place; only the rate is new here.
        const rateSources = currencyRateSources(l, r);
        if (rateSources !== undefined) combined.sources = rateSources;
        // A span of time stays a span when it is added to another span, or
        // scaled by a plain number: two shifts added together are a shift, and
        // half a shift is a shift, so both still read as a clock. A span
        // combined with a quantity somebody typed is not, which is what keeps
        // an ordinary `40ms + 120ms` a count of milliseconds.
        const bothSpans = l.datetimeSpan === true && r.datetimeSpan === true;
        const scaled =
            (l.datetimeSpan === true && r.type === ValueType.Number) ||
            (r.datetimeSpan === true && l.type === ValueType.Number);
        // A span with a length of time added or taken away is still a span:
        // `(9:30 - 8:30) + 30 minutes` is an hour and a half, and came back as
        // 5,400,000.00 ms, a unit nobody wrote. A typed quantity in milliseconds
        // is the exception, since a clock shows whole seconds and would drop
        // them: `(9:30 - 8:30) + 40ms` stays in the milliseconds it was given.
        const lengthened = (symbolicOp === "add" || symbolicOp === "sub") && (
            (l.datetimeSpan === true && isTypedLengthOfTime(r)) ||
            (r.datetimeSpan === true && isTypedLengthOfTime(l)));
        if (lengthened && unit !== "ms") {
            // The unit came from the typed side (`30 minutes + (9:30 - 8:30)`
            // unified to minutes), and a span shows on a clock only from
            // milliseconds, so both orders read the same.
            const span = uomValue(convertUnit(combined.toNumber(), unit!, "ms"), "ms");
            span.datetimeSpan = true;
            if (combined.sources !== undefined) span.sources = combined.sources;
            return span;
        }
        if (bothSpans || scaled || lengthened) combined.datetimeSpan = true;
        return combined;
    }

    // Element-wise Matrix dispatch (ADD/SUB/DIV/MOD land here; MUL's real
    // scalar-vs-matrix-product disambiguation happens in VM.ts's own MUL
    // case BEFORE falling through to binaryOp() at all, so this generic
    // path only ever needs to handle the always-element-wise ops).
    if (l.type === ValueType.Matrix && r.type === ValueType.Matrix) {
        const lm = l.value as MatrixData;
        const rm = r.value as MatrixData;
        if (!sameShape(lm, rm)) {
            // Silently truncating/broadcasting a shape mismatch used to
            // drop components with no indication (the old flat-Array
            // Math.min() truncation bug), surface it instead.
            return errorValue("DIMENSION_MISMATCH", `Cannot combine matrices of different shapes: ${lm.rows}x${lm.cols} and ${rm.rows}x${rm.cols}`);
        }
        const result: MatrixEntry[] = new Array(lm.data.length);
        for (let i = 0; i < lm.data.length; i++) result[i] = op(lm.data[i] as number, rm.data[i] as number);
        return matrixValue(lm.rows, lm.cols, result);
    }

    if (l.type === ValueType.Matrix) {
        // Scalar broadcast: [1,2,3]/10 => [0.1,0.2,0.3], preserves shape.
        const lm = l.value as MatrixData;
        const scalar = r.toNumber();
        const result: MatrixEntry[] = lm.data.map(v => op(v as number, scalar));
        return matrixValue(lm.rows, lm.cols, result);
    }

    if (r.type === ValueType.Matrix) {
        const rm = r.value as MatrixData;
        const scalar = l.toNumber();
        const result: MatrixEntry[] = rm.data.map(v => op(scalar, v as number));
        return matrixValue(rm.rows, rm.cols, result);
    }

    // No NaN guard here either, for the reason given in the Uom branch above:
    // an operand that is NaN has to stay NaN rather than become a zero nobody
    // can tell apart from a real one.
    return numberValue(op(l.toNumber(), r.toNumber()));
}
