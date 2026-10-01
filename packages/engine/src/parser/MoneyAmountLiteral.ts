/**
 * Whether a number literal is the amount of a money literal, so that one
 * written in exponent form keeps its exact value as the point form does.
 *
 * A literal written with a point (`0.001`) has always been pushed with its
 * exact base-ten value, which money reads to round to the currency's minor
 * unit: `$0.001` is `$0.00`. The same amount written `1e-3` was pushed as the
 * nearest double and kept nothing, so `$1e-3` was shown as a converted amount
 * is, `$0.001`. Scientific notation on its own deliberately stays a double
 * (`1e16 + 1 - 1e16` is 0, as the double says), so it is read exactly only
 * where it is the amount of money: straight after a currency symbol
 * (`$1e-3`, `$-1e-3`), or straight before a currency written after it
 * (`1e-3 USD`, `1e-3 dollars`, `1e-3 €`).
 */

import type { Token } from "@solve-js/lexer/Token";
import { resolveCurrencyAlias } from "@solve-js/uom/CurrencyAliases";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";

/** The token types a currency symbol lexes as, written before an amount. */
export const CURRENCY_SYMBOL_TYPES: ReadonlySet<string> = new Set(["DOLLAR", "POUND", "EURO", "YEN", "RUBLE", "WON", "CURRENCY_SYMBOL"]);

/**
 * Whether a unit written after an amount makes it money, read as the unit
 * literal reads it: a word or symbol through the alias table (`dollars`, `€`),
 * then the code itself (`USD`, `BTC`).
 *
 * @param token - The token after the amount.
 * @returns `true` for a currency unit.
 */
function isCurrencyUnit(token: Token): boolean {
	if (token.type !== "UNIT") return false;
	const unit = resolveCurrencyAlias(token.value) ?? token.value;
	return sharedCurrencyExchange.isCurrency(unit);
}

/**
 * Whether the number literal between `before` and `after` is the amount of a
 * money literal.
 *
 * @param before - The token before the literal, or undefined at the start of the line.
 * @param beforeThat - The token before that one, for a sign between the symbol and the amount.
 * @param after - The token after the literal, or undefined at the end of the line.
 * @returns `true` when a currency symbol is written before it (a sign may sit
 * between) or a currency unit after it.
 */
export function isMoneyAmount(before: Token | undefined, beforeThat: Token | undefined, after: Token | undefined): boolean {
	if (before !== undefined) {
		if (CURRENCY_SYMBOL_TYPES.has(before.type)) return true;
		if ((before.type === "MINUS" || before.type === "PLUS") && beforeThat !== undefined && CURRENCY_SYMBOL_TYPES.has(beforeThat.type)) return true;
	}
	return after !== undefined && isCurrencyUnit(after);
}
