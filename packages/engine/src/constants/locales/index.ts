import { enLocale, type ILocale } from "./en";
import { deLocale } from "./de";
import { frLocale } from "./fr";

/**
 * The language packs, by language code.
 *
 * A `Map` rather than an object literal, so a code is only ever looked up as a
 * key of its own. An object answered `toString`, `constructor`, `__proto__` and
 * `hasOwnProperty` with what it inherits, and `createEngine({ locale:
 * "toString" })` then read a keyword table off a function and threw a raw
 * `TypeError` during construction (#655).
 */
const locales: ReadonlyMap<string, ILocale> = new Map<string, ILocale>([
  ["en", enLocale],
  ["de", deLocale],
  ["fr", frLocale],
]);

/**
 * The longest a BCP 47 primary language subtag can be. A first subtag longer
 * than this names no language, so the lookup stops there rather than
 * lower-casing a host string of any length.
 */
const MAX_LANGUAGE_SUBTAG = 8;

/**
 * The language a locale tag names: its first subtag, lower-cased.
 *
 * `de-DE`, `de-AT` and `DE` all name `de`. The subtags may be joined with `-`
 * (BCP 47, what `navigator.language` gives) or `_` (the POSIX spelling, as in
 * `de_DE`).
 *
 * @param code - A locale tag.
 * @returns The language subtag, or `""` when the first subtag is too long to
 * be one.
 */
function languageOf(code: string): string {
  let end = 0;
  while (end < code.length && code[end] !== "-" && code[end] !== "_") {
    if (++end > MAX_LANGUAGE_SUBTAG) return "";
  }
  return code.slice(0, end).toLowerCase();
}

/**
 * A tag whose region is India, after the language and an optional script:
 * `en-IN`, `hi-IN`, `en-Latn-IN`, `en-IN-u-nu-latn`, any case, `-` or `_`.
 * Anchored and bounded, so it settles within the first few characters of a tag
 * of any length.
 */
const INDIAN_REGION = /^[a-z]{2,8}(?:[-_][a-z]{4})?[-_]in(?:[-_]|$)/i;

/**
 * Look up a locale by code.
 *
 * A host usually passes a full language tag (`navigator.language` is `de-DE`,
 * not `de`), so a tag with no pack of its own falls back to its language's
 * pack before falling back to English: `de-DE` and `de-AT` read as German.
 * The region chooses nothing here; the pack is the language's (#655).
 *
 * @param code - Locale code, for example `"en"`, `"de"` or `"de-DE"`.
 * @returns The locale, or English when neither the code nor its language is
 * known. Falling back rather than throwing means an unrecognised code degrades
 * to a working engine instead of a dead one, and that includes a code that
 * happens to name an `Object.prototype` property, and a value that is not a
 * string at all from a host that is not type-checked.
 */
export function getLocale(code: string): ILocale {
  if (typeof code !== "string") return enLocale;
  return locales.get(code) ?? locales.get(languageOf(code)) ?? enLocale;
}

/**
 * Whether an engine in this locale reads Indian digit grouping everywhere: a
 * first group of three digits, then groups of two, as in `1,00,000` (one lakh,
 * a hundred thousand) and `12,34,567`.
 *
 * True for a tag whose region is India (`en-IN`, `hi-IN`) and whose language
 * pack groups with a comma, which every such tag has today, since each falls
 * back to English. Anywhere else the grouping is read only beside a rupee
 * marker (`₹1,00,000`, `1,00,000 INR`), which is `lexer/LakhGrouping.ts`'s
 * business (#657).
 *
 * @param code - The engine's locale tag.
 */
export function groupsInLakhs(code: string): boolean {
  return typeof code === "string" && INDIAN_REGION.test(code) && getLocale(code).display.thousandsSeparator === ",";
}

export { enLocale, deLocale, frLocale, type ILocale };
