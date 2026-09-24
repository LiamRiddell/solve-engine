/**
 * Production-grade currency exchange service with scalable architecture
 * Integrates with DataQueryService for worker-based execution
 */

import { isIso4217 } from "@solve-js/uom/Iso4217";
import { createTimeoutSignal } from "@solve-js/utilities/TimeoutSignal";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { SourceKind, ValueSource } from "@solve-js/vm/Provenance";

/**
 * The provider name the engine records for rates it fetched itself from
 * Frankfurter (European Central Bank reference rates). See {@link ValueSource}.
 */
export const FRANKFURTER_PROVIDER = "Frankfurter";

/** The provider name the engine records for crypto prices it fetched itself from CoinGecko. */
export const COINGECKO_PROVIDER = "CoinGecko";

/**
 * The provider name recorded for a table a host primed without naming one.
 * A host that knows where its rates came from passes `provider` to
 * {@link CurrencyExchangeService.primeRates} instead.
 */
export const PRIMED_RATES_PROVIDER = "host";

/**
 * Options for {@link CurrencyExchangeService.primeRates}: where the rates came
 * from, so a conversion that uses them can say so.
 */
export interface PrimeRatesOptions {
  /** The provider's name, recorded on every conversion that uses this table. Defaults to {@link PRIMED_RATES_PROVIDER}. */
  provider?: string;
  /**
   * When the host's rates were published, in epoch milliseconds. Recorded as
   * the source's `fetchedAt`. Defaults to the moment of priming. It does not
   * move the freshness window, which always runs from the moment of priming.
   */
  publishedAt?: number;
}

/**
 * One cached rate table: every rate a provider returned for one base currency,
 * when it arrived, and the provenance record a conversion through it carries.
 */
interface RateTable {
  /** When the table was stored, for the freshness window. */
  fetchedAt: number;
  rates: Record<string, number>;
  /** Who supplied the table and how, without a subject; see {@link pairSources}. */
  source: Omit<ValueSource, "subject">;
  /** The per-pair record lists handed out so far, so a repeated conversion allocates nothing. */
  pairSources: Map<string, readonly ValueSource[]>;
}

/** Build a table with its provenance record. */
function rateTable(rates: Record<string, number>, provider: string, kind: SourceKind, storedAt: number, publishedAt?: number): RateTable {
  return {
    fetchedAt: storedAt,
    rates,
    source: { provider, kind, fetchedAt: publishedAt ?? storedAt },
    pairSources: new Map(),
  };
}

/**
 * Error codes for this service. Co-located rather than unioned into
 * `errors/ErrorCode.ts`'s core catalog (that catalog is scoped to the
 * parser/VM/engine/errors/config/lexer layers, not yet the ~17 domain
 * packages. See that file's module doc for the intended per-package
 * pattern this follows).
 */
export const CurrencyErrorCodes = {
  /** Frankfurter's rates endpoint returned a non-OK HTTP status. */
  API_ERROR: "CURRENCY_API_ERROR",
  /** A requested currency/crypto code isn't in the fetched rate table, an unrecognized code, not an API failure. */
  UNKNOWN_CODE: "UNKNOWN_CURRENCY_CODE",
  /** CoinGecko's simple-price endpoint returned a non-OK HTTP status. */
  CRYPTO_API_ERROR: "CRYPTO_PRICE_API_ERROR",
} as const;

// ============================================================================
// CURRENCY EXCHANGE SERVICE
// ============================================================================

/**
 * Caches exchange rates fetched from an external source.
 *
 * Rates are global market data rather than per-engine configuration, which is
 * why one instance is shared. Two engines with private copies would fetch the
 * same endpoint twice and could disagree about one pair at one moment. See
 * `engine/EngineContext.ts`.
 */
export class CurrencyExchangeService {
  /**
   * Live rate tables cached from successful getRate() fetches, keyed by
   * uppercase base currency. Each table holds every rate the API returned
   * for that base (plus the base itself at 1), so any pair whose two codes
   * appear in one fresh table can be served synchronously, including
   * cross pairs via triangulation (EUR→GBP through a USD-base table).
   * Stale tables are ignored, not evicted; the next successful fetch for
   * the same base overwrites them.
   */
  private baseTables: Map<string, RateTable> = new Map();

  /**
   * How long a fetched rate may be served synchronously by getRateSync().
   * Beyond this window callers fall through to the async path (expression
   * shows Pending until the fetch lands).
   */
  private static readonly RATE_FRESHNESS_MS = 15 * 60 * 1000;

  /**
   * Ticker → CoinGecko coin id, for the cryptocurrencies `isCurrency()`
   * recognizes. Frankfurter (the fiat rate source below) is ECB reference
   * rates only and has no concept of BTC/ETH/etc, routing a crypto code
   * through it as `base=BTC` fails outright, which is why crypto pairs
   * previously never resolved (see CurrencyAsyncResolver/VM.ts's ADD
   * handling for the two bugs that let that failure pass silently instead
   * of surfacing as a real fetch).
   */
  private static readonly CRYPTO_IDS: Record<string, string> = {
    BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple",
    ADA: "cardano", DOGE: "dogecoin", DOT: "polkadot",
  };

  private isCryptoCode(code: string): boolean {
    // An own-property check, not `in`: `in` also answers for everything on
    // Object.prototype, so a code spelt like an inherited name would pass.
    return Object.prototype.hasOwnProperty.call(CurrencyExchangeService.CRYPTO_IDS, code.toUpperCase());
  }

  /**
   * Remembered {@link isCurrency} answers, keyed by the spelling asked about.
   *
   * The VM asks this question on every unit-bearing instruction (a `UOM_CONVERT`
   * for `5 kg`, a `MUL` of money by a count, a `DIV` of two quantities), and each
   * ask used to upper-case the code twice and probe two tables. The answer never
   * changes for a given spelling: the ISO 4217 set and {@link CRYPTO_IDS} are
   * both fixed for the life of the process, so remembering it is safe and the
   * ask becomes one map read. Keyed by the raw spelling rather than its
   * upper-cased form so the hot path allocates nothing.
   */
  private readonly currencyAnswers = new Map<string, boolean>();

  /**
   * How many spellings the cache will hold before it is emptied.
   *
   * A document's unit vocabulary is small and closed, so an ordinary run never
   * comes near this. The bound exists for the public `./vm` surface, where a
   * host can hand `UOM_CONVERT` any string it likes; emptying rather than
   * evicting keeps the miss path free of bookkeeping.
   */
  private static readonly MAX_REMEMBERED_CODES = 4096;

  constructor() {}

  // ------------------------------------------------------------------------
  // RATE FETCHING
  // ------------------------------------------------------------------------

  /**
   * Timeout (ms) for currency exchange rate fetches.
   *
   * If the frankfurter API doesn't respond within this window, the fetch
   * is aborted, preventing indefinite "Pending" states in the playground
   * and Obsidian plugin when the exchange rate API is unreachable.
   */
  private static readonly FETCH_TIMEOUT_MS = 10_000;

  /**
   * Fetch the live exchange rate for converting 1 unit of `from` into `to`.
   *
   * Routes cryptocurrency codes (see {@link CRYPTO_IDS}) to CoinGecko and
   * everything else to Frankfurter (ECB reference rates, fiat-only). On
   * success, caches the whole returned rate table for `from` so subsequent
   * lookups, including cross-pairs via triangulation, can be served
   * synchronously by {@link getRateSync} within the freshness window.
   *
   * @throws If the currency code is unrecognized or the fetch fails/times out.
   */
  async getRate(from: string, to: string, signal?: AbortSignal): Promise<number> {
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();

    if (this.isCryptoCode(fromUpper) || this.isCryptoCode(toUpper)) {
      return this.getCryptoRate(fromUpper, toUpper, signal);
    }

    // Combine the caller's optional abort signal with a hard timeout so a
    // hanging currency API never blocks re-evaluation indefinitely.
    const { signal: fetchSignal, cleanup } = createTimeoutSignal(
      signal,
      CurrencyExchangeService.FETCH_TIMEOUT_MS,
      "Currency API fetch",
    );

    try {
      // Built with URLSearchParams rather than interpolated. The code is
      // ISO-4217 by the time it gets here, but the query should be safe on
      // its own terms rather than by relying on a check that lives elsewhere.
      const query = new URLSearchParams({ base: fromUpper });
      const response = await fetch(`https://api.frankfurter.dev/v2/rates?${query.toString()}`, { signal: fetchSignal });
      if (!response.ok) throw ErrorFactory.external(CurrencyErrorCodes.API_ERROR, `Currency API returned ${response.status}`, { status: response.status });
      const data = await response.json();
      // The v2 endpoint returns a flat array of { date, base, quote, rate }
      // entries (one per target currency) rather than the classic v1 shape
      // { base, date, rates: { CODE: rate } }. Reading data.rates against
      // the real response is always undefined, so every conversion used to
      // throw "Unknown currency" no matter which currencies were requested.
      // Accept both shapes so a future API revision back to the object form
      // doesn't silently break this again.
      const rates: Record<string, number> = Array.isArray(data)
        ? Object.fromEntries(
            data
              .filter((entry: unknown): entry is { quote: string; rate: number } => {
                if (typeof entry !== "object" || entry === null) return false;
                const candidate = entry as { quote?: unknown; rate?: unknown };
                return typeof candidate.quote === "string" && typeof candidate.rate === "number";
              })
              .map((entry: { quote: string; rate: number }) => [entry.quote.toUpperCase(), entry.rate])
          )
        : (data.rates ?? {});
      if (rates[toUpper] === undefined) throw ErrorFactory.validation(CurrencyErrorCodes.UNKNOWN_CODE, `Unknown currency: ${toUpper}`, { code: toUpper });

      // The API returns ALL rates for the base currency, cache the whole
      // table so subsequent conversions (including cross pairs via
      // triangulation) resolve synchronously within the freshness window
      // instead of going Pending again.
      this.baseTables.set(fromUpper, rateTable({ ...rates, [fromUpper]: 1 }, FRANKFURTER_PROVIDER, "live", Date.now()));

      return rates[toUpper];
    } finally {
      cleanup();
    }
  }

  /**
   * Crypto rate fetch, routed through CoinGecko's no-auth simple-price
   * endpoint instead of Frankfurter (fiat-only, has no BTC/ETH concept).
   * Handles all three combinations, crypto→crypto, crypto→fiat
   * fiat→crypto, via prices denominated in USD (or the target fiat
   * directly, which CoinGecko's `vs_currencies` also accepts), then
   * caches the result as a same-shaped base table so getRateSync /
   * convertSync keep working unchanged for crypto pairs too.
   */
  private async getCryptoRate(fromUpper: string, toUpper: string, signal?: AbortSignal): Promise<number> {
    const { signal: fetchSignal, cleanup } = createTimeoutSignal(
      signal,
      CurrencyExchangeService.FETCH_TIMEOUT_MS,
      "Crypto price API fetch",
    );

    try {
      const fromIsCrypto = this.isCryptoCode(fromUpper);
      const toIsCrypto = this.isCryptoCode(toUpper);
      let rate: number;

      if (fromIsCrypto && toIsCrypto) {
        const fromId = CurrencyExchangeService.CRYPTO_IDS[fromUpper];
        const toId = CurrencyExchangeService.CRYPTO_IDS[toUpper];
        const data = await this.fetchCoinGeckoPrices([fromId, toId], "usd", fetchSignal);
        const fromUsd = data[fromId]?.usd;
        const toUsd = data[toId]?.usd;
        if (typeof fromUsd !== "number") throw ErrorFactory.validation(CurrencyErrorCodes.UNKNOWN_CODE, `Unknown currency: ${fromUpper}`, { code: fromUpper });
        if (typeof toUsd !== "number") throw ErrorFactory.validation(CurrencyErrorCodes.UNKNOWN_CODE, `Unknown currency: ${toUpper}`, { code: toUpper });
        rate = fromUsd / toUsd;
      } else if (fromIsCrypto) {
        const fromId = CurrencyExchangeService.CRYPTO_IDS[fromUpper];
        const vs = toUpper.toLowerCase();
        const data = await this.fetchCoinGeckoPrices([fromId], vs, fetchSignal);
        const value = data[fromId]?.[vs];
        if (typeof value !== "number") throw ErrorFactory.validation(CurrencyErrorCodes.UNKNOWN_CODE, `Unknown currency: ${toUpper}`, { code: toUpper });
        rate = value;
      } else {
        const toId = CurrencyExchangeService.CRYPTO_IDS[toUpper];
        const vs = fromUpper.toLowerCase();
        const data = await this.fetchCoinGeckoPrices([toId], vs, fetchSignal);
        const priceOfToInFrom = data[toId]?.[vs];
        if (typeof priceOfToInFrom !== "number") throw ErrorFactory.validation(CurrencyErrorCodes.UNKNOWN_CODE, `Unknown currency: ${fromUpper}`, { code: fromUpper });
        rate = 1 / priceOfToInFrom;
      }

      // Cache as a single-pair base table, same shape Frankfurter fetches
      // produce, so getRateSync/convertSync's triangulation logic doesn't
      // need to know or care which source a rate came from.
      this.baseTables.set(fromUpper, rateTable({ [fromUpper]: 1, [toUpper]: rate }, COINGECKO_PROVIDER, "live", Date.now()));

      return rate;
    } finally {
      cleanup();
    }
  }

  private async fetchCoinGeckoPrices(ids: string[], vsCurrency: string, signal: AbortSignal): Promise<Record<string, Record<string, number>>> {
    const query = new URLSearchParams({ ids: ids.join(","), vs_currencies: vsCurrency });
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?${query.toString()}`, { signal });
    if (!response.ok) throw ErrorFactory.external(CurrencyErrorCodes.CRYPTO_API_ERROR, `Crypto price API returned ${response.status}`, { status: response.status });
    return response.json();
  }

  /**
   * Seed a base rate table without a network fetch.
   *
   * Intended for tests and for a host's own offline rates; the engine's
   * own live data comes from {@link getRate}. Seeded rates obey the same
   * freshness window as fetched ones.
   *
   * A conversion through a primed table records it as a `primed` source (see
   * `vm/Provenance.ts`), named by `options.provider` so a host can say whose
   * rates they are.
   *
   * @param base - Base currency code (e.g. "USD").
   * @param rates - Map of currency code → rate relative to the base.
   * @param options - The provider's name and when its rates were published.
   */
  primeRates(base: string, rates: Record<string, number>, options: PrimeRatesOptions = {}): void {
    const baseUpper = base.toUpperCase();
    this.baseTables.set(
      baseUpper,
      rateTable({ ...rates, [baseUpper]: 1 }, options.provider ?? PRIMED_RATES_PROVIDER, "primed", Date.now(), options.publishedAt),
    );
  }

  /**
   * Drop every cached/primed rate table.
   *
   * Mainly for test isolation: {@link sharedCurrencyExchange} is a
   * module-level singleton, so a rate primed or fetched by one test can
   * silently leak into a later test in the same file. Also usable in
   * production if a caller ever wants to force a full re-fetch.
   */
  clearRates(): void {
    this.baseTables.clear();
  }

  /**
   * Synchronous rate lookup: `1` for same-currency pairs, a cached LIVE
   * rate if one was fetched within {@link RATE_FRESHNESS_MS}, otherwise
   * `null`, callers fall through to the async fetch path and the
   * expression shows Pending until real data arrives.
   *
   * There is deliberately no hardcoded fallback table: a stale made-up
   * rate presented as a real conversion is worse than a Pending state.
   */
  getRateSync(from: string, to: string): number | null {
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();
    if (fromUpper === toUpper) {
      return 1;
    }
    const now = Date.now();
    for (const table of this.baseTables.values()) {
      if (now - table.fetchedAt > CurrencyExchangeService.RATE_FRESHNESS_MS) continue;
      const fromRate = table.rates[fromUpper];
      const toRate = table.rates[toUpper];
      if (fromRate && toRate) {
        return toRate / fromRate;
      }
    }
    return null;
  }

  /**
   * Where the rate {@link getRateSync} would use for this pair came from.
   *
   * The same lookup, in the same order, so the record always describes the
   * table that actually served the conversion. `undefined` for a same-currency
   * pair (no rate is involved) and for a pair no fresh table covers (the
   * conversion has no rate either, and reports that itself).
   *
   * The list for one pair from one table is built once and handed out again,
   * so converting the same pair on every keystroke allocates nothing.
   *
   * @returns A one-record list naming the provider, how the rate was obtained,
   * when, and the pair as `FROM/TO`.
   */
  rateSourcesSync(from: string, to: string): readonly ValueSource[] | undefined {
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();
    if (fromUpper === toUpper) return undefined;
    const now = Date.now();
    for (const table of this.baseTables.values()) {
      if (now - table.fetchedAt > CurrencyExchangeService.RATE_FRESHNESS_MS) continue;
      if (table.rates[fromUpper] && table.rates[toUpper]) {
        const subject = `${fromUpper}/${toUpper}`;
        let sources = table.pairSources.get(subject);
        if (sources === undefined) {
          sources = Object.freeze([Object.freeze({ ...table.source, subject })]);
          table.pairSources.set(subject, sources);
        }
        return sources;
      }
    }
    return undefined;
  }

  /** Convert `value` from `from` to `to` using a freshly-fetched live rate (see {@link getRate}). */
  async convert(value: number, from: string, to: string): Promise<number> {
    const rate = await this.getRate(from, to);
    return value * rate;
  }

  /**
   * Get all currently cached fresh rates, keyed "FROM:TO".
   * @returns Snapshot of fresh live rates, or null when none are cached.
   */
  getAllRates(): Record<string, number> | null {
    const now = Date.now();
    const snapshot: Record<string, number> = {};
    let any = false;
    for (const [base, table] of this.baseTables) {
      if (now - table.fetchedAt > CurrencyExchangeService.RATE_FRESHNESS_MS) continue;
      for (const [code, rate] of Object.entries(table.rates)) {
        snapshot[`${base}:${code}`] = rate;
        any = true;
      }
    }
    return any ? snapshot : null;
  }

  /**
   * Check whether any fresh live rates are currently cached.
   */
  hasRates(): boolean {
    return this.getAllRates() !== null;
  }

  /**
   * Synchronous conversion using cached rates only
   * Returns null if rate not in cache
   */
  convertSync(value: number, from: string, to: string): number | null {
    const rate = this.getRateSync(from, to);
    if (rate === null) return null;
    return value * rate;
  }

  // ------------------------------------------------------------------------
  // CURRENCY VALIDATION
  // ------------------------------------------------------------------------

  /**
   * Check whether `code` is a recognized currency code: any active ISO 4217
   * code, or one of the cryptocurrencies in {@link CRYPTO_IDS}.
   *
   * This used to be a hand-written list of forty-six codes, which meant
   * `$100 in UAH` returned an unconverted hundred dollars rather than saying
   * it could not convert. Answering from the standard rather than from
   * whichever codes happened to get added is what stops that class of bug.
   *
   * Recognising a code is not the same as having a rate for it. That is
   * answered later, by the exchange provider; conflating the two is what
   * produced the silent failure.
   *
   * Remembered per spelling (see {@link currencyAnswers}), because the VM asks
   * on every unit-bearing instruction and the answer for a spelling never
   * changes.
   */
  isCurrency(code: string): boolean {
    // Every recognised code is three or four letters (ISO 4217 is exactly
    // three, the crypto tickers three or four), so any other length is plainly
    // not money and is answered without touching either table or the cache.
    const length = code.length;
    if (length < 3 || length > 4) return false;
    const remembered = this.currencyAnswers.get(code);
    if (remembered !== undefined) return remembered;
    const answer = isIso4217(code) || this.isCryptoCode(code);
    if (this.currencyAnswers.size >= CurrencyExchangeService.MAX_REMEMBERED_CODES) this.currencyAnswers.clear();
    this.currencyAnswers.set(code, answer);
    return answer;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/** The shared rate cache. See {@link CurrencyExchangeService} for why it is shared. */
export const currencyExchangeService = new CurrencyExchangeService();

// Export for backward compatibility
/** Alias for {@link currencyExchangeService}, kept for older imports. */
export const sharedCurrencyExchange = currencyExchangeService;

// Default export
export default currencyExchangeService;
