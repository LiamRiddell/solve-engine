import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { CurrencySymbolParselet } from "./parselets/CurrencySymbolParselet";
import { InParselet } from "./parselets/InParselet";
import { CurrencyAsyncResolver } from "@solve-js/uom/CurrencyResolver";
import {
  HISTORICAL_CURRENCY_FN,
  createHistoricalCurrencyResolver,
  createHistoricalCurrencyPluginFunction,
} from "@solve-js/uom/HistoricalCurrency";
import { FRANKFURTER_HISTORICAL_PROVIDER, frankfurterHistoricalRateProvider } from "@solve-js/uom/FrankfurterHistoricalRates";
import type { HistoricalRateProvider } from "@solve-js/uom/HistoricalCurrency";
import type { CurrencyPackageConfig } from "./types";
import { suffixCurrencySymbolRule, prefixedDollarRule, randAmountRule } from "./normalizer/CurrencyInputRules";

/**
 * Currency: `$10`, `£10`, `€10`, `¥10`, `₽10`, `₩10`, `₹10`, `₺10`, `₴10`,
 * `₪10`, `₫10`, `₦10`, `₱10`, `10 USD in GBP`, `100 USD in GBP on 2024-01-15`,
 * and word forms like `10 euros`/`10 dollars` (see `uom/CurrencyAliases.ts` for
 * the full symbol/word alias tables and the ambiguity decisions behind them).
 *
 * Live rates are fetched asynchronously (via {@link CurrencyAsyncResolver}) and
 * the expression shows Pending until they resolve. The dated `on <date>` form
 * resolves through {@link CurrencyPackageConfig.historicalRateProvider}: the
 * built-in Frankfurter provider by default (the same endpoint as the live
 * rate, asked for a date; see `uom/FrankfurterHistoricalRates.ts`), the host's
 * own when it supplies one, and none when it passes `null`, which reports
 * `HISTORICAL_RATES_NOT_CONFIGURED` plainly rather than drifting to today's
 * rate (see `uom/HistoricalCurrency.ts`).
 *
 * **A factory, but still a default builtin.** Unlike stocks (no free provider,
 * so excluded from `BUILTIN_PACKAGES`), currency needs no configuration, so
 * {@link CURRENCY_PACKAGE} = `createCurrencyPackage()` ships as a default. A
 * host with its own historical source calls `createCurrencyPackage({ historicalRateProvider })`
 * and swaps the result in for the default in its `packages` array.
 */
export function createCurrencyPackage(config: CurrencyPackageConfig = {}): IEnginePackage {
  // The host's provider takes precedence; `null` switches the dated form off.
  const hostProvider = config.historicalRateProvider;
  const historicalProvider: HistoricalRateProvider | undefined =
    hostProvider === null ? undefined : (hostProvider ?? frankfurterHistoricalRateProvider);
  const historicalProviderName =
    hostProvider === undefined ? FRANKFURTER_HISTORICAL_PROVIDER : (config.historicalProviderName ?? "host");
  return {
    name: "solve-currency",
    asyncResolvers: [
      new CurrencyAsyncResolver(),
      createHistoricalCurrencyResolver(historicalProvider, historicalProviderName),
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
    // Currency as it is written after an amount, with its country before a
    // dollar, and the rand as the engine writes it (#693, #707).
    normalizerRules: [suffixCurrencySymbolRule(), prefixedDollarRule(), randAmountRule()],
    pluginFunctions: {
      // Historical conversions (`<money> in <currency> on <date>`) compile to a
      // CALL_PLUGIN at this shared index (see uom/HistoricalCurrency.ts). One
      // index serves every pair and date, the query is the amount plus the
      // target and date strings. The handler carries the same provider as the
      // resolver, so a source currency known only at runtime (`x in GBP on
      // <date>`) can fetch the rate the bytecode scan could not preflight.
      [HISTORICAL_CURRENCY_FN]: createHistoricalCurrencyPluginFunction(historicalProvider, historicalProviderName),
    },
  };
}

/**
 * The default currency package: live rates and historical rates, both from
 * Frankfurter.
 *
 * Kept as a named constant so existing imports and {@link BUILTIN_PACKAGES}
 * keep working unchanged; a host with its own historical source builds its own
 * via {@link createCurrencyPackage} and substitutes it in.
 */
export const CURRENCY_PACKAGE: IEnginePackage = createCurrencyPackage();
