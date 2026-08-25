import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { basicLexerVocabulary } from "./BasicLexerVocabulary";
import { ReverseKeywordParselet, REVERSE_FN } from "./BasicParselet";
import { reverseString } from "./BasicVmHandler";

/**
 * Minimal worked example of an {@link IEnginePackage} — a single custom
 * keyword (`reverse("text")`) dispatched through a plugin function. See
 * `examples/osrs` for a fuller example that also covers async resolvers,
 * a custom highlight category, and completion items.
 */
export const BASIC_PACKAGE: IEnginePackage = {
  name: "basic-example",

  lexerVocabulary: basicLexerVocabulary,

  prefixParselets: {
    REVERSE_KEYWORD: new ReverseKeywordParselet(),
  },

  // The engine assigns the numeric CALL_PLUGIN index; a parselet emits the
  // call by name (`emitPluginCall(REVERSE_FN, ...)`), so the author names the
  // function and never touches an index.
  pluginFunctions: {
    [REVERSE_FN]: reverseString,
  },
};
