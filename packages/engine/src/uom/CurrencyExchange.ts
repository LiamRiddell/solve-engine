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
  /** The base currency the rates are relative to, upper case. */
  base: string;
  /** When the table was stored, for the freshness window. */
  fetchedAt: number;
  rates: Record<string, number>;
  /** Who supplied the table and how, without a subject; see {@link pairSources}. */
  source: Omit<ValueSource, "subject">;
  /** The per-pair record lists handed out so far, so a repeated conversion allocates nothing. */
  pairSources: Map<string, readonly ValueSource[]>;
}

/** Build a table with its provenance record. */
function rateTable(base: string, rates: Record<string, number>, provider: string, kind: SourceKind, storedAt: number, publishedAt?: number): RateTable {
  return {
    base,
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
   * Rate tables cached from successful getRate() fetches and from primeRates(),
   * one per source: keyed by provider, kind and base currency, and for a
   * single-pair crypto fetch by the pair as well (see {@link tableKey}). Each
   * table holds every rate its source returned for that base (plus the base
   * itself at 1), so any pair whose two codes appear in one fresh table can be
   * served synchronously, including cross pairs via triangulation (EUR→GBP
   * through a USD-base table).
   *
   * They used to be keyed by base currency alone, so each store replaced
   * whatever table that base had, from any source (#649). A note converting
   * `$100 in EUR` and `$100 in BTC` fetched Frankfurter's USD table and
   * CoinGecko's USD→BTC pair, and whichever landed second replaced the other:
   * one of the two lines went on reporting CURRENCY_RATE_UNAVAILABLE, and a
   * host's primed table was lost to the first live fetch for its base. Now each
   * source keeps its own table, a fetch replaces only its own source's table
   * for that base, and a pair two fresh tables both cover is served by the rule
   * the single table per base gave (see {@link freshTableFor}). A table past the
   * freshness window is dropped when the next one is stored.
   */
  private baseTables: Map<string, RateTable> = new Map();

  /**
   * The order in which each base currency was first stored, which is the order
   * the old single table per base was consulted in. See {@link freshTableFor}.
   */
  private baseOrder: Map<string, number> = new Map();

  /**
   * The key a table is stored under: its provider, how it was obtained and its
   * base, plus the quote for a table that holds a single pair (a CoinGecko
   * price), so a price for BTC and one for ETH from the same base are two
   * tables rather than one replacing the other.
   */
  private static tableKey(provider: string, kind: SourceKind, base: string, quote?: string): string {
    return quote === undefined ? `${provider}\u0000${kind}\u0000${base}` : `${provider}\u0000${kind}\u0000${base}\u0000${quote}`;
  }

  /**
   * Store a table under its key, first dropping every table past the freshness
   * window. The key is deleted before it is set so the map's order is the order
   * of storing, which is what breaks a tie between two tables stored in the
   * same millisecond (see {@link freshTableFor}).
   */
  private storeTable(key: string, table: RateTable): void {
    const now = Date.now();
    for (const [existingKey, existing] of this.baseTables) {
      if (now - existing.fetchedAt > CurrencyExchangeService.RATE_FRESHNESS_MS) this.baseTables.delete(existingKey);
    }
    if (!this.baseOrder.has(table.base)) this.baseOrder.set(table.base, this.baseOrder.size);
    this.baseTables.delete(key);
    this.baseTables.set(key, table);
  }

  /**
   * The fresh table that serves a pair, among the tables stored within the
   * freshness window that hold both codes.
   *
   * The rule is the one a single table per base gave, so no pair's rate moves
   * except where a table used to be lost. Tables for the base stored first come
   * first, as the old map was read in the order its bases arrived (a USD table
   * serves EUR→GBP ahead of a GBP table fetched later). Among the tables for one
   * base, the one stored most recently serves, which is the rate the replacing
   * store gave: a host priming USD after a live USD fetch has its own rate used,
   * and a live fetch after priming has its. What no longer happens is a table
   * from one source removing another's rates, so a pair only the other source
   * holds (BTC beside a fiat table, a host's own pair beside a live one) is still
   * served. getRateSync() and rateSourcesSync() both ask this, so a
   * conversion's provenance always names the table whose rate it used. Reads
   * only, so a conversion on every keystroke allocates nothing.
   */
  private freshTableFor(fromUpper: string, toUpper: string): RateTable | undefined {
    const now = Date.now();
    let best: RateTable | undefined;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const table of this.baseTables.values()) {
      if (now - table.fetchedAt > CurrencyExchangeService.RATE_FRESHNESS_MS) continue;
      if (!table.rates[fromUpper] || !table.rates[toUpper]) continue;
      const rank = this.baseOrder.get(table.base) ?? Number.MAX_SAFE_INTEGER;
      // Map order is store order (see storeTable), so a later table of the same
      // base and time is the more recent store.
      if (rank < bestRank || (rank === bestRank && best !== undefined && table.fetchedAt >= best.fetchedAt)) {
        best = table;
        bestRank = rank;
      }
    }
    return best;
  }

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
      this.storeTable(
        CurrencyExchangeService.tableKey(FRANKFURTER_PROVIDER, "live", fromUpper),
        rateTable(fromUpper, { ...rates, [fromUpper]: 1 }, FRANKFURTER_PROVIDER, "live", Date.now()),
      );

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
      // need to know or care which source a rate came from. Keyed by the pair,
      // so it sits beside a fiat table for the same base and beside another
      // crypto pair rather than replacing either (#649).
      this.storeTable(
        CurrencyExchangeService.tableKey(COINGECKO_PROVIDER, "live", fromUpper, toUpper),
        rateTable(fromUpper, { [fromUpper]: 1, [toUpper]: rate }, COINGECKO_PROVIDER, "live", Date.now()),
      );

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
   * rates they are. The table sits beside the engine's own live tables rather
   * than replacing them, and a live fetch for the same base does not replace
   * it (#649); priming the same provider and base again does.
   *
   * @param base - Base currency code (e.g. "USD").
   * @param rates - Map of currency code → rate relative to the base.
   * @param options - The provider's name and when its rates were published.
   */
  primeRates(base: string, rates: Record<string, number>, options: PrimeRatesOptions = {}): void {
    const baseUpper = base.toUpperCase();
    const provider = options.provider ?? PRIMED_RATES_PROVIDER;
    this.storeTable(
      CurrencyExchangeService.tableKey(provider, "primed", baseUpper),
      rateTable(baseUpper, { ...rates, [baseUpper]: 1 }, provider, "primed", Date.now(), options.publishedAt),
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
    this.baseOrder.clear();
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
    const table = this.freshTableFor(fromUpper, toUpper);
    return table === undefined ? null : table.rates[toUpper] / table.rates[fromUpper];
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
    const table = this.freshTableFor(fromUpper, toUpper);
    if (table === undefined) return undefined;
    const subject = `${fromUpper}/${toUpper}`;
    let sources = table.pairSources.get(subject);
    if (sources === undefined) {
      sources = Object.freeze([Object.freeze({ ...table.source, subject })]);
      table.pairSources.set(subject, sources);
    }
    return sources;
  }

  /** Convert `value` from `from` to `to` using a freshly-fetched live rate (see {@link getRate}). */
  async convert(value: number, from: string, to: string): Promise<number> {
    const rate = await this.getRate(from, to);
    return value * rate;
  }

  /**
   * Get all currently cached fresh rates, keyed "FROM:TO".
   *
   * Where two fresh tables for one base give a rate for the same code, the one
   * stored most recently is listed, the rate a conversion through that base
   * would use.
   *
   * @returns Snapshot of fresh live rates, or null when none are cached.
   */
  getAllRates(): Record<string, number> | null {
    const now = Date.now();
    const snapshot: Record<string, number> = {};
    let any = false;
    const fresh = [...this.baseTables.values()]
      .filter((table) => now - table.fetchedAt <= CurrencyExchangeService.RATE_FRESHNESS_MS)
      .sort((a, b) => a.fetchedAt - b.fetchedAt);
    for (const table of fresh) {
      for (const [code, rate] of Object.entries(table.rates)) {
        snapshot[`${table.base}:${code}`] = rate;
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
