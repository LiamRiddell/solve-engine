import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { VariableParselet } from "./parselets/VariableParselet";
import { IdentifierParselet } from "./parselets/IdentifierParselet";

/**
 * Variable read and write WITHIN one document: `:name = expr` to define,
 * `name` to read it back.
 *
 * Document-spanning variables are a separate package,
 * `solve-global-variables`, because they are a different level of
 * functionality: everything here stays inside the document being evaluated,
 * where `global :name` reaches outside it. Keeping them apart is what lets a
 * host refuse one without losing the other. See that package for the
 * reasoning.
 */
export const VARIABLES_PACKAGE: IEnginePackage = {
  name: "solve-variables",
  prefixParselets: {
    COLON: new VariableParselet(),
    IDENT: new IdentifierParselet(),
    // UNIT tokens in prefix position (standalone or after operators) are
    // resolved as variable references via LOAD_VAR, same as IDENT tokens.
    // This handles cases like `a + b` where "b" is classified as UNIT
    // because it collides with a known unit (e.g., "b" = bits).
    UNIT: new IdentifierParselet(),
  },
};
