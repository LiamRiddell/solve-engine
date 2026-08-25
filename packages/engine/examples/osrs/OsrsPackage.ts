import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { osrsLexerVocabulary } from "./OsrsLexerVocabulary";
import { osrsItemNormalizerRule } from "./OsrsItemNormalizer";
import { GameItemParselet, OsrsKeywordParselet, OSRS_PACKAGE_NAME, OSRS_GAME_ITEM_FN } from "./OsrsParselet";
import { resolveGameItem } from "./OsrsVmHandler";
import { OsrsAsyncResolver } from "./OsrsAsyncResolver";
import { OSRS_ITEMS } from "./OsrsItemVocabulary";

export const OSRS_PACKAGE: IEnginePackage = {
  name: OSRS_PACKAGE_NAME,

  // Demonstrates IEnginePackage.engineVersion for third-party package
  // authors reading this example. It tracks the engine's current major:
  // the example uses 2.0's name-keyed pluginFunctions and emitPluginCall,
  // so it genuinely needs 2.x, and a future major is expected to revisit
  // this line. See PackageRegistry.ts's engineVersion doc comment and
  // ARCHITECTURE.md §5.3.
  engineVersion: "^2.0.0",

  lexerVocabulary: osrsLexerVocabulary,

  normalizerRules: [
    osrsItemNormalizerRule(),
  ],

  prefixParselets: {
    GAME_ITEM: new GameItemParselet(),
    OSRS_KEYWORD: new OsrsKeywordParselet(),
  },

  // Dispatched via CALL_PLUGIN bytecode (see OsrsParselet.ts) — registered
  // and unregistered by ExpressionEngine alongside this package's other
  // shared-registry contributions, instead of a standalone module-level
  // side effect. The engine assigns the numeric index; a parselet emits the
  // call by name (`emitPluginCall(OSRS_GAME_ITEM_FN, ...)`).
  pluginFunctions: {
    [OSRS_GAME_ITEM_FN]: resolveGameItem,
  },

  asyncResolvers: [
    new OsrsAsyncResolver(),
  ],

  // "osrs-item" is a plugin-defined category (not one of the built-in
  // TokenCategory values) — proves categories are genuinely
  // open-ended, and gets a matching `solve-osrs-item` CSS class "for
  // free" from `tokenClassName()`'s `${prefix}${category}` convention,
  // in whatever editor the host happens to be using.
  tokenCategories: {
    OSRS_KEYWORD: "keyword",
    GAME_ITEM: "osrs-item",
  },

  // Real (if currently stub-sized, pending the generated ~3,800-item list)
  // item-name completions — proves IEnginePackage.completionItems works
  // end-to-end the same way tokenCategories's "osrs-item" did for
  // highlighting. Scales automatically once OsrsItemVocabulary.ts grows;
  // no changes needed here.
  completionItems: OSRS_ITEMS.map((item) => ({
    label: item.name,
    category: "osrs-item",
    detail: "OSRS item",
  })),
};
