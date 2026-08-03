import { enLocale, type ILocale } from "./en";
import { deLocale } from "./de";
import { frLocale } from "./fr";

const locales: Record<string, ILocale> = {
  en: enLocale,
  de: deLocale,
  fr: frLocale,
};

/**
 * Look up a locale by code.
 *
 * @param code - Locale code, for example `"en"` or `"de"`.
 * @returns The locale, or English when the code is unknown. Falling back
 * rather than throwing means an unrecognised code degrades to a working engine
 * instead of a dead one.
 */
export function getLocale(code: string): ILocale {
  return locales[code] || enLocale;
}

/**
 * Add a locale, or replace one already registered under the same code.
 *
 * @param code - Locale code to register under.
 * @param locale - Keywords, units and formatting for that locale.
 */
export function registerLocale(code: string, locale: ILocale): void {
  locales[code] = locale;
}

export { enLocale, deLocale, frLocale, type ILocale };