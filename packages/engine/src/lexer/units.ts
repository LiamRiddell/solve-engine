/**
 * The set of unit identifiers the lexer will turn into a UNIT token.
 *
 * DERIVED, not hand-listed. This used to be a hand-maintained list of about a
 * hundred spellings, which existed only because the conversion tables lived
 * inside a third-party package and could not be enumerated. Every spelling had
 * to be transcribed by hand and kept in sync, and this file's own history
 * records the consequences: the IEC binary prefixes (`GiB`, `TiB`) were absent
 * for a long time, and the note explaining the fix said it was "purely a lexer
 * allowlist gap, not a conversion-logic one".
 *
 * The tables are now in-repo (see `uom/generated/UnitTable.generated.ts`), so
 * the allowlist is computed from them. Roughly 975 base spellings are
 * recognized instead of about 101, which is why `1 kilojoule to Wh`,
 * `5 arcminutes to deg` and `2 fortnights in days` work at all.
 *
 * Units are case-sensitive to eliminate ambiguity (`C` is Celsius and `c` is a
 * cup, `B` is bytes and `b` is bits). Nothing here normalizes or aliases.
 */

import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";

/**
 * Spellings the conversion tables accept but the lexer must not claim, each
 * with its reason. `UnitVocabulary.spec.ts` asserts every one of these still
 * fails to lex, so nobody can quietly delete an entry.
 *
 * Only three spellings in the whole table collide with an existing language
 * keyword (`in`, `min`, `dec`), and `min` is left alone because it has always
 * been a time unit here and works. The rest of this list is about ordinary
 * English: a unit spelling that is also a common word turns prose into
 * arithmetic. `shouldEvaluateLine`'s prose gate is a backstop, not a licence
 * to claim every word in the dictionary.
 */
const EXCLUDED_UNIT_SPELLINGS: ReadonlyMap<string, string> = new Map([
  ["in", "the IN keyword owns this word (the conversion operator). ConvertParselet and friends special-case the IN token type directly and trust its text as a unit name, so inches still convert"],
  ["dec", "already a converter name, as in `255 as dec`"],
  ["M", "the millions magnitude suffix, as in `2.5M`. Nautical miles are still spelled `nmi` and `NM`"],
  // Claimed by a normalizer rule rather than by the keyword table, which is why
  // scanning the locale keywords alone does not find it. Admitting `pm`
  // (picometre) broke every clock time in the suite: `4pm` lexed as 4
  // picometres. There is deliberately no entry for `am`: the table's SI
  // prefixes stop at femto, so attometres do not exist and an exclusion would
  // be dead weight. `UnitVocabularyCollisions.spec.ts` asserts that.
  ["pm", "the meridiem marker, as in `4pm`. Picometres lose, and `picometre` still works"],
  ["are", "the English verb, against a 100-square-metre unit almost nobody writes"],
  ["ares", "the English verb in plural, same reasoning as `are` above"],
  ["turn", "ordinary English, against a full-rotation angle unit also spelled in gradians"],
  ["turns", "ordinary English in plural, same reasoning as `turn` above"],
  ["grade", "ordinary English. The angle unit is also spelled `gon` and `grad`"],
  ["grades", "ordinary English in plural, same reasoning as `grade` above"],
  ["point", "ordinary English. The typographic point is also reachable as `pica`"],
  ["points", "ordinary English in plural, same reasoning as `point` above"],
  ["moment", "ordinary English, against an obscure medieval time unit of 90 seconds"],
  ["moments", "ordinary English in plural, same reasoning as `moment` above"],
  ["shake", "ordinary English, against an obscure physics unit of ten nanoseconds"],
  ["shakes", "ordinary English in plural, same reasoning as `shake` above"],
]);

/**
 * Whether a spelling can be a single UNIT token at all.
 *
 * The lexer reads a unit as one run of `[A-Za-z0-9_]`, so the 465 spellings
 * containing a space, a slash, a prime or a non-ASCII character cannot be
 * tokenized however well the converter understands them. `square metres`,
 * `cd/m2` and `µm²` all remain reachable through the conversion API (notably
 * the cooking package's free-text target unit), just not by typing them in an
 * expression.
 */
function isTokenizableSpelling(spelling: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(spelling);
}

/**
 * The single-character units that were already claimed before the vocabulary
 * was derived from the tables, and are therefore grandfathered in.
 *
 * No OTHER single character is admitted. A one-letter unit is indistinguishable
 * from the placeholder names people actually write (`x`, `y`, `n`), and the
 * table has ten more of them: `r a y c p S L N J R`. Admitting those turned
 * `x.y` into a unit expression and broke comparison-operator tests that had
 * deliberately picked letters which were not units. The upside was a handful of
 * spellings that all have an unambiguous longer form (`rad`, `year`, `cup`).
 */
const GRANDFATHERED_SINGLE_CHARACTER_UNITS = new Set([
  "m", "g", "t", "s", "h", "d", "l", "b", "B", "C", "F", "K", "W",
]);

/** Whether a base-table spelling should become a lexer token. */
function isAdmissible(spelling: string): boolean {
  if (!isTokenizableSpelling(spelling)) return false;
  if (EXCLUDED_UNIT_SPELLINGS.has(spelling)) return false;
  if (spelling.length === 1) return GRANDFATHERED_SINGLE_CHARACTER_UNITS.has(spelling);
  return true;
}

/**
 * ISO 4217 codes and the crypto tickers handled alongside them.
 *
 * Hand-maintained on purpose: these are NOT units. They route through
 * CurrencyExchangeService, and `getMeasure()` deliberately returns undefined
 * for every one of them, which is how `VM.ts` tells a currency from a unit.
 * Must stay in sync with CurrencyExchangeService's `isCurrency()`: without a
 * lexer entry a code never becomes a UNIT token, so `1 BTC to USD` used to
 * fail at tokenization with "Undefined variable: BTC" before ever reaching
 * the currency service that could have handled it.
 */
const CURRENCY_CODES = [
  "USD", "EUR", "GBP", "JPY",
  "AUD", "CAD", "CHF", "CNY", "SEK", "NOK", "DKK", "NZD",
  "KRW", "SGD", "HKD", "TWD", "INR", "BRL", "ZAR", "MXN",
  "RUB", "TRY", "SAR", "AED", "ILS", "PLN", "CZK", "HUF",
  "THB", "IDR", "MYR", "PHP", "CLP", "COP", "ARS", "NGN",
  "EGP", "PKR", "BDT", "VND", "KES", "XOF", "XAF", "MAD",
  "QAR", "KWD", "OMR", "BHD", "JOD", "LKR", "MMK", "UZS",
  "KZT", "RON", "BGN", "HRK", "ISK", "UAH", "GEL", "AZN",
  "BTN", "BND", "BOB", "BWP", "BYN", "BZD", "CDF", "CRC",
  "CUP", "DOP", "DZD", "ERN", "ETB", "FJD", "FKP", "GMD",
  "GNF", "GYD", "HNL", "HTG", "JMD", "KGZ", "KHR", "KMF",
  "KYD", "LAK", "LBP", "LRD", "LSL", "LYD", "MDL", "MGA",
  "MKD", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MZN",
  "NAD", "NIO", "NPR", "PGK", "PYG", "RSD", "RWF", "SBD",
  "SCR", "SDG", "SHP", "SLE", "SOS", "SRD", "SSP", "STN",
  "SVC", "SYP", "SZL", "TJS", "TMT", "TND", "TOP", "TTD",
  "TZS", "UGX", "UYU", "VEB", "VUV", "WST", "XCD", "XDR",
  "XPF", "YER", "ZMW", "ZWL",
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "DOT",
];

/**
 * Currency WORD forms, resolved to their canonical ISO code by
 * `UomLiteralParselet.ts` via `uom/CurrencyAliases.ts`.
 *
 * That table doc-comments every ambiguous choice (peso to MXN, franc to CHF,
 * krona to SEK) and explains why "pound"/"pounds" is deliberately absent: the
 * mass unit already claims it, and remapping would be exactly the kind of
 * guessing the case-sensitive, no-alias policy exists to prevent.
 */
const CURRENCY_WORD_FORMS = [
  "dollar", "dollars", "euro", "euros", "yen",
  "ruble", "rubles", "rouble", "roubles", "won",
  "rupee", "rupees", "yuan", "renminbi", "franc", "francs", "rand",
  "krona", "kronor", "krone", "kroner", "real", "reais", "peso", "pesos",
  "shekel", "shekels", "lira", "hryvnia", "hryvnias", "zloty", "zlotys",
  "forint", "koruna", "dirham", "dirhams", "riyal", "riyals", "rial", "rials",
  "ringgit", "rupiah", "baht", "dong", "naira",
];

/**
 * "workday" and "workdays", a business day (Mon-Fri).
 *
 * Backs the datetime package's `<date> + N workdays` arithmetic and
 * `$X/workday` Rate literals. Not a real unit (a business day has no fixed
 * physical duration, it depends on which dates are weekends), so it has no
 * entry in the conversion tables and is shimmed at a fixed 7/5 ratio for rate
 * math only. See `uom/UomConverter.ts`.
 *
 * Safe with respect to variable names: VariableParselet accepts UNIT-typed
 * tokens as names, so `:workday = 5` keeps working, exactly as `:b = 5`
 * already did for the bits unit.
 */
const WORKDAY_UNITS = ["workday", "workdays"];

/**
 * Set of all known unit identifiers (case-sensitive).
 *
 * Base units come from the conversion table; the extended units (speed,
 * voltage, parts-per and the other categories the base table has no measure
 * for) come from ExtendedUnits.ts; currencies and workdays are listed above.
 *
 * Note ExtendedUnits deliberately omits bare `V` (collides with the stocks
 * package's Visa ticker), bare `var` (reads as a variable name) and `fps`
 * (the Time package needs it for frames per second, so speed uses `ft_s`).
 * Those exclusions live there rather than here because they are properties of
 * that table.
 */
export const knownUnits: ReadonlySet<string> = new Set([
  ...Object.keys(UNIT_TABLE).filter(isAdmissible),
  ...Object.keys(EXTENDED_UNITS),
  ...WORKDAY_UNITS,
  ...CURRENCY_CODES,
  ...CURRENCY_WORD_FORMS,
]);

/** The exclusion list, exported so the vocabulary spec can assert each entry. */
export const excludedUnitSpellings: ReadonlyMap<string, string> = EXCLUDED_UNIT_SPELLINGS;

/** Units are case-sensitive to eliminate ambiguity (e.g. C=Celsius, c=cup). */
export function isKnownUnit(text: string): boolean {
  return knownUnits.has(text);
}
