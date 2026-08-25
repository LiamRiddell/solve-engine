import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { UncertaintyParselet } from "./parselets/UncertaintyParselet";
import { asciiPlusMinusNormalizerRule } from "./normalizer/AsciiPlusMinusNormalizerRule";

/**
 * Uncertainty propagation: a measurement that carries a one-sigma tolerance,
 * written `a ± b` or the ASCII `a +/- b`, propagated through `+`, `-`, `*`, `/`
 * for independent errors combined in quadrature.
 *
 * The `±` symbol is lexed directly; the ASCII spelling is fused by the
 * normalizer rule. Both reach the one infix parselet, which emits
 * MAKE_UNCERTAIN. Correlated errors are out of scope (a much larger problem);
 * a comparison or transcendental function reads the center and drops the
 * tolerance. See `vm/VMConversion.ts`'s uncertainOp for the propagation rules.
 */
export const UNCERTAINTY_PACKAGE: IEnginePackage = {
  name: "solve-uncertainty",
  infixParselets: {
    PLUS_MINUS: new UncertaintyParselet(),
  },
  normalizerRules: [asciiPlusMinusNormalizerRule()],
  // PLUS_MINUS is a core lexer token, so its highlight category lives in the
  // built-in language/TokenCategoryMap.ts rather than being contributed here.
};
