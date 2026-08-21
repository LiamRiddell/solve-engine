import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { isKnownUnit } from "@solve-js/lexer/units";
import { resolveCurrencyAlias } from "@solve-js/uom/CurrencyAliases";
import { tryConsumeCurrencyOnDate, HISTORICAL_CURRENCY_FN_IDX } from "@solve-js/uom/HistoricalCurrency";

/**
 * Resolve `rawUnit` to its canonical ISO 4217 code if it's a recognized
 * currency WORD alias (e.g. "euros" -> "EUR"); otherwise return it
 * unchanged. Every other unit (km, grams, workdays, ...) passes straight
 * through untouched. This only ever fires for the specific word list in
 * `uom/CurrencyAliases.ts`'s `CURRENCY_WORD_ALIASES`.
 */
function resolveUnitAlias(rawUnit: string): string {
  return resolveCurrencyAlias(rawUnit) ?? rawUnit;
}

/**
 * A unit directly following a value, as in `5 km` or `100 cm`.
 *
 * Postfix binding power so the unit attaches to the number beside it rather
 * than to a surrounding expression: `2 * 3 km` is `2 * (3 km)`. Aliases resolve
 * through the shared table, so currency symbols and unit words agree.
 */
export class UomLiteralParselet implements InfixParselet {
	readonly category = "UoM";
	readonly bindingPower = BindingPower.Postfix;

  parse(parser: Parser, left: Token, token: Token, builder: BytecodeBuilder): void {
    const unit = resolveUnitAlias(token.value);
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(unit);

    // Swallow a trailing `to`/`in` inline ONLY when this unit literal is not the
    // right operand of a tighter operator. As the RHS of `*` or `/`, the `in` in
    // `120 km / 2 hours in kph` binds looser than the `/` and belongs to the
    // whole quotient, so it is left for the outer conversion parselet (IN, bound
    // at 35) rather than pulled onto `2 hours` here. See the parser's
    // infixMinBindingPower doc comment.
    const boundInsideProduct = parser.infixMinBindingPower >= BindingPower.Product;

    // Check if the next token is "to" or "in"
    if (!boundInsideProduct && (parser.peek()?.type === "TO" || parser.peek()?.type === "IN")) {
      parser.consume(); // consume TO or IN
      const targetToken = parser.peek();
      // Accept UNIT or IN (for cases like "3 ft in in" where
      // the target unit name collides with the IN keyword).
      if (targetToken?.type === "UNIT" || targetToken?.type === "IN") {
        parser.consume();
        const targetUnit = resolveUnitAlias(targetToken.value);

        // `<money> in <currency> on <date>`: a historical conversion through
        // the host-supplied rate provider, distinct from the live conversion
        // below. Only fires for two currencies followed by `on <date>`, so an
        // ordinary `100 km in miles` or a dateless `100 USD in GBP` consumes
        // nothing here and falls straight through. See uom/HistoricalCurrency.ts.
        const isoDate = tryConsumeCurrencyOnDate(parser, targetUnit, unit);
        if (isoDate !== null) {
          // The source unit was pushed above; fold it and the amount into a
          // currency Uom, then hand [amount, target, date] to the historical
          // plugin, which reads the source currency back off that Uom.
          builder.emitOpcode(OpCode.UOM_CONVERT);
          builder.emitOpcode(OpCode.PUSH_STRING);
          builder.emitString(targetUnit);
          builder.emitOpcode(OpCode.PUSH_STRING);
          builder.emitString(isoDate);
          builder.emitOpcode(OpCode.CALL_PLUGIN);
          builder.emitIndex(HISTORICAL_CURRENCY_FN_IDX);
          builder.emitIndex(3);
          return;
        }

        builder.emitOpcode(OpCode.PUSH_STRING);
        builder.emitString(targetUnit);
        builder.emitOpcode(OpCode.UOM_CONVERT_TO);
        return;
      }
      // "sourceUnit to ?", conversion-possibilities query (wiki:
      // Units-Of-Measurement, "Explore what units a particular unit can
      // be converted into"). The source unit name is already on the
      // stack from the PUSH_STRING above.
      if (targetToken?.type === "QUESTION") {
        parser.consume();
        builder.emitOpcode(OpCode.UOM_POSSIBILITIES);
        return;
      }
    }
    
    // Check if the next token is "best"
    if (parser.peek()?.type === "BEST") {
      parser.consume(); // consume BEST
      builder.emitOpcode(OpCode.UOM_BEST);
      return;
    }
    
    builder.emitOpcode(OpCode.UOM_CONVERT);
  }
}

export { isKnownUnit };
