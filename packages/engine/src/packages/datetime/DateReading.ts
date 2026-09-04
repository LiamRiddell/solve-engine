/**
 * How this engine reads a numeric date literal, decided once and reported.
 *
 * `03/04/2026` names one of two days, and the engine has to pick one. Which it
 * picks has always been settled by `date.inputOrder`, but nothing said so: the
 * answer came back as a date with no account of how it was read, and a host
 * had no way to show the reader "day first" or to discover that its own
 * setting was the reason a document looked wrong.
 *
 * This module is the one place that decision is made, so the normaliser that
 * fuses a literal and the surfaces that explain one cannot disagree about it.
 * The engine-wide half is here: a {@link DateReadingPolicy} resolved once per
 * engine, naming the order AND where the order came from.
 *
 * @module DateReading
 */

import type { DateConfig } from "@solve-js/constants/Configuration";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { hostLocale, orderFromLocale, type DateFieldOrder } from "@solve-js/calendar/HostLocale";

/** Scoped error codes the datetime package owns (see `errors/ErrorCode.ts` convention). */
export const DatetimeErrorCodes = {
  /**
   * `date.inputLocale` is not a BCP-47 locale tag (`"en_US"` with an
   * underscore is the usual mistake). Raised at engine construction, because a
   * locale that is silently ignored is a date order that is silently wrong.
   */
  DATE_INPUT_LOCALE_INVALID: "DATE_INPUT_LOCALE_INVALID",
} as const;

/** Every error code the datetime package's date-reading rules can produce. */
export type DatetimeErrorCode = (typeof DatetimeErrorCodes)[keyof typeof DatetimeErrorCodes];

/**
 * An order a literal can actually be read under: the three concrete field
 * orders, plus `'auto'` for the historic per-separator reading.
 *
 * Narrower than `DateInputOrder` on purpose. `'locale'` is a request for an
 * inference, not an order, and it is resolved away by
 * {@link resolveDateOrderPolicy} before anything that reads a literal sees it,
 * so the word cannot reach the normaliser, a worker or a snapshot.
 */
export type ResolvedDateOrder = "auto" | DateFieldOrder;

/**
 * Where a resolved order came from, which is the part a reader needs and a
 * bug report should carry.
 *
 * - `'config'`: the host named `'DMY'`, `'MDY'` or `'YMD'` outright. No
 *   inference ran and `date.inputLocale` was not consulted.
 * - `'locale'`: inferred from the tag the host gave in `date.inputLocale`.
 * - `'host-locale'`: inferred from the tag this machine resolves to.
 * - `'separator'`: `'auto'`, the historic reading, where a slash date is
 *   day-first and a hyphen date month-first unless it is ISO-shaped.
 * - `'fallback'`: an inference was asked for and could not be made, so the
 *   engine reads dates exactly as an `'auto'` engine does. Visible on purpose:
 *   this is the case where a host should offer the reader a manual choice.
 */
export type DateOrderSource = "config" | "locale" | "host-locale" | "separator" | "fallback";

/**
 * The reading policy one engine applies to every numeric date literal in every
 * line it evaluates.
 *
 * Resolved once, in the `ExpressionEngine` constructor, and then carried
 * rather than re-derived: the normaliser rule runs on every keystroke, so an
 * `Intl` call per literal would be a per-keystroke cost for an answer that
 * cannot change, and a per-expression bytecode cache keyed on text would go
 * stale against an order that could.
 */
export interface DateReadingPolicy {
  /** The order every ambiguous numeric literal is read under. Never `'locale'`. */
  readonly order: ResolvedDateOrder;
  /** Where {@link order} came from. See {@link DateOrderSource}. */
  readonly orderSource: DateOrderSource;
  /** The BCP-47 tag the order was inferred from, when it was inferred from one. */
  readonly locale?: string;
}

/**
 * Whether a string is a locale tag `Intl` will accept.
 *
 * Checked through `Intl.getCanonicalLocales`, which throws a `RangeError` for
 * a malformed tag (`"en_US"`) and accepts one it merely has no data for.
 * That is the right line to draw here: a tag with no data is a reader whose
 * locale this runtime cannot describe, which the inference already handles by
 * falling back, whereas a malformed tag is a typo in the host's own code.
 *
 * A runtime with no `Intl.getCanonicalLocales` at all accepts everything,
 * because refusing a host's configuration on the grounds that the engine
 * cannot check it would fail in the one environment least able to react.
 */
function isLocaleTag(tag: string): boolean {
  if (typeof Intl !== "object" || Intl === null || typeof Intl.getCanonicalLocales !== "function") return true;
  try {
    Intl.getCanonicalLocales(tag);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a host's `date` configuration into the concrete reading policy this
 * engine applies.
 *
 * The precedence is strict, and each step decides on its own: there is no
 * merge and no "infer, then adjust". An override beats an inference because
 * the inference is reached only through the one value that asks for it.
 *
 * 1. `'DMY'`, `'MDY'` or `'YMD'`: that order, outright, `'config'`. No `Intl`
 *    call happens and `inputLocale` is not read at all.
 * 2. `'locale'` with `inputLocale` set: the order that tag writes, `'locale'`.
 * 3. `'locale'` with `inputLocale` unset: the order this machine's tag writes,
 *    `'host-locale'`.
 * 4. `'locale'` where no inference could be made: `'auto'`, `'fallback'`. This
 *    is today's behaviour, which is the only safe thing to fail to.
 * 5. `'auto'`: the historic per-separator reading, `'separator'`.
 *
 * `inputLocale` is inert unless `inputOrder` is `'locale'`. Setting it beside
 * `'auto'` changes no result, because a field that quietly switched inference
 * on would turn the predictable host mistake into a wrong reading rather than
 * no change. Its SHAPE is still checked wherever it is set, since a malformed
 * tag is a typo either way and the reader is better served by hearing about it
 * at construction than by never hearing about it.
 *
 * @param date - The engine's merged `date` configuration.
 * @returns The policy, frozen.
 * @throws {EngineError} `DATE_INPUT_LOCALE_INVALID` when `inputLocale` is set
 * and is not a tag `Intl` accepts.
 */
export function resolveDateOrderPolicy(date: DateConfig): DateReadingPolicy {
  const requestedLocale = date.inputLocale;
  if (requestedLocale !== undefined && !isLocaleTag(requestedLocale)) {
    throw ErrorFactory.config(
      DatetimeErrorCodes.DATE_INPUT_LOCALE_INVALID,
      `date.inputLocale "${requestedLocale}" is not a BCP-47 locale tag. Use a tag Intl accepts, for example "en-US".`,
      { inputLocale: requestedLocale },
    );
  }

  const order = date.inputOrder;
  if (order === "DMY" || order === "MDY" || order === "YMD") {
    return Object.freeze({ order, orderSource: "config" as const });
  }

  if (order === "locale") {
    const tag = requestedLocale ?? hostLocale();
    if (tag !== null && tag !== undefined) {
      const inferred = orderFromLocale(tag);
      if (inferred !== null) {
        return Object.freeze({
          order: inferred,
          orderSource: requestedLocale !== undefined ? ("locale" as const) : ("host-locale" as const),
          locale: tag,
        });
      }
    }
    // No Intl, an Intl that answers for a locale that is not the host's, or a
    // tag it cannot describe. Fall back to what the engine already does rather
    // than to a guess, and say so, so a host can tell a decision from a guess.
    return Object.freeze({ order: "auto" as const, orderSource: "fallback" as const });
  }

  return Object.freeze({ order: "auto" as const, orderSource: "separator" as const });
}
