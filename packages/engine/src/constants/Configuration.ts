/**
 * Configuration Module for solve-js Engine
 * 
 * This module provides the **single source of truth** for all engine configuration.
 * Every configurable aspect of the engine, from safety limits and performance
 * budgets to VM constraints and worker pool sizing, is defined here.
 * 
 * ### Design principles
 * 
 * 1. **Engine owns its config.** The engine defines its own config shape and defaults.
 *    Consumers (e.g., the Obsidian plugin) pass partial overrides; all unspecified
 *    fields fall back to `DEFAULT_CONFIG`.
 * 
 * 2. **Self-documenting.** Every interface and field has descriptive JSDoc so the
 *    config is understandable at a glance, whether you're using the engine as an
 *    npm package or reading the source.
 * 
 * 3. **Minimal consumer knowledge.** Consumers only need to pass `Partial<EngineConfig>`.
 *    They don't need to replicate the full config shape, just the fields they
 *    want to override.
 * 
 * @module Configuration
 */

import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * A host's test for whether a calendar date is a public holiday, given the
 * `Date` for that day at local midnight. Return `true` to exclude it from
 * working-day arithmetic.
 */
export type HolidayPredicate = (date: Date) => boolean;

/**
 * The host-supplied public-holiday calendar, in the same "bring your own data"
 * shape the stocks and weather packages already use for a host callback (see
 * `packages/stocks/StocksPackage.ts`): weekends are decidable from the date
 * alone, holidays are not, so they come from the host or not at all.
 *
 * Either a {@link HolidayPredicate}, for a host that computes holidays itself
 * (an existing library, a region rule), or an iterable of specific dates as
 * `YYYY-MM-DD` strings, epoch-millisecond numbers or `Date` objects, for a host
 * that just has a list. Resolved to one internal predicate by
 * `vm/HolidayCalendar.ts`'s `resolveHolidayPredicate()`.
 *
 * Left unset, working-day arithmetic skips weekends only, which is the honest
 * default: the engine excludes exactly the days it can prove are non-working.
 */
export type HolidayCalendar = HolidayPredicate | Iterable<string | number | Date>;

/**
 * Date-related configuration.
 * Controls the bounds and formatting for date/time expression evaluation
 * (e.g., `today + 20 days`, `last monday`).
 */
/**
 * How an ambiguous all-numeric date literal is read.
 *
 * - `'auto'`: by separator, the historic behaviour. A slash date is
 *   day-first (`25/12/2023`), a hyphen date is month-first (`12-25-2023`)
 *   unless its first group is four digits, which makes it ISO (`2023-12-25`).
 * - `'DMY'` / `'MDY'` / `'YMD'`: a fixed order for every numeric separator, so
 *   a host can match its readers' locale. `'MDY'` is what lets a US reader's
 *   `12/25/2023` parse, which `'auto'` refuses because the slash defaults to
 *   day-first.
 *
 * Only ambiguous literals are affected. A spelled-out month (`March 9, 2024`)
 * is never ambiguous; nor is a hyphen literal with a four-digit leading group
 * (`2024-03-09`), which has no reading but year-month-day and is read as ISO
 * under every order, timestamp or not.
 */
export type DateInputOrder = 'auto' | 'DMY' | 'MDY' | 'YMD';

/** Date-related engine configuration: offset limits, input order, holidays. */
export interface DateConfig {
  /**
   * The order an ambiguous all-numeric date literal is read in. Defaults to
   * `'auto'` (by separator, the historic behaviour). See {@link DateInputOrder}.
   */
  readonly inputOrder: DateInputOrder;
  /**
   * How far forward a date offset whose COST grows with the offset may reach,
   * in years. Enforced by `vm/VM.ts`'s `addBusinessDays()`.
   *
   * Bounds the walk, not the calendar. Every other date offset in the engine
   * is arithmetic on a Date field, so `today + 100000 days` costs exactly what
   * one day costs and needs no ceiling; workdays are the one offset that has
   * to step day by day, because which days are skipped depends on where each
   * step lands. `today + 100000000 workdays` therefore froze the host for
   * thirteen seconds inside a single ADD opcode (where `vm.maxInstructions`
   * cannot see it) and then answered "Invalid Date", and a trillion never
   * returned at all.
   *
   * Release hardening: this field was declared, documented as a "safety
   * limit", and read nowhere, so it bounded nothing. A limit a host can
   * configure and the engine ignores is worse than no limit, because it reads
   * as protection that is not there.
   */
  readonly maxOffsetYears: number;
  /** How far BACK the same walk may reach, in years, as a negative number. See {@link maxOffsetYears}. */
  readonly minOffsetYears: number;
  /** Default date string format for display (moment.js format string) */
  readonly defaultFormat: string;
  /**
   * Public-holiday calendar for working-day arithmetic (`N working days after
   * <date>`, `working days between <date> and <date>`, `<date> + N workdays`).
   * See {@link HolidayCalendar}.
   *
   * Optional and unset by default: with no calendar, working-day arithmetic
   * skips weekends only. A host that wants holidays excluded too supplies one
   * here (`new ExpressionEngine({ config: { date: { holidays } } })`), the
   * same way stocks and weather take a host data source. Threaded into the VM
   * by `engine/ExpressionEngine.ts` exactly as {@link maxOffsetYears} is,
   * because working-day math is a VM operation several grammar forms share, so
   * the calendar has to be one source the VM owns rather than per-package state
   * the VM cannot see.
   */
  readonly holidays?: HolidayCalendar;
}

/**
 * Performance-related configuration.
 * Controls caching, timeouts, and processing limits to prevent runaway
 * resource consumption on large documents.
 */
export interface PerformanceConfig {
  /**
   * Maximum number of entries in {@link ExpressionEngine}'s bytecode cache
   * (per-instance, keyed by expression text) before the oldest entry is
   * evicted. Raise this for documents with many distinct expressions if
   * repeated re-evaluation (e.g. scrolling) is re-parsing instead of
   * hitting cache, bug fix (release hardening pass): this field used to
   * be read nowhere; the cache size was a hardcoded, unconfigurable
   * constant. Note this does NOT bound {@link LineCache}, which has no
   * size limit of its own.
   */
  readonly defaultCacheSize: number;
  /**
   * Maximum lines a document may have for the engine to process it in one
   * pass. Enforced by `ExpressionEngine.parseDocument()` and by
   * `engine/DocumentModel.ts`'s `setDocument()`, the two entry points that
   * take a whole document.
   *
   * A document costs memory per line whatever each line says: a parsed line
   * record, a cache entry, a dependency-graph node. Two hundred thousand
   * lines of `1 + 1` therefore exhausted the heap and aborted the process
   * before any per-line limit had anything to object to, which is the same
   * shape of hole as an unbounded expression and needs the same kind of
   * ceiling. Refusing the document names the limit; a host that genuinely has
   * a larger one raises this field.
   *
   * Release hardening: declared and read nowhere until now.
   */
  readonly maxDocumentLines: number;
}

/**
 * Validation / safety-limit configuration.
 * Protects against runaway expressions that could cause excessive memory use
 * or stack overflow. These limits are checked during lexing and parsing.
 */
/** Bounds on untrusted input: expression length and nesting depth. */
export interface ValidationConfig {
  /** Maximum expression length in characters. Prevents excessively long strings from entering the pipeline. */
  readonly maxExpressionLength: number;
  /** Maximum expression complexity score (`tokens + functionCalls×5 + nestingDepth×10`). Protects against deeply nested or combinatorially complex expressions. */
  readonly maxComplexity: number;
  /** Maximum parentheses nesting depth. Prevents stack overflow in the recursive-descent parser. */
  readonly maxNestingDepth: number;
  /**
   * Auto-balance unmatched parentheses by appending missing closing parens
   * or prepending missing opening parens. When disabled, unbalanced expressions
   * cause parse errors instead of being silently corrected.
   *
   * Disabled by default for strict parsing. Enable for forgiving user input
   * (e.g., chat-style calculators where users often omit closing parens).
   * Has zero overhead when disabled, the O(n) paren-count scan is skipped.
   */
  readonly autoBalanceParens: boolean;
}

/**
 * Worker pool configuration.
 * Controls the parallel execution workers used for batch evaluation.
 */
export interface WorkerConfig {
  /** Maximum number of concurrent Web Workers allowed */
  readonly maxConcurrentWorkers: number;
  /** Time (ms) a worker stays alive while idle before being terminated */
  readonly idleTimeoutMs: number;
  /** Maximum retry attempts for a failed worker operation */
  readonly maxRetries: number;
  /** Base backoff delay (ms) between retries (exponential backoff applied on top) */
  readonly baseBackoffMs: number;
}  /**
   * Diagnostic / telemetry configuration.
   * Controls the diagnostic event pipeline for profiling and debugging.
   * All diagnostics are disabled by default for maximum production performance.
   */
  export interface DiagnosticConfig {
    /** Master switch: enable the diagnostic pipeline (collectors receive events for all pipeline stages) */
    readonly enabled: boolean;
    /** Enable VM trace mode, emits per-opcode execution events (very verbose; disables some optimizations) */
    readonly vmTraceEnabled: boolean;
  }

  /**
   * Proactive background refresh of live async values.
   *
   * Off by default. When a live value (a stock quote, an FX rate) has gone
   * stale, today it only refetches on the next re-evaluation (a keystroke), so a
   * note left open silently ages. With this enabled, the engine drives a refetch
   * on each such value's own cadence (the resolver's `refetchIntervalMs`) for the
   * values currently on screen, and pushes the fresh result to the host through
   * the same event stream the pull path uses. It needs timers and a live editor
   * consuming that stream, so a headless or batch host leaves it off.
   */
  export interface BackgroundRefreshConfig {
    /** Master switch. When false, no timers run and every value refreshes only on re-evaluation. */
    readonly enabled: boolean;
  }

  /**
   * Whether the engine may reach the network at all.
   *
   * On by default, which is the historic behaviour: a city name or a currency
   * pair in a line fetches live data from a public endpoint as soon as the
   * line evaluates. A host embedding the engine somewhere that must not make
   * outbound requests (an offline document, a sandboxed evaluation, a tenant
   * with egress rules) switches it off here and gets the same engine with no
   * egress: every live-data form answers with a `NETWORK_DISABLED` error
   * naming the setting, instead of a request.
   *
   * The gate closes before any request is made. It stops every async
   * resolver a package registers (weather, currency, stocks, crypto,
   * knowledge, and any host-supplied one) unless the resolver declares
   * itself `local` (it reads engine state, never a network; the engine's own
   * global-variable resolver is the one built-in case). It also refuses the
   * result of a plugin function that returns a promise. That last case is a
   * boundary rather than a guarantee: such a function has already run by the
   * time the engine sees the promise, so a package that fetches inside a
   * plugin function rather than through an async resolver may still have
   * started its request. The documented shape for live data is the resolver
   * (`createQueryResolver`), which this gate stops cold.
   *
   * Rates a host primes by hand (`currencyExchangeService.primeRates`) keep
   * working with the network off, which is what an offline host with its own
   * rate table wants.
   */
  export interface NetworkConfig {
    /** Master switch. When false, no async resolver runs and no live value is fetched. */
    readonly enabled: boolean;
  }

  /**
   * Virtual Machine configuration.
   * Controls the internal bytecode VM that executes compiled expressions.
   */
  export interface VMConfig {
    /** Maximum stack depth (value slots) for VM execution, prevents stack overflow in recursive/pratt-parser generated bytecode */
    readonly maxStackDepth: number;
    /** Maximum opcodes executed per expression, halts runaway infinite loops */
    readonly maxInstructions: number;
    /**
     * Maximum elements a collection may be expanded to before `map`/`reduce`/
     * `sum`/`prod` will iterate it.
     *
     * A Range is stored as its two bounds and costs nothing until something
     * materializes it, at which point it becomes one Value per element. Twenty
     * characters (`sum(x, 1:100000000)`) therefore asked for a hundred million
     * of them, and neither `maxInstructions` nor `maxStackDepth` could see it:
     * the expansion happens inside a single opcode, so the instruction counter
     * is never consulted while it runs, and the elements never reach the value
     * stack. V8 aborted the whole process with "Reached heap limit", which a
     * host embedding the engine cannot catch.
     */
    readonly maxCollectionSize: number;
    /**
     * Maximum elements (collection Values, matrix cells) one evaluation may
     * materialize in total.
     *
     * `maxCollectionSize` above bounds a single collection. This bounds the sum
     * of everything an expression asks for, which is a different question and
     * the one that actually protects the host: two collections that are
     * individually legal are legal together, and an operation whose result is
     * the PRODUCT of two legal operands is bounded by neither of them. A matrix
     * multiply is exactly that shape, so three lines within every other limit
     * (`:a = map(1*x, 0:20000)`, `:b = transpose(a)`, `b * a`) asked for four
     * hundred million cells and aborted the process.
     *
     * Counted in elements rather than bytes, because a count is what a call
     * site has before it allocates. An element is 8 bytes as a numeric matrix
     * cell and closer to a hundred as a full Value, so the default is worth
     * roughly 16 MB of matrix or 200 MB of expanded collection: far past any
     * document and far short of what an editor cannot survive.
     */
    readonly maxAllocatedElements: number;
    /**
     * Maximum user-defined-function calls one evaluation may make in TOTAL,
     * however deeply or widely they nest.
     *
     * `maxFunctionRecursionDepth` bounds how DEEP calls nest and cannot see
     * how MANY there are, and those are different numbers. Twenty-two lines of
     * `f(n)(v) = f(n-1)(v) + f(n-1)(v)` reach a depth of only 22 against a
     * limit of 50, and make 2,097,152 calls doing it: a fatal heap abort in
     * under a second. `maxInstructions` cannot bound it either, because
     * `executeBytecode()` re-enters itself per call and each reentrant call
     * gets its OWN instruction count, so recursion refreshes its allowance on
     * the way in. This is the tally that does not refresh; see
     * `vm/AllocationBudget.ts`, which holds it for the same reason it holds
     * the element tally.
     *
     * Counted in calls rather than in the instructions they run, because the
     * call is the thing that multiplies: every call allocates a frame, its
     * arguments and its result whatever its body says.
     */
    readonly maxFunctionCalls: number;
    /**
     * Hard ceiling on how many bisection steps goal seek (`solve line N for
     * <var> = <target>`, see `packages/goalseek/`) may take before it gives up
     * with a structured error rather than continuing.
     *
     * Goal seek re-evaluates the target line's expression once per step while
     * narrowing an interval, and an untrusted document must never be able to
     * make that loop spin. `maxInstructions` bounds each individual
     * re-evaluation, but not how many of them the search performs, so this is
     * the tally that bounds the search itself, the same reason `maxFunctionCalls`
     * exists alongside `maxInstructions`. Bisection halves the interval every
     * step, so a hundred steps resolves an input to roughly one part in 2^100:
     * far past any precision a document needs, and a definite stop either way.
     */
    readonly maxGoalSeekIterations: number;
  }

/**
 * Complete engine configuration.
 *
 * Every field has a default in `DEFAULT_CONFIG`. To customize, pass a
 * `Partial<EngineConfig>` when constructing `ExpressionEngine`. Only the
 * sections/fields you supply are overridden; all others use their defaults.
 *
 * @example
 * ```typescript
 * import { ExpressionEngine } from "solve-js";
 *
 * const engine = new ExpressionEngine({ config: {
 *   validation: {
 *     maxExpressionLength: 1000,
 *     maxComplexity: 200,
 *   },
 *   // date, performance, vm, worker, diagnostic all use defaults
 * } });
 * ```
 */
export interface EngineConfig {
    /** Date/time expression evaluation bounds and formatting */
    readonly date: DateConfig;
    /** Performance budgets and cache sizing */
    readonly performance: PerformanceConfig;
    /** Safety limits for expression complexity */
    readonly validation: ValidationConfig;
    /** Internal bytecode VM configuration */
    readonly vm: VMConfig;
    /** Parallel worker pool configuration */
    readonly worker: WorkerConfig;
    /** Diagnostic pipeline configuration */
    readonly diagnostic: DiagnosticConfig;
    /** Proactive background refresh of live async values */
    readonly backgroundRefresh: BackgroundRefreshConfig;
    /** Whether live data may be fetched at all. See {@link NetworkConfig}. */
    readonly network: NetworkConfig;
  }

/**
 * A partial {@link EngineConfig} override, one section at a time.
 *
 * Overrides are merged per section over {@link DEFAULT_CONFIG}, so you can set a
 * single field of one section (`{ validation: { maxExpressionLength: 1000 } }`)
 * and keep every other default in that section. A plain `Partial<EngineConfig>`
 * cannot express that, it demands a whole section object, which is why the
 * documented overrides never typechecked against it. This is the type the
 * constructor and {@link createEngine} accept.
 */
export type EngineConfigOverride = {
  readonly [K in keyof EngineConfig]?: Partial<EngineConfig[K]>;
};

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: EngineConfig = {
   date: {
     // A century of workdays is about 26,000 steps, which is microseconds,
     // and past any offset a person means. The walk is what these bound; see
     // DateConfig above for why no other date offset needs a ceiling.
     maxOffsetYears: 100,
     minOffsetYears: -100,
     defaultFormat: 'YYYY-MM-DD',
     inputOrder: 'auto',
   },
   performance: {
     // Preserves the effective cache size the hardcoded (now-removed)
     // BYTECODE_CACHE_MAX_ENTRIES constant had, so wiring this field up
     // doesn't silently shrink the default cache for existing consumers.
     defaultCacheSize: 2000,
     // Raised from the 10,000 this field was declared with, which was never
     // enforced and turned out to be under what this engine already supports:
     // its paging design is tested against a 20,000-line document
     // (`engine/PageManager.ts` and its spec) and its throughput benchmark
     // parses a 50,000-line one. Twice the largest of those, and the same
     // number `ConfigManager.validate()` already refuses to go above.
     //
     // Measured under a 256MB heap: setting a 100,000-line document costs
     // 64MB, evaluating every line of a 20,000-line one costs 106MB, and
     // 200,000 lines aborts the process before a single expression is looked
     // at. A host with a small heap should lower this; the ceiling is here to
     // stop the size that cannot work anywhere.
     maxDocumentLines: 100000,
   },
    validation: {
      maxExpressionLength: 2000,
      maxComplexity: 500,
      maxNestingDepth: 50,
      autoBalanceParens: false,
    },
    vm: {
      maxStackDepth: 200,
      maxInstructions: 50000,
      // Two orders of magnitude above anything a person types by hand (the
      // longest range in the test suite is 1000 elements) and small enough
      // that expanding it is measured in milliseconds rather than in whether
      // the host survives.
      maxCollectionSize: 100000,
      // Twenty times the single-collection ceiling above, so an expression may
      // legitimately handle a number of large collections, and two hundred
      // times below the allocation that took the process down.
      maxAllocatedElements: 2000000,
      // Six hundred times the largest call count any test or example makes
      // (five levels of composition is sixteen calls), and small enough that
      // the calls it does allow cost single-digit megabytes rather than the
      // heap. A document that needs more than ten thousand calls on one line
      // is doing something a calculator was not built for.
      maxFunctionCalls: 10000,
      // A hundred bisection steps resolve an input to one part in 2^100, far
      // finer than any document needs and a firm stop for an untrusted one. A
      // continuous, monotonic relationship converges in tens of steps, well
      // under this; hitting it means the target is unreachable or the
      // relationship is not the smooth one goal seek assumes.
      maxGoalSeekIterations: 100,
    },
    worker: {
      maxConcurrentWorkers: 4,
      idleTimeoutMs: 30000,
      maxRetries: 3,
      baseBackoffMs: 1000,
    },
    diagnostic: {
      enabled: false,
      vmTraceEnabled: false,
    },
    backgroundRefresh: {
      enabled: false,
    },
    network: {
      // On, because it is what every existing consumer gets today. A host that
      // must not make outbound requests turns it off; see NetworkConfig.
      enabled: true,
    },
  };

/**
 * Merge a partial config override onto a base `EngineConfig`, section by
 * section, `{ ...base.section, ...override.section }` for each of the 8
 * top-level sections, not a single top-level spread.
 *
 * A shallow `{ ...base, ...override }` at the TOP level replaces an entire
 * section wholesale the moment a caller overrides even one field in it
 * (e.g. `{ performance: { defaultCacheSize: 500 } }` would silently drop
 * every other `performance.*` field back to `undefined`, not to its
 * default). This function exists specifically so every config consumer
 * shares one correct merge instead of each hand-rolling (and risking) its
 * own. `ConfigManager` and `ExpressionEngine` both call this rather than
 * either duplicating the section list or instantiating a whole
 * `ConfigManager` just to reuse its private merge logic.
 */
export function mergeEngineConfig(
  base: EngineConfig,
  override: EngineConfigOverride
): EngineConfig {
  return {
    date: { ...base.date, ...override.date },
    performance: { ...base.performance, ...override.performance },
    validation: { ...base.validation, ...override.validation },
    vm: { ...base.vm, ...override.vm },
    worker: { ...base.worker, ...override.worker },
    diagnostic: { ...base.diagnostic, ...override.diagnostic },
    backgroundRefresh: { ...base.backgroundRefresh, ...override.backgroundRefresh },
    network: { ...base.network, ...override.network },
  };
}

/**
 * Configuration manager for engine settings
 *
 * @example
 * ```typescript
 * const configManager = new ConfigManager();
 * configManager.set('performance.defaultCacheSize', 2000);
 * const cacheSize = configManager.get('performance.defaultCacheSize');
 * ```
 */
export class ConfigManager {
  private config: EngineConfig;

  constructor(config: Partial<EngineConfig> = {}) {
    this.config = mergeEngineConfig(DEFAULT_CONFIG, config);
  }

  /**
   * Get configuration value by path
   * 
   * @param path - Dot-notation path to config value
   * @returns Configuration value
   */
  get<T>(path: string): T {
    const keys = path.split('.');
    let current: unknown = this.config;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        throw ErrorFactory.config(
          "CONFIG_PATH_NOT_FOUND",
          `Configuration path not found: ${path}`,
          { path }
        );
      }
    }

    return current as T;
  }

  /**
   * Set configuration value by path
   * 
   * @param path - Dot-notation path to config value
   * @param value - New value
   */
  set<T>(path: string, value: T): void {
    const keys = path.split('.');
    if (keys.length < 2) {
      throw ErrorFactory.config(
        "INVALID_CONFIG_PATH",
        `Invalid path: ${path}. Must be in format 'section.property'`,
        { path }
      );
    }
    
    const section = keys[0];
    const property = keys[1];
    
    if (!(section in this.config)) {
      throw ErrorFactory.config(
        "CONFIG_SECTION_NOT_FOUND",
        `Configuration section not found: ${section}`,
        { section, path }
      );
    }
    
    const sectionConfig = this.config[section as keyof EngineConfig];
    if (sectionConfig && typeof sectionConfig === 'object') {
      (sectionConfig as unknown as Record<string, unknown>)[property] = value;
    } else {
      throw ErrorFactory.config(
        "CONFIG_PROPERTY_NOT_FOUND",
        `Configuration property not found: ${path}`,
        { path }
      );
    }
  }

  /**
   * Get complete configuration.
   *
   * A detached copy, section objects included. A top-level spread would hand
   * the caller this manager's own section objects, so `getConfig().vm.x = 1`
   * would be an undeclared back door into {@link set}, bypassing its path
   * validation and reaching every later {@link get}.
   */
  getConfig(): EngineConfig {
    return mergeEngineConfig(this.config, {});
  }

  /**
   * Update multiple configuration values
   */
  update(config: Partial<EngineConfig>): void {
    this.config = mergeEngineConfig(this.config, config);
  }

  /**
   * Reset to default configuration.
   *
   * Goes through {@link mergeEngineConfig} for the same reason the constructor
   * does. A top-level `{ ...DEFAULT_CONFIG }` copies the six section
   * references, not the sections, so after a reset this manager's
   * `performance` object WAS `DEFAULT_CONFIG.performance` and the next
   * `set('performance.x', ...)` wrote into the module constant. That constant
   * is what every `ExpressionEngine` is built from, so one manager's reset
   * could change the cache size, instruction ceiling or allocation budget of
   * every engine constructed later in the process.
   */
  reset(): void {
    this.config = mergeEngineConfig(DEFAULT_CONFIG, {});
  }

  /**
   * Validate configuration values
   */
  validate(): ValidationResult {
    const errors: string[] = [];

    // Validate performance config
    if (this.config.performance.maxDocumentLines > 100000) {
      errors.push('maxDocumentLines cannot exceed 100,000');
    }

    // Validate date config
    if (this.config.date.maxOffsetYears > 1000) {
      errors.push('maxOffsetYears cannot exceed 1000');
    }

    return {
      valid: errors.length === 0,
      error: errors.join('; '),
      warnings: []
    };
  }
}

/**
 * Result type for {@link ConfigManager.validate}.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

