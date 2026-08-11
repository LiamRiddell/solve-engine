import { Value, ValueType, numberValue, bigIntValue, uomValue, matrixValue, errorValue, symbolicValue, type MatrixData, type MatrixEntry } from "@solve-js/vm/Value";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { sameShape } from "@solve-js/vm/MatrixOps";
import { type SymbolicNode, simplifySymbolic } from "@solve-js/symbolic";
import { valueToSymbolic } from "@solve-js/vm/SymbolicOps";
import { ErrorFactory, type EngineError } from "@solve-js/errors/UnifiedErrorFramework";

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
        if (isCurrency) {
            const rvConverted = sharedCurrencyExchange.convertSync(r.toNumber(), r.unit!, l.unit!);
            if (rvConverted !== null) {
                return { lv: l.toNumber(), rv: rvConverted, unit: l.unit, sameMeasure: true };
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
    if (lv === rv) return { lv, rv, equal: true, sameMeasure: true };
    if (!Number.isFinite(lv) || !Number.isFinite(rv)) return { lv, rv, equal: false, sameMeasure: true };
    const scale = largestFiniteMagnitude(lv, rv, r.toNumber());
    return { lv, rv, equal: Math.abs(lv - rv) <= scale * UNIFIED_COMPARISON_TOLERANCE, sameMeasure: true };
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
 */
export function incomparableUnitsError(l: Value, r: Value): Value {
    const lUnit = l.type === ValueType.Uom ? l.unit : undefined;
    const rUnit = r.type === ValueType.Uom ? r.unit : undefined;
    return errorValue("INCOMPATIBLE_UNITS", `Cannot compare incompatible units: ${lUnit ?? "?"} and ${rUnit ?? "?"}`);
}

/**
 * Read an operand as a bigint without rounding it through a double first.
 *
 * An already-BigInt operand hands over its raw bigint; anything else converts
 * via `toNumber()`, which is lossless because a value that was only ever a
 * double has no extra precision to lose. Going through `toNumber()`
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

/** An operand's exact bigint image, or null when it has none. */
function exactBigInt(v: Value): bigint | null {
    if (v.type === ValueType.BigInt) return v.value as bigint;
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
        const node: SymbolicNode = { kind: symbolicOp, left, right };
        return symbolicValue(simplifySymbolic(node));
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

    if (l.type === ValueType.Uom || r.type === ValueType.Uom) {
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
            return errorValue("INCOMPATIBLE_UNITS", `Cannot combine incompatible units: ${lUnit ?? "?"} and ${rUnit ?? "?"}`);
        }
        return uomValue(op(lv, rv), unit!);
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
