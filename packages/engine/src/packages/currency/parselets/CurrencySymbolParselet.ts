import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { CURRENCY_SYMBOL_ALIASES, resolveCurrencyAlias } from "@solve-js/uom/CurrencyAliases";

/** @deprecated kept as a named re-export for backward compatibility, the canonical table now lives in uom/CurrencyAliases.ts alongside the word-form aliases and the display-formatting table, so all three stay in sync. */
export const symbolToCurrency = CURRENCY_SYMBOL_ALIASES;

/**
 * Currency symbol before an amount, as in `$100` or `£25`.
 *
 * Resolves the symbol through the shared alias table so that the symbol, word
 * and code forms all produce the same currency, and falls back to the raw text
 * uppercased when the symbol is unknown rather than rejecting the line.
 */
export class CurrencySymbolParselet implements PrefixParselet {
	readonly category = "UoM";
	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    const currency = resolveCurrencyAlias(token.value) ?? token.value.toUpperCase();
    parser.parseExpression(BindingPower.Prefix, builder);
    if (parser.peek()?.type === "UNIT") {
      parser.consume();
    }
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(currency);
    builder.emitOpcode(OpCode.UOM_CONVERT);
  }
}
