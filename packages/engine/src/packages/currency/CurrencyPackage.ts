import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { CurrencySymbolParselet } from "./parselets/CurrencySymbolParselet";
import { InParselet } from "./parselets/InParselet";
import { CurrencyAsyncResolver } from "@solve-js/uom/CurrencyResolver";
import {
  HISTORICAL_CURRENCY_FN,
  createHistoricalCurrencyResolver,
  createHistoricalCurrencyPluginFunction,
} from "@solve-js/uom/HistoricalCurrency";
import type { CurrencyPackageConfig } from "./types";

/**
 * Currency: `$10`, `£10`, `€10`, `¥10`, `₽10`, `₩10`, `₹10`, `₺10`, `₴10`,
 * `₪10`, `₫10`, `₦10`, `₱10`, `10 USD in GBP`, `100 USD in GBP on 2024-01-15`,
 * and word forms like `10 euros`/`10 dollars` (see `uom/CurrencyAliases.ts` for
 * the full symbol/word alias tables and the ambiguity decisions behind them).
 *
 * Live rates are fetched asynchronously (via {@link CurrencyAsyncResolver}) and
 * the expression shows Pending until they resolve. The dated `on <date>` form
 * resolves through a HOST-SUPPLIED {@link CurrencyPackageConfig.historicalRateProvider}
 * instead, unconfigured, it reports `HISTORICAL_RATES_NOT_CONFIGURED` plainly
 * rather than drifting to today's rate (see `uom/HistoricalCurrency.ts`).
 *
 * **A factory, but still a default builtin.** Unlike stocks (no free provider,
 * so excluded from `BUILTIN_PACKAGES`), the LIVE half of currency needs no
 * configuration, so {@link CURRENCY_PACKAGE} = `createCurrencyPackage()` ships
 * as a default. The historical resolver is registered either way, so the
 * grammar always recognises `on <date>` and answers the not-configured case
 * honestly; supplying a provider is what turns that error into a real rate. A
 * host wanting historical conversion calls `createCurrencyPackage({ historicalRateProvider })`
 * and swaps the result in for the default in its `packages` array.
 */
export function createCurrencyPackage(config: CurrencyPackageConfig = {}): IEnginePackage {
  return {
    name: "solve-currency",
    asyncResolvers: [
      new CurrencyAsyncResolver(),
      createHistoricalCurrencyResolver(config.historicalRateProvider),
    ],
    prefixParselets: {
      DOLLAR: new CurrencySymbolParselet(),
      POUND: new CurrencySymbolParselet(),
      EURO: new CurrencySymbolParselet(),
      YEN: new CurrencySymbolParselet(),
      RUBLE: new CurrencySymbolParselet(),
      WON: new CurrencySymbolParselet(),
      // Every currency symbol added after the original six above shares this
      // one generic token type. See Token.ts's CURRENCY_SYMBOL doc comment.
      CURRENCY_SYMBOL: new CurrencySymbolParselet(),
    },
    infixParselets: {
      IN: new InParselet(),
    },
    pluginFunctions: {
      // Historical conversions (`<money> in <currency> on <date>`) compile to a
      // CALL_PLUGIN at this shared index (see uom/HistoricalCurrency.ts). One
      // index serves every pair and date, the query is the amount plus the
      // target and date strings. The handler carries the same provider as the
      // resolver, so a source currency known only at runtime (`x in GBP on
      // <date>`) can fetch the rate the bytecode scan could not preflight.
      [HISTORICAL_CURRENCY_FN]: createHistoricalCurrencyPluginFunction(config.historicalRateProvider),
    },
  };
}

/**
 * The default currency package, live rates configured, historical rates NOT.
 *
 * Kept as a named constant so existing imports and {@link BUILTIN_PACKAGES}
 * keep working unchanged, a host wanting historical conversion builds its own
 * via {@link createCurrencyPackage} and substitutes it in.
 */
export const CURRENCY_PACKAGE: IEnginePackage = createCurrencyPackage();
