/**
 * Exact-decimal scaling for money, shared by the percentage operators (`VM.ts`)
 * and the tax builtins (`VMBuiltins.ts`).
 *
 * A price is a decimal, not a binary fraction, so `$X * factor` has to be formed
 * in base ten. Computed as a float it lands a hair below the true value and the
 * half-cent then rounds the wrong way: `$0.10 * 1.15` is `0.1149999...`, which a
 * till reads as `$0.12` but a double rounds down to `$0.11`. These helpers
 * recover the exact decimals of the amount and the factor, multiply them
 * exactly, and hand back a value carrying the exact sidecar; they fall back to
 * the float path only where an operand has no exact value, so nothing that was
 * exact before loses exactness.
 */

import { Value, uomValue, uomValueExact } from "@solve-js/vm/Value";
import {
	decimalFromLiteral,
	decimalFromInteger,
	decimalFromNumberIfExact,
	decimalNegate,
	decimalToNumber,
	decimalAdd,
	decimalMultiply,
	type DecimalData,
} from "@solve-js/decimal";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";

/** Exact base-ten `1`, the constant term in a `1 + p%` scaling factor. */
const ONE_DECIMAL: DecimalData = decimalFromInteger(1);

/**
 * The exact decimal a currency amount should carry, or null when it has none.
 *
 * Gated on the unit being a currency, so the exact-decimal machinery is money's
 * and money's alone in this slice, every other Uom (km, kg, minutes) is left
 * exactly as it was. The amount's exact value is either the sidecar a decimal
 * literal already set, or, for a whole-number amount, the integer itself. A
 * fractional double with no sidecar (`$sqrt(2)`, `$ (1/3) `) returns null and
 * stays a float, which is the deliberate boundary: exactness only where an
 * exact value actually exists.
 */
export function moneyExactMagnitude(operand: Value, unit: string): DecimalData | null {
	if (!sharedCurrencyExchange.isCurrency(unit)) return null;
	return operand.exact ?? decimalFromNumberIfExact(operand.toNumber());
}

/**
 * The exact base-ten value of a number that is exactly a short decimal (the
 * proportion a percentage the user typed reduces to, e.g. `15%` -> `0.15`), via
 * its shortest round-tripping string, or null for a value that is not (a computed
 * irrational, or scientific-notation extreme). Wider than
 * {@link decimalFromNumberIfExact} (integers only), and used only to recover a
 * percentage's intended decimal, where the printed proportion is the meaning.
 */
export function decimalFromShortDecimal(n: number): DecimalData | null {
	if (!Number.isFinite(n)) return null;
	if (Number.isInteger(n)) return decimalFromInteger(BigInt(n));
	const s = String(n);
	if (!/^-?\d+\.\d+$/.test(s)) return null;
	return decimalFromLiteral(s);
}

/**
 * Scale a money amount by a bare factor, keeping it exact.
 *
 * `tax on $X at R%` is `$X * R`, and money multiplication is exact wherever the
 * inputs are, so `tax on $10.10 at 15%` is `$1.515 -> $1.52`, not the `$1.51` a
 * bare double (`10.10 * 0.15 = 1.5149999...`) rounds down to. The factor is
 * recovered from its shortest decimal, the proportion the rate was typed as.
 * Falls back to the float path only when an operand has no exact value (the same
 * boundary {@link moneyExactMagnitude} draws), so nothing that was exact before
 * loses exactness, and a non-currency unit passes straight through it unchanged.
 */
export function scaleMoneyExact(amount: Value, factor: number, unit: string): Value {
	const base = moneyExactMagnitude(amount, unit);
	const factorDecimal = decimalFromShortDecimal(factor);
	if (base !== null && factorDecimal !== null) {
		const result = decimalMultiply(base, factorDecimal);
		return uomValueExact(decimalToNumber(result), unit, result);
	}
	return uomValue(amount.toNumber() * factor, unit);
}

/**
 * Scale a money amount by `1 + sign * percent`, keeping it exact.
 *
 * `$X + p%` is `$X * (1 + p%)`, and money multiplication is exact wherever the
 * inputs are, so the till answer for `$0.10 + 15%` is `$0.115 -> $0.12`, not the
 * `$0.11` a bare double (`0.10 * 1.15 = 0.1149999...`) rounds down to. The
 * one-plus-percent factor is formed in base ten so no double drift creeps in.
 * Falls back to the float path only when an operand has no exact value (the same
 * boundary {@link moneyExactMagnitude} draws), so nothing that was exact before
 * loses exactness.
 */
export function scaleMoneyByPercent(money: Value, unit: string, percent: number, sign: 1 | -1): Value {
	const base = moneyExactMagnitude(money, unit);
	const percentDecimal = decimalFromShortDecimal(percent);
	if (base !== null && percentDecimal !== null) {
		const factor = decimalAdd(ONE_DECIMAL, sign === 1 ? percentDecimal : decimalNegate(percentDecimal));
		const result = decimalMultiply(base, factor);
		return uomValueExact(decimalToNumber(result), unit, result);
	}
	return uomValue(money.toNumber() * (1 + sign * percent), unit);
}
