import { ILocale, withEnglishKeywords } from "./en";

/**
 * The French pack's own function names, each to the built-in it runs. Each is
 * also a `FUNC` word below. Held to the names a French calculator gives these
 * functions and a French reader would not choose as a variable name (#833).
 */
const FRENCH_FUNCTIONS: Readonly<Record<string, string>> = {
  racine: "sqrt",
  arrondi: "round",
  plancher: "floor",
  plafond: "ceil",
};

/**
 * French keywords, added to the English ones (see {@link withEnglishKeywords}).
 *
 * `en` is the conversion word (`5 km en m`, `convertir 5 km en m`), read as
 * `IN` the way English reads `in`. The pack had none, so a French engine
 * converted no unit at all (#833). `multiplier` keeps the pack's meaning, the
 * verb (`STAR`), over the English `as multiplier` converter.
 */
const FRENCH_KEYWORDS: Readonly<Record<string, string>> = {
  ajouter: "PLUS", et: "AND_CONJ",
  moins: "MINUS", soustraire: "MINUS", enlever: "MINUS",
  fois: "STAR", multiplier: "STAR",
  diviser: "SLASH",
  exposant: "CARET", puissance: "CARET",
  maintenant: "NOW",
  // "aujourd'hui". See this file's own doc comment for why the
  // apostrophe is dropped here.
  aujourdhui: "TODAY",
  demain: "TOMORROW", hier: "YESTERDAY",
  lancer: "ROLL",
  ...Object.fromEntries(Object.keys(FRENCH_FUNCTIONS).map((name) => [name, "FUNC"])),
  convertir: "CONVERT", en: "IN",
  prochain: "NEXT", dernier: "LAST",
  dimanche: "SUNDAY", lundi: "MONDAY", mardi: "TUESDAY", mercredi: "WEDNESDAY",
  jeudi: "THURSDAY", vendredi: "FRIDAY", samedi: "SATURDAY",
  entre: "BETWEEN",
  augmenter: "INCREASE", diminuer: "DECREASE",
  vrai: "TRUE", faux: "FALSE",
  si: "IF", alors: "THEN", sinon: "ELSE",
};

/**
 * French locale. See GitHub issue #77 ("Please allow for localized day
 * of the week"). A confident, reviewed core set (arithmetic words, date
 * keywords, weekday names, a handful of common functions), added to the
 * English keywords rather than replacing them (#833), so every English line
 * reads the same under this pack. Widening it is a good first issue for a
 * native French speaker, same as this project's existing convention for
 * locale gaps.
 *
 * "aujourd'hui" (today) is deliberately spelled without its apostrophe
 * here (`aujourdhui`), `ExpressionLexer`'s identifier reader only
 * accepts `[a-zA-Z_][a-zA-Z0-9_]*` plus Unicode, so the standard spelling
 * can't lex as a single IDENT token at all. This is a real, disclosed
 * limitation, not a translation choice, anyone typing the standard
 * apostrophed spelling won't get a match today.
 */
export const frLocale: ILocale = {
  code: "fr",
  label: "Français",
  keywordMap: withEnglishKeywords(FRENCH_KEYWORDS),
  functionNames: FRENCH_FUNCTIONS,
  display: {
    resultPrefix: "= ",
    dateFormat: "default",
    decimalSeparator: ",",
    thousandsSeparator: " ",
    vectorFormat: "[{values}]",
    percentageSuffix: "%",
  },
};
