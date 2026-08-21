import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { UomLiteralParselet } from "./parselets/UomLiteralParselet";
import { ConvertParselet } from "./parselets/ConvertParselet";
import { PossibilitiesParselet } from "./parselets/PossibilitiesParselet";
import { uomPossibilitiesNormalizerRule } from "./normalizer/PossibilitiesNormalizerRule";
import { compoundQuantityNormalizerRule } from "./normalizer/CompoundQuantityNormalizerRule";
import { twoUnitConversionNormalizerRule } from "./normalizer/TwoUnitConversionNormalizerRule";
import { degreeSymbolNormalizerRule } from "./normalizer/DegreeSymbolNormalizerRule";
import { TwoUnitConversionParselet } from "./parselets/TwoUnitConversionParselet";
import { bareRateDenominatorNormalizerRule } from "./normalizer/BareRateDenominatorNormalizerRule";
import { PerUnitParselet } from "./parselets/PerUnitParselet";
import { AtRateParselet } from "./parselets/AtRateParselet";
import { atRateNormalizerRule } from "./normalizer/AtRateNormalizerRule";
import { forDurationNormalizerRule } from "./normalizer/ForDurationNormalizerRule";
import { reversedConversionNormalizerRule } from "./normalizer/ReversedConversionNormalizerRule";
import { CookingConversionParselet } from "./parselets/CookingConversionParselet";
import { COOKING_CONVERT_IDX, cookingConvertHandler } from "./parselets/CookingPluginFunctions";
import { ingredientNameNormalizerRule } from "./normalizer/IngredientNameNormalizerRule";
import { multiWordUnitNormalizerRule } from "./normalizer/MultiWordUnitNormalizerRule";
import { compoundUnitNormalizerRule } from "./normalizer/CompoundUnitNormalizerRule";

/**
 * Units of measurement: `10 km`, `10 km to miles`, `convert 10 km to miles`,
 * `cm to ?` (conversion-possibilities query). See {@link CURRENCY_PACKAGE}
 * for money, which is a separate package.
 *
 * Also cooking/baking mass<->volume conversion (e.g. "300g butter in
 * cups", "10 cups olive oil in grams"). See
 * `parselets/CookingConversionParselet.ts`,
 * `normalizer/IngredientNameNormalizerRule.ts`, and
 * `data/IngredientDensities.ts` (the bundled, clearly-labeled-approximate
 * ingredient-density table and its scope/accuracy doc comment) for the
 * full design, including why US Customary is the only volume-unit
 * convention supported so far.
 */
export const UOM_PACKAGE: IEnginePackage = {
  name: "solve-uom",
  prefixParselets: [
    { tokenType: "CONVERT", parselet: new ConvertParselet() },
    { tokenType: "UOM_POSSIBILITIES_QUERY", parselet: new PossibilitiesParselet() },
  ],
  infixParselets: [
    { tokenType: "IN_TWO_UNITS", parselet: new TwoUnitConversionParselet(94) },
    { tokenType: "PER_UNIT", parselet: new PerUnitParselet(95) },
    { tokenType: "AT_RATE", parselet: new AtRateParselet(96) },
    { tokenType: "UNIT", parselet: new UomLiteralParselet() },
    { tokenType: "INGREDIENT_NAME", parselet: new CookingConversionParselet() },
  ],
  normalizerRules: [
    // Highest priority of the unit rules: a two-word spelling has to become one
    // token before anything else reads the first word as a unit on its own.
    multiWordUnitNormalizerRule(),
    // Above the bare-denominator rule (75): a slash-notation compound unit like
    // `km/h` is claimed whole before the slash is read as a bare denominator.
    compoundUnitNormalizerRule(),
    uomPossibilitiesNormalizerRule(),
    compoundQuantityNormalizerRule(),
    twoUnitConversionNormalizerRule(),
    degreeSymbolNormalizerRule(),
    atRateNormalizerRule(),
    forDurationNormalizerRule(),
    bareRateDenominatorNormalizerRule(),
    reversedConversionNormalizerRule(),
    ingredientNameNormalizerRule(),
  ],
  pluginFunctions: [
    { index: COOKING_CONVERT_IDX, handler: cookingConvertHandler },
  ],
};
