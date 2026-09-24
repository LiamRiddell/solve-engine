import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { resolveCurrencyAlias, CURRENCY_DISPLAY } from "@solve-js/uom/CurrencyAliases";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { isKnownUnit } from "@solve-js/lexer/units";

/**
 * Whether a currency code after an amount can stand for the symbol before it:
 * the same currency, or another the display table writes with the same symbol
 * (`$` for USD, CAD, AUD and the other dollars; `¥` for JPY and CNY).
 */
function sharesSymbol(code: string, currency: string): boolean {
  if (code === currency) return true;
  const written = CURRENCY_DISPLAY[code]?.symbol;
  return written !== undefined && written === CURRENCY_DISPLAY[currency]?.symbol;
}

/**
 * Currency symbol before an amount, as in `$100` or `£25`.
 *
 * Resolves the symbol through the shared alias table so that the symbol, word
 * and code forms all produce the same currency, and falls back to the raw text
 * uppercased when the symbol is unknown rather than rejecting the line.
 *
 * A currency code after the amount says which currency the symbol meant, since
 * one symbol serves several: `$5 CAD` is five Canadian dollars and `¥500 CNY`
 * five hundred yuan. The code is taken when it names the symbol's own currency
 * or another written with the same symbol. Any other unit after the amount
 * (`€5 GBP`, `$5 kg`) used to be consumed and discarded, so `$5 CAD` was five US
 * dollars; it is now left in place, where the unit literal refuses a second unit
 * on a quantity (issue #536).
 *
 * A price per unit written straight after the amount (`$5/kg`, `$0.30 per kWh`,
 * `£2 a day`) is part of the literal, the way `5 GBP/kg` is one unit: the amount
 * and its denominator make one rate before any operator sees them. Left to the
 * rate parselet, which binds at the level of `*`, the denominator attached to
 * everything before it instead, so `3 kg * $5/kg` was read as `(3 kg * $5) per
 * kg` and answered 15.00 USD/kg rather than $15.00.
 */
export class CurrencySymbolParselet implements PrefixParselet {
	readonly category = "UoM";
	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    let currency = resolveCurrencyAlias(token.value) ?? token.value.toUpperCase();
    // The amount stops short of a unit literal (which binds at Postfix), so a
    // unit after it is weighed here, as the code or not, rather than bound onto
    // the bare number first.
    parser.parseExpression(BindingPower.Postfix, builder);
    const next = parser.peek();
    if (next?.type === "UNIT") {
      // An ISO code (`CAD`) is not an alias, so it is checked against the
      // currency table directly.
      const raw = next.value ?? "";
      const code = resolveCurrencyAlias(raw) ?? (sharedCurrencyExchange.isCurrency(raw.toUpperCase()) ? raw.toUpperCase() : undefined);
      if (code !== undefined && sharesSymbol(code, currency)) {
        parser.consume();
        currency = code;
      } else if (code === undefined && !isKnownUnit(raw)) {
        // A word the unit table does not know, retyped as a unit by the
        // count-label rule because a rate follows (`£60,000 salary per
        // month`). It labels the amount rather than measuring it, and money
        // keeps its own unit, so the label is read and set aside as it always
        // was.
        parser.consume();
      }
    }
    // The fused denominator of a price per unit (see the class comment). Only
    // the one: a second `per` after it is a rate of a rate, which the rate
    // parselet refuses by name, as it always has.
    let unit = currency;
    const perUnit = parser.peek();
    if (perUnit?.type === "PER_UNIT") {
      parser.consume();
      unit = `${currency}/${String(perUnit.value)}`;
    }
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(unit);
    builder.emitOpcode(OpCode.UOM_CONVERT);
  }
}
