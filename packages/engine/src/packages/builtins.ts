/**
 * Built-in packages.
 *
 * Each domain is a self-contained package (its own directory, its own
 * `{Domain}Package.ts` defining an IEnginePackage, its own `index.ts`
 * barrel), the same shape as third-party packages such as the OSRS
 * example in `src/solve-js/examples/osrs/`. This file's only job is to
 * assemble them into BUILTIN_PACKAGES; it re-exports each named package
 * too, since existing call sites import them directly from here.
 *
 * This enables:
 * - Selective disable of built-in packages
 * - External packages to replace/extend built-in ones
 */
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";

import { ARITHMETIC_PACKAGE } from "./arithmetic";
import { PERCENTAGE_PACKAGE } from "./percentage";
import { FUNCTION_PACKAGE } from "./function";
import { DATETIME_PACKAGE } from "./datetime";
import { TIME_PACKAGE } from "./time";
import { DICE_PACKAGE } from "./dice";
import { VARIABLES_PACKAGE } from "./variables";
import { UOM_PACKAGE } from "./uom";
import { CURRENCY_PACKAGE, createCurrencyPackage } from "./currency";
import { VECTOR_PACKAGE } from "./vector";
import { MATRIX_PACKAGE } from "./matrix";
import { MAPREDUCE_PACKAGE } from "./mapreduce";
import { SYMBOLIC_PACKAGE } from "./symbolic";
import { BIGINT_PACKAGE } from "./biginteger";
import { CONDITIONALS_PACKAGE } from "./conditionals";
import { CONVERTERS_PACKAGE } from "./converters";
import { MATHPHRASES_PACKAGE } from "./mathphrases";
import { FINANCE_PACKAGE } from "./finance";
import { UNCERTAINTY_PACKAGE } from "./uncertainty";
import { WEATHER_PACKAGE } from "./weather";
import { createStocksPackage } from "./stocks";
import { createKnowledgePackage } from "./knowledge";
import { LINES_PACKAGE } from "./lines";
import { GOALSEEK_PACKAGE } from "./goalseek";

export {
  ARITHMETIC_PACKAGE,
  PERCENTAGE_PACKAGE,
  FUNCTION_PACKAGE,
  DATETIME_PACKAGE,
  TIME_PACKAGE,
  DICE_PACKAGE,
  VARIABLES_PACKAGE,
  UOM_PACKAGE,
  CURRENCY_PACKAGE,
  VECTOR_PACKAGE,
  MATRIX_PACKAGE,
  MAPREDUCE_PACKAGE,
  SYMBOLIC_PACKAGE,
  BIGINT_PACKAGE,
  CONDITIONALS_PACKAGE,
  CONVERTERS_PACKAGE,
  MATHPHRASES_PACKAGE,
  FINANCE_PACKAGE,
  UNCERTAINTY_PACKAGE,
  WEATHER_PACKAGE,
  createStocksPackage,
  createCurrencyPackage,
  createKnowledgePackage,
  LINES_PACKAGE,
  GOALSEEK_PACKAGE,
};

// ── All built-in packages (registration order matters: arithmetic first) ──
// Note: OSRS is NOT a built-in package, it's a full worked example of
// writing a package with the framework (lexer plugin, async resolver, VM
// handler), kept in src/solve-js/examples/osrs/ rather than shipped as
// part of the engine. See ExpressionEngine's `packages` constructor
// parameter to register it (or any other package) alongside these.
//
// Of the three "Live Data" packages (weather/stocks/knowledge), only
// WEATHER_PACKAGE is included below. Open-Meteo (weather's provider) is
// genuinely free and keyless, no configuration burden on a host who
// doesn't want its network calls, who can filter it out of their own
// `packages` array. Stocks and Knowledge have no equivalent free provider
// (see their own module docs), unconfigured, `createStocksPackage()`/
// `createKnowledgePackage()` do nothing useful beyond returning an honest
// "not configured" error, so, matching OSRS's own precedent, they are
// exported but deliberately left OUT of BUILTIN_PACKAGES. A host that
// wants them calls the factory with their own fetch function/API key and
// adds the result to their ExpressionEngine's `packages` array directly.
/**
 * The packages an engine registers when the caller names none.
 *
 * Twenty-one of the twenty-three. Stocks and knowledge are excluded because
 * both need a host-supplied data source and do nothing useful without one, so
 * registering them by default would only produce NOT_CONFIGURED results.
 *
 * Pass a filtered copy to the {@link ExpressionEngine} constructor to opt out
 * of a feature, or add to it to register your own alongside the built-ins.
 */
export const BUILTIN_PACKAGES: IEnginePackage[] = [
  ARITHMETIC_PACKAGE,
  PERCENTAGE_PACKAGE,
  FUNCTION_PACKAGE,
  DATETIME_PACKAGE,
  TIME_PACKAGE,
  DICE_PACKAGE,
  VARIABLES_PACKAGE,
  UOM_PACKAGE,
  CURRENCY_PACKAGE,
  VECTOR_PACKAGE,
  MATRIX_PACKAGE,
  MAPREDUCE_PACKAGE,
  SYMBOLIC_PACKAGE,
  BIGINT_PACKAGE,
  CONDITIONALS_PACKAGE,
  CONVERTERS_PACKAGE,
  MATHPHRASES_PACKAGE,
  FINANCE_PACKAGE,
  UNCERTAINTY_PACKAGE,
  WEATHER_PACKAGE,
  LINES_PACKAGE,
  // After LINES_PACKAGE: goal seek's normalizer reads a LINE_REF the lines
  // rule mints, and its parselet targets a line reference.
  GOALSEEK_PACKAGE,
];
