/**
 * Reading a power written on a unit, `m^2` or `kg/m^3`, as part of the unit.
 * Shared by the unit literal and the `in` conversion, so a target takes a
 * power the way a source does.
 */

import type { Parser } from "@solve-js/parser/Parser";
import { poweredUnit, poweredRateUnit } from "@solve-js/uom/UnitPowers";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

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
 * a unit, so that is all this accepts, on its own (`m^2`) or after a slash
 * (`kg/m^3`, and the squared time of an acceleration, `ft/s^2`; see
 * `poweredRateUnit`); a power of 1 leaves the unit as it is. Anything else
 * written on a unit (`5 kg^2`, `5 m^4`, `5 kg/s^2`) is refused by name here,
 * where the reading is still known, rather than left to become the number
 * squared.
 *
 * @param parser - The parser, with the `^` as its next token.
 * @param unit - The unit the power is written on.
 * @returns The powered unit spelling.
 * @throws `UNIT_POWER_UNSUPPORTED` when the power makes no unit.
 */
export function takeUnitPower(parser: Parser, unit: string): string {
  const exponent = parser.peekAt(1);
  const power = exponent?.type === "NUMBER" ? Number(exponent.value) : Number.NaN;
  const spelled = power === 1 ? unit : (poweredRateUnit(unit, power) ?? poweredUnit(unit, power));
  if (spelled === undefined) {
    throw ErrorFactory.parsing(
      "UNIT_POWER_UNSUPPORTED",
      unit.includes("/")
        ? `"${unit}^${exponent?.value ?? ""}" is not a unit: a power after a slash applies to the unit after it, which must be a length the unit table spells squared or cubed (kg/m^3), or the time of an acceleration, squared (ft/s^2).`
        : `"${unit}^${exponent?.value ?? ""}" is not a unit: a power on a unit makes an area or a volume, so it applies only to a length the unit table spells squared or cubed, such as m^2 or ft^3.`,
      { unit, exponent: exponent?.value },
    );
  }
  parser.consume(); // ^
  parser.consume(); // the power
  return spelled;
}
