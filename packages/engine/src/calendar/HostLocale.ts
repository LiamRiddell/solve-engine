/**
 * What the host's own locale says about the order the three groups of a
 * numeric date are written in.
 *
 * A reader who types `03/04/2026` means one of two days, and which one is a
 * question about where they are rather than about the characters. The engine
 * has never had an answer to that question, so `date.inputOrder` made the host
 * state it. This module is how a host can instead ask the machine, and it asks
 * exactly one thing: the day/month/year field order. Never the calendar
 * system, never the numbering system, never the display language, all of which
 * the engine decides for itself elsewhere.
 *
 * Asked of `Intl` rather than answered from a table of locales. A table goes
 * stale, and worse, it disagrees with the host's own date pickers on the same
 * machine: `Intl` is where the operating system's answer already lives, so it
 * is the only answer that can agree with everything else the reader sees.
 *
 * Pure `Intl`, importing nothing of the engine's. That is the constraint
 * `engine/EngineContext.ts` states for this directory: `calendar/` is imported
 * by `vm/`, which `engine/` imports, so anything here reaching back into
 * `engine/` closes a cycle. It sits beside `IntlZone.ts`, already the shared
 * "ask Intl about zones" module under the same rule.
 *
 * Nothing here is called unless a host asked for it. `date.inputOrder` still
 * defaults to `'auto'`, and only the value `'locale'` reaches this module, so
 * a default engine constructs no `Intl.DateTimeFormat` on this path at all.
 *
 * @module HostLocale
 */

/**
 * The three field orders a Gregorian numeric date can be written in.
 *
 * Declared here rather than imported from `constants/Configuration.ts` because
 * this module may not import from the engine's layers (see the module note),
 * and because it is a narrower set than `DateInputOrder`: an inference can
 * only ever produce a concrete order, never `'auto'` and never `'locale'`.
 */
export type DateFieldOrder = "DMY" | "MDY" | "YMD";

/**
 * The instant the order probe is taken on: 3 April 2026, formatted in UTC.
 *
 * A fixed instant rather than "now", so the probe cannot drift with the
 * machine clock or its zone, and a day and a month that are both unambiguous
 * as digits (3 and 4) so a formatter's output can be read back by field type
 * without the two being confusable.
 */
const PROBE_INSTANT = Date.UTC(2026, 3, 3);

/**
 * The memo table, and the `Intl.DateTimeFormat` it was built against.
 *
 * The answer to both probes cannot change within one process, and the order
 * probe would otherwise run on every engine construction, so both are cached.
 * The cache is keyed on the constructor it was filled from: a test that swaps
 * `globalThis.Intl`, or a host that installs a polyfill after the first
 * engine, gets a fresh answer about the implementation it actually has rather
 * than a remembered one about a different implementation.
 */
let memoisedAgainst: unknown = undefined;
let trustworthy: boolean | undefined = undefined;
const orderByTag = new Map<string, DateFieldOrder | null>();

/** The `Intl.DateTimeFormat` this runtime currently has, or undefined where there is none. */
function currentIntl(): unknown {
  return typeof Intl === "object" && Intl !== null ? (Intl as { DateTimeFormat?: unknown }).DateTimeFormat : undefined;
}

/** Drops the memo table when the runtime's `Intl.DateTimeFormat` is not the one it was filled from. */
function freshenMemo(): void {
  const current = currentIntl();
  if (current === memoisedAgainst) return;
  memoisedAgainst = current;
  trustworthy = undefined;
  orderByTag.clear();
}

/**
 * Whether this runtime's `Intl` carries the host's own locale data, rather
 * than one language's data answering for every locale.
 *
 * A small-ICU build resolves every requested locale to `en-US` whatever the
 * operating system says, and it does so silently: `new
 * Intl.DateTimeFormat('ja-JP')` returns a formatter that writes American
 * dates. The obvious guard, `Intl.DateTimeFormat.supportedLocalesOf([tag])`,
 * catches an unknown tag (it answers `[]` for `zz-ZZ`, while
 * `new Intl.DateTimeFormat('xx-YY').resolvedOptions().locale` cheerfully
 * answers this host's `en-GB`), but it cannot catch small ICU on the path that
 * matters: there the tag came from `resolvedOptions().locale` and is supported
 * by construction.
 *
 * So the probe asks for a locale that is certainly not English and checks what
 * comes back. A runtime that substitutes `en-US` for `ja-JP` has data that is
 * not the host's, and the caller falls back to today's behaviour rather than
 * to a fabricated month-first reading.
 *
 * @returns `true` when a Japanese request is answered in Japanese.
 */
export function isTrustworthyIntl(): boolean {
  freshenMemo();
  if (trustworthy !== undefined) return trustworthy;
  try {
    const probe = new Intl.DateTimeFormat("ja-JP").resolvedOptions().locale;
    trustworthy = typeof probe === "string" && probe.startsWith("ja");
  } catch {
    trustworthy = false;
  }
  return trustworthy;
}

/**
 * The BCP-47 tag this machine resolves to, `"en-GB"` on a UK host.
 *
 * @returns The host's tag, or `null` where `Intl` is absent or refuses to
 * answer. `null` means "no inference is available", never "assume English".
 */
export function hostLocale(): string | null {
  if (typeof Intl !== "object" || Intl === null || typeof Intl.DateTimeFormat !== "function") return null;
  try {
    const tag = new Intl.DateTimeFormat().resolvedOptions().locale;
    return typeof tag === "string" && tag.length > 0 ? tag : null;
  } catch {
    return null;
  }
}

/**
 * The day/month/year order a BCP-47 tag writes a numeric date in.
 *
 * The Gregorian calendar and Latin digits are pinned so that a locale whose
 * default calendar is Persian, Buddhist or a Japanese era still contributes
 * its field ORDER and never its calendar system or its digits: the engine
 * computes in Gregorian throughout (`calendar/Gregorian.ts`, the month names,
 * the leap-year check), so a probe about another calendar would be an answer
 * to a question the engine never asks.
 *
 * Verified on this machine (Node 24.16.0, full ICU): `en-GB` DMY, `en-US` MDY,
 * `de-DE` DMY, `fr-FR` DMY, `ja-JP` YMD, `hu-HU` YMD, `en-CA` YMD, `fa-IR`
 * YMD.
 *
 * Two guards, because they catch different lies. `supportedLocalesOf` catches
 * a tag this runtime has no data for: it answers `[]` for `zz-ZZ` and `und`
 * while `new Intl.DateTimeFormat('zz-ZZ').resolvedOptions().locale` cheerfully
 * answers this host's `en-GB`, so without it a host naming a locale the
 * runtime does not carry would be given a stranger's order. {@link
 * isTrustworthyIntl} catches the case that guard cannot see, a small-ICU build
 * answering `en-US` for everything on a tag that IS supported.
 *
 * @param tag - A BCP-47 tag, from `date.inputLocale` or from {@link hostLocale}.
 * @returns The order, or `null` where `Intl` is absent, has no data for the
 * tag, is untrustworthy ({@link isTrustworthyIntl}), throws, or produces a
 * parts list missing any of the three fields. Every one of those means the
 * same thing to the caller: there is no inference here, so keep the behaviour
 * the engine already has.
 */
export function orderFromLocale(tag: string): DateFieldOrder | null {
  freshenMemo();
  const cached = orderByTag.get(tag);
  if (cached !== undefined) return cached;
  const resolved = probeOrder(tag);
  orderByTag.set(tag, resolved);
  return resolved;
}

/** The uncached probe behind {@link orderFromLocale}. */
function probeOrder(tag: string): DateFieldOrder | null {
  if (typeof Intl !== "object" || Intl === null || typeof Intl.DateTimeFormat !== "function") return null;
  if (!isTrustworthyIntl()) return null;
  try {
    if (typeof Intl.DateTimeFormat.supportedLocalesOf === "function" && Intl.DateTimeFormat.supportedLocalesOf([tag]).length === 0) {
      return null;
    }
    const parts = new Intl.DateTimeFormat(tag, {
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "UTC",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(PROBE_INSTANT);
    if (!Array.isArray(parts)) return null;
    const sequence = parts
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => part.type[0].toUpperCase())
      .join("");
    return sequence === "DMY" || sequence === "MDY" || sequence === "YMD" ? sequence : null;
  } catch {
    return null;
  }
}
