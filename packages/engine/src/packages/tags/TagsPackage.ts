import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { TagAggregateParselet } from "./parselets/TagAggregateParselet";
import { tagAggregateNormalizerRule, tagStripNormalizerRule } from "./normalizer/TagAggregateNormalizerRule";
import {
  TAG_SUM_FN_IDX,
  TAG_AVERAGE_FN_IDX,
  TAG_COUNT_FN_IDX,
  tagSumHandler,
  tagAverageHandler,
  tagCountHandler,
} from "./TagsPluginFunctions";

/**
 * Category tag sums: a mid-line `#tag` annotates a data line, and `total of
 * #tag` / `sum of #tag` / `average of #tag` / `count of #tag` collect every line
 * in the document carrying that tag, across the non-adjacent lines that
 * `total above` and the table-column aggregates cannot reach.
 *
 * Collision-safety (this codebase's phrase-fusion-not-bare-keyword policy): the
 * `#tag` token is claimed in the lexer only for a `#` directly followed by a
 * letter mid-line, so `# ` (space) and `//` stay free-text comments and a
 * line-start `#` stays a heading. The aggregate triggers reuse the math-phrase
 * fusions (`total of`, `count of`, `average of`) and the raw `sum of`, so bare
 * `total`/`sum`/`count`/`average` never become keywords and `:total = 5` is
 * untouched.
 */
export const TAGS_PACKAGE: IEnginePackage = {
  name: "solve-tags",
  normalizerRules: [tagAggregateNormalizerRule(), tagStripNormalizerRule()],
  prefixParselets: [
    { tokenType: "TAG_SUM", parselet: new TagAggregateParselet(TAG_SUM_FN_IDX) },
    { tokenType: "TAG_AVERAGE", parselet: new TagAggregateParselet(TAG_AVERAGE_FN_IDX) },
    { tokenType: "TAG_COUNT", parselet: new TagAggregateParselet(TAG_COUNT_FN_IDX) },
  ],
  pluginFunctions: [
    { index: TAG_SUM_FN_IDX, handler: tagSumHandler },
    { index: TAG_AVERAGE_FN_IDX, handler: tagAverageHandler },
    { index: TAG_COUNT_FN_IDX, handler: tagCountHandler },
  ],
};
