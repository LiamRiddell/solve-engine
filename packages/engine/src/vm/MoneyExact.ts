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

import { Value, uomValue, uomValueExact, type SplitData, type SplitShare } from "@solve-js/vm/Value";
import {
	decimalFromLiteral,
	decimalFromInteger,
	decimalFromNumberIfExact,
	decimalNegate,
	decimalToNumber,
	decimalAdd,
	decimalSubtract,
	decimalMultiply,
	decimalDivide,
	decimalIsZero,
	decimalRound,
	makeDecimal,
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

/**
 * The exact base-ten `1 + rate` divisor of a tax-inclusive total, or null when
 * the rate has no short decimal. Formed in base ten (not as the double `1 +
 * rate`) so the tax-inclusive divisor carries no drift, the same reason
 * {@link scaleMoneyByPercent} builds its factor this way.
 */
function onePlusRateDecimal(rate: number): DecimalData | null {
	const rateDecimal = decimalFromShortDecimal(rate);
	return rateDecimal === null ? null : decimalAdd(ONE_DECIMAL, rateDecimal);
}

/**
 * `$X / (1 + rate)`, the pre-tax amount inside a tax-inclusive total, kept exact.
 *
 * `tax off $0.09 at 20%` is `$0.09 / 1.2 = $0.075`, which the half-cent rule
 * rounds to `$0.08`, not the `$0.07` a bare double (`0.09 / 1.2 = 0.0749999...`)
 * rounds down to. {@link decimalDivide} carries the quotient exactly where it
 * terminates (the cases that can land on a half-cent, at 20%/25%/50%) and rounds
 * it far below the cent where it does not, so the displayed cent is right either
 * way. Falls back (returns null) only when an operand has no exact value or the
 * divisor is zero, leaving the caller's float path, the same boundary the other
 * MoneyExact helpers draw.
 */
export function removeTaxExact(money: Value, unit: string, rate: number): Value | null {
	const base = moneyExactMagnitude(money, unit);
	const divisor = onePlusRateDecimal(rate);
	if (base === null || divisor === null || decimalIsZero(divisor)) return null;
	const quotient = decimalDivide(base, divisor);
	return uomValueExact(decimalToNumber(quotient), unit, quotient);
}

/**
 * `$X - $X / (1 + rate)`, the tax already inside a tax-inclusive total, kept
 * exact. The complement of {@link removeTaxExact}: the two sum back to `$X`.
 *
 * `tax in $0.09 at 20%` is `$0.09 - $0.075 = $0.015`, which rounds to `$0.02`,
 * not the `$0.01` the drifted double rounds down to. The subtraction is done in
 * base ten so the tax and the net a matching `tax off` reports stay consistent.
 */
export function taxInExact(money: Value, unit: string, rate: number): Value | null {
	const base = moneyExactMagnitude(money, unit);
	const divisor = onePlusRateDecimal(rate);
	if (base === null || divisor === null || decimalIsZero(divisor)) return null;
	const tax = decimalSubtract(base, decimalDivide(base, divisor));
	return uomValueExact(decimalToNumber(tax), unit, tax);
}

/**
 * Allocate a bill split into whole-cent shares that add back to the exact
 * total. `split $100 between 3` is $33.34 once and $33.33 twice: 2 × $33.33 +
 * 1 × $33.34 is $100.00 to the cent, not the bare $33.33 each that loses a
 * penny. Largest-remainder allocation on the amount's exact decimal cents, so
 * the reconciliation is exact wherever the amount is (a money literal, or a
 * percentage-scaled one like `$120 + 18%`). A non-currency amount (a bare
 * number, or a unit such as km) divides evenly into a single share, carrying
 * its unit for display; money with no exact magnitude (a live-rate conversion)
 * falls back to a float even split, the same boundary the other helpers draw.
 *
 * `n` is assumed a positive integer, the split builtin validates it first.
 * Shares are ordered base-first: the "each" amount, then, on an uneven split,
 * the slightly larger amount the odd penny falls on.
 */
export function splitEachExact(amount: Value, n: number): SplitData {
	const unit = amount.unit;
	const cents = unit !== undefined && sharedCurrencyExchange.isCurrency(unit)
		? centsOfMoney(amount, unit)
		: null;
	if (cents === null) {
		return { unit, shares: [{ value: amount.toNumber() / n, count: n }] };
	}

	const divisor = BigInt(n);
	const baseCents = cents / divisor; // truncates toward zero
	const remainder = cents - baseCents * divisor; // sign follows `cents`
	const extraShares = Number(remainder < 0n ? -remainder : remainder);
	// A refund (negative total) puts the extra cent on the more-negative share.
	const step = cents < 0n ? -1n : 1n;

	const base = centShare(baseCents, n - extraShares);
	if (extraShares === 0) return { unit, shares: [base] };
	return { unit, shares: [base, centShare(baseCents + step, extraShares)] };
}

/** A currency share built from its whole-cent coefficient. */
function centShare(cents: bigint, count: number): SplitShare {
	const exact = makeDecimal(cents, 2);
	return { value: decimalToNumber(exact), exact, count };
}

/**
 * The exact whole-cent coefficient of a money amount, or null when it has no
 * exact magnitude (a live-rate conversion), so the caller falls back to a float
 * even split. Rounds to two places half-away-from-zero, the till rule the rest
 * of the money arithmetic uses.
 */
function centsOfMoney(amount: Value, unit: string): bigint | null {
	const base = moneyExactMagnitude(amount, unit);
	return base === null ? null : decimalRound(base, 2).coef;
}
