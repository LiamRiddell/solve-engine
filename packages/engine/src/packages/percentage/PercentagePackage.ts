import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { PercentParselet } from "./parselets/PercentParselet";
import { IsWhatParselet } from "./parselets/IsWhatParselet";
import { OnOffBaseParselet } from "./parselets/OnOffBaseParselet";
import { percentOnOffNormalizerRule } from "./normalizer/PercentOnOffNormalizerRule";
import { OfParselet } from "./parselets/OfParselet";
import { OfWhatIsParselet } from "./parselets/OfWhatIsParselet";
import { OnOffWhatIsParselet } from "./parselets/OnOffWhatIsParselet";
import { IncreaseDecreaseParselet } from "./parselets/IncreaseDecreaseParselet";
import { IncreaseByParselet } from "./parselets/IncreaseByParselet";
import { PercentageChangeParselet } from "./parselets/PercentageChangeParselet";
import { UpDownParselet } from "./parselets/UpDownParselet";
import { percentUpDownNormalizerRule } from "./normalizer/PercentUpDownNormalizerRule";

/**
 * Percentage syntax: `50%`, `50% of 200`, `100 to 150` (percentage change),
 * `increase 100 by 10%`/`decrease 100 by 10%` (prefix form), the
 * `100 increase by 10%`/`100 decrease by 10%` infix form (fused from the
 * "increase by"/"decrease by" phrases by the built-in normalizer. See
 * BuiltinNormalizerRules.BUILTIN_PHRASES), and `5% of what is 6` (solve
 * for the base value. See OfWhatIsParselet.ts's doc comment). "of what
 * is" is phrase-fused (not a bare "what" keyword) for the same
 * variable-name-collision reason "total"/"average"/etc. are fused
 * elsewhere in this codebase, "what" is common enough to be worth
 * protecting as a `:variableName`.
 *
 * Successive change is `120 up 10% then down 10%` (118.80, not 120),
 * `50 up 20%`, `80 down 15%` and the repeat form `100 up 10% three times`.
 * `up`/`down` are retyped from a bare IDENT only when a percentage follows
 * (percentUpDownNormalizerRule), so prose keeps the words. See
 * UpDownParselet.ts.
 */
export const PERCENTAGE_PACKAGE: IEnginePackage = {
  name: "solve-percentage",
  phrases: {
    "of what is": "OF_WHAT_IS",
    // Fused so that parsing the rate cannot swallow the "of": it is an infix
    // operator in its own right ("10% of 200"), so a sub-expression would
    // consume it and the trailing "what" before this parselet ever looked.
    "of what": "OF_WHAT",
    "off what": "OFF_WHAT",
    "on what": "ON_WHAT",
    "on what is": "ON_WHAT_IS",
    "off what is": "OFF_WHAT_IS",
  },
  infixParselets: {
    PERCENT: new PercentParselet(),
    IS: new IsWhatParselet(),
    // "10% on 200" is 220 and "10% off 200" is 180: the percentage comes
    // first, the base second. The reverse of "200 + 10%".
    PCT_ON: new OnOffBaseParselet(1),
    PCT_OFF: new OnOffBaseParselet(-1),
    OF: new OfParselet(),
    OF_WHAT_IS: new OfWhatIsParselet(),
    ON_WHAT_IS: new OnOffWhatIsParselet(1),
    OFF_WHAT_IS: new OnOffWhatIsParselet(-1),
    TO: new PercentageChangeParselet(),
    INCREASE_BY: new IncreaseByParselet(1),
    DECREASE_BY: new IncreaseByParselet(-1),
    // Successive change: "120 up 10% then down 10%" is 118.80, not 120.
    PCT_UP: new UpDownParselet(1),
    PCT_DOWN: new UpDownParselet(-1),
  },
  prefixParselets: {
    INCREASE: new IncreaseDecreaseParselet(1),
    DECREASE: new IncreaseDecreaseParselet(-1),
  },
  normalizerRules: [
    percentOnOffNormalizerRule(),
    percentUpDownNormalizerRule(),
  ],
};
