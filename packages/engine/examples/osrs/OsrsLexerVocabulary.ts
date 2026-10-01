import type { LexerVocabulary } from "@solve-js/lexer/ExpressionLexer";

/**
 * The words the OSRS package claims as keywords: its own name and `ge` (the
 * Grand Exchange). `price` is not one. It is the most ordinary word a reader
 * names a variable, and a keyword is decided when the line is lexed, before any
 * variable is known, so claiming it made `price * qty` an OSRS item lookup
 * under any engine that loaded this package (the playground's among them).
 * `price` still reads as a filler word after `osrs` (`osrs price of Iron Axe`,
 * `osrs.price("Iron Axe")`), where it cannot be the reader's variable.
 */
export const osrsLexerVocabulary: LexerVocabulary = {
  keywords: {
    osrs: "OSRS_KEYWORD",
    ge: "OSRS_KEYWORD",
  },
};
