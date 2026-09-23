import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { isKnownUnit } from "@solve-js/lexer/units";
import { resolveCurrencyAlias } from "@solve-js/uom/CurrencyAliases";
import { tryConsumeCurrencyOnDate, HISTORICAL_CURRENCY_FN } from "@solve-js/uom/HistoricalCurrency";
import { poweredUnit } from "@solve-js/uom/UnitPowers";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

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
 * Take a power written on a unit onto the unit itself. Called when the token
 * after the unit is `^`.
 *
 * The power belongs to the unit, not to the number beside it: `5 m^2` is five
 * square metres, not (5 m) squared, which is 25 square metres. The unit literal
 * binds tighter than `^`, so without this the parser built `(5 m)^2` and the
 * power handler, which had no reading for a unit, answered a bare 25. Taking the
 * power here gives `m2`, a unit the table already holds, and everything after it
 * (a conversion, `best`) carries on as for any area or volume.
 *
 * Only a whole power of 2 or 3 on a length the table spells squared or cubed has
 * a unit, so that is all this accepts; a power of 1 leaves the unit as it is.
 * Anything else written on a unit (`5 kg^2`, `5 m^4`, `9.81 ft/s^2`) is refused
 * by name here, where the reading is still known, rather than left to become the
 * number squared.
 */
function takeUnitPower(parser: Parser, unit: string): string {
  const exponent = parser.peekAt(1);
  const power = exponent?.type === "NUMBER" ? Number(exponent.value) : Number.NaN;
  const spelled = power === 1 ? unit : poweredUnit(unit, power);
  if (spelled === undefined) {
    throw ErrorFactory.parsing(
      "UNIT_POWER_UNSUPPORTED",
      `"${unit}^${exponent?.value ?? ""}" is not a unit: a power on a unit makes an area or a volume, so it applies only to a length the unit table spells squared or cubed, such as m^2 or ft^3.`,
      { unit, exponent: exponent?.value },
    );
  }
  parser.consume(); // ^
  parser.consume(); // the power
  return spelled;
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
    let unit = resolveUnitAlias(token.value);
    if (parser.peek()?.type === "CARET") unit = takeUnitPower(parser, unit);
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(unit);

    // Swallow a trailing `to`/`in` inline ONLY when this unit literal is not the
    // right operand of a tighter operator. As the RHS of `*` or `/`, the `in` in
    // `120 km / 2 hours in kph` binds looser than the `/` and belongs to the
    // whole quotient, so it is left for the outer conversion parselet (IN, bound
    // at 35) rather than pulled onto `2 hours` here. See the parser's
    // infixMinBindingPower doc comment.
    const boundInsideProduct = parser.infixMinBindingPower >= BindingPower.Product;

    // Check if the next token is "to" or "in", followed by something this
    // parselet can take as the target: a unit, `in` itself (for "3 ft in in",
    // where the inch collides with the keyword), `?`, or `best` (for
    // "500 lux to best", handled by the `best` branch below once the `to` is
    // taken). Any other target is left alone, `to`/`in` included, for the
    // outer conversion parselet, which reads a target the lexer did not mark
    // as a unit: `L` is not a lexer unit, so `1 m3 in L` used to consume the
    // `in` here and then fail on the `L`.
    const conversion = parser.peek()?.type;
    const targetAhead = parser.peekAt(1)?.type;
    const takesTarget = targetAhead === "UNIT" || targetAhead === "IN" || targetAhead === "QUESTION" || targetAhead === "BEST";
    if (!boundInsideProduct && (conversion === "TO" || conversion === "IN") && takesTarget) {
      parser.consume(); // consume TO or IN
      const targetToken = parser.peek();
      // Accept UNIT or IN (for cases like "3 ft in in" where
      // the target unit name collides with the IN keyword).
      if (targetToken?.type === "UNIT" || targetToken?.type === "IN") {
        parser.consume();
        let targetUnit = resolveUnitAlias(targetToken.value);
        // A power on the target is the target's, as on the source: `15 ft2 in m^2`.
        if (parser.peek()?.type === "CARET") targetUnit = takeUnitPower(parser, targetUnit);

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
          builder.emitPluginCall(HISTORICAL_CURRENCY_FN, 3);
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
