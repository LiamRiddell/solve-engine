import { ILocale, withEnglishKeywords } from "./en";

/**
 * The German pack's own function names, each to the built-in it runs. Every
 * one is also a `FUNC` word below, so the lexer reads it as a call; this table
 * is what the call resolves to. They used to be lexed as calls and then
 * refused as unknown functions, since the dispatch table knew only English
 * names (#833).
 */
const GERMAN_FUNCTIONS: Readonly<Record<string, string>> = {
  wurzel: "sqrt",
  kubikwurzel: "cbrt",
  runden: "round",
  aufrunden: "ceil",
  abrunden: "floor",
  zufall: "random",
  zeichen: "sign",
  ganzzahl: "int",
};

/**
 * German keywords, added to the English ones (see {@link withEnglishKeywords}).
 *
 * `in` is a conversion here as it is in English (`IN`, not `TO`). It used to be
 * read as `TO`, which converts a unit alike, but a zone conversion asks for
 * `IN` by type, so `3pm London in Tokyo` was refused under this pack (#833).
 */
const GERMAN_KEYWORDS: Readonly<Record<string, string>> = {
  und: "AND_CONJ",
  entfernen: "MINUS", nehmen: "MINUS",
  mal: "STAR", multiplizieren: "STAR",
  teilen: "SLASH",
  exponent: "CARET", potenz: "CARET",
  von: "OF",
  jetzt: "NOW", heute: "TODAY", morgen: "TOMORROW", gestern: "YESTERDAY",
  rollen: "ROLL",
  ...Object.fromEntries(Object.keys(GERMAN_FUNCTIONS).map((name) => [name, "FUNC"])),
  konvertieren: "CONVERT", in: "IN", amBesten: "BEST",
  naechste: "NEXT", letzte: "LAST", bis: "UNTIL", seit: "SINCE",
  sonntag: "SUNDAY", montag: "MONDAY", dienstag: "TUESDAY", mittwoch: "WEDNESDAY",
  donnerstag: "THURSDAY", freitag: "FRIDAY", samstag: "SATURDAY",
  zwischen: "BETWEEN",
  von_ab: "FROM",
  erhoehen: "INCREASE", verringern: "DECREASE",
};

/** German keywords, units and number formatting, on top of English. */
export const deLocale: ILocale = {
  code: "de",
  label: "Deutsch",
  keywordMap: withEnglishKeywords(GERMAN_KEYWORDS),
  functionNames: GERMAN_FUNCTIONS,
  display: {
    resultPrefix: "= ",
    dateFormat: "default",
    decimalSeparator: ",",
    thousandsSeparator: ".",
    vectorFormat: "[{values}]",
    percentageSuffix: "%",
  },
};
