import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { PrevParselet } from "./parselets/PrevParselet";
import { LineRefParselet } from "./parselets/LineRefParselet";
import { RangeAggregateParselet } from "./parselets/RangeAggregateParselet";
import { AboveAggregateParselet } from "./parselets/AboveAggregateParselet";
import { SectionAggregateParselet } from "./parselets/SectionAggregateParselet";
import { lineRefNormalizerRule, rangeCallNormalizerRule } from "./normalizer/LineRefNormalizerRule";
import { sectionAggregateNormalizerRule } from "./normalizer/SectionAggregateNormalizerRule";
import { inputsOfNormalizerRule } from "./normalizer/InputsOfNormalizerRule";
import { InputsOfParselet } from "./parselets/InputsOfParselet";
import {
  prevHandler, lineRefHandler, sumRangeHandler, averageRangeHandler,
  totalAboveHandler, averageAboveHandler,
  countAboveHandler, minAboveHandler, maxAboveHandler, medianAboveHandler,
  sectionSumHandler, sectionAverageHandler, sectionCountHandler,
} from "./LinesPluginFunctions";

/**
 * Cross-line data access, reading another line's cached result from
 * inside an expression. Confirmed by FOUR independent competitor apps
 * wanting the exact same underlying capability (Numi's `prev`, Notes
 * Calculator's `line<N>`, Numbr's `sum`/`total`-to-header, NumPad's
 * `line<N>` plus range aggregation). See the internal parity notes'
 * "Confirmed engine limitations" item 1, now closed.
 *
 * Built entirely on `vm/VM.ts`'s `LineExecutionContext`, threaded
 * optionally through `CALL_PLUGIN`, every handler here explicitly checks
 * for `Pending`/`Error`/unevaluated lines before doing arithmetic (see
 * `LinesPluginFunctions.ts`'s module doc) rather than silently coercing
 * via `.toNumber()` (which returns `0` for both `Pending` and `Error`).
 *
 * Trigger-word collision decisions (this codebase's established
 * phrase-fusion-vs-bare-keyword policy, see `ARCHITECTURE.md` §5.1):
 * - `prev`, bare keyword (nothing to phrase-fuse against, same shape as
 *   `clamp`). Accepted risk.
 * - `line1`/`line 1`, normalizer-fused into `LINE_REF`, never claims
 *   bare `line` as a keyword (`:line = 5` stays untouched). The `l1`/`l 1`
 *   short alias documented by some competitors is deliberately NOT
 *   implemented in this pass, `l` is too common a variable name; ship
 *   `line<N>` first, add a narrower `l<N>` form later if real usage wants
 *   it.
 * - `line deleted`, normalizer-fused into the same `LINE_REF` token, is what
 *   a reference becomes when its line is deleted and a host keeps references
 *   in step (`LanguageService.shiftLineReferences`). It answers with the
 *   named `LINE_REFERENCE_DELETED` error. Two identifiers side by side had no
 *   reading before, so it takes nothing that already meant something.
 * - `sum(`/`total(`/`average(`, normalizer-fused ONLY when immediately
 *   followed by `LPAREN`, so `:sum = 100` and MathPhrases' existing
 *   `"total of X, Y"` phrase (no paren after "of") are both unaffected.
 * - "aggregate everything above until a blank line/heading"
 *   phrase-fused as `"total above"`/`"sum above"`/`"average above"`
 *   (deliberately NOT Numi/Numbr's bare `total`/`sum` wording, that's
 *   exactly the bare-keyword collision class this codebase already
 *   regressed on once, see `MathPhrasesPackage.ts`'s "total" note).
 * - "aggregate the block under a named heading", normalizer-fused as
 *   `total of section "Travel"` (and `sum of`/`average of`/`count of`) only
 *   when the word `section` and a quoted name both follow, so `section` is
 *   never a keyword and a variable of that name still reads.
 */
export const LINES_PACKAGE: IEnginePackage = {
  name: "solve-lines",
  lexerVocabulary: {
    keywords: { prev: "PREV" },
  },
  phrases: {
    "total above": "TOTAL_ABOVE",
    "sum above": "SUM_ABOVE",
    "average above": "AVERAGE_ABOVE",
    // The other spellings, and the other questions of the same block (#703).
    // `min` is also the minute and `max` a function, so each is fused as a
    // phrase, only before `above`.
    "avg above": "AVERAGE_ABOVE",
    "mean above": "AVERAGE_ABOVE",
    "count above": "COUNT_ABOVE",
    "min above": "MIN_ABOVE",
    "max above": "MAX_ABOVE",
    "median above": "MEDIAN_ABOVE",
  },
  // `inputs of line N` fuses only before a line reference, below the line-ref
  // rule so the LINE_REF it looks for already exists. See InputsOfNormalizerRule.ts.
  normalizerRules: [lineRefNormalizerRule(), rangeCallNormalizerRule(), sectionAggregateNormalizerRule(), inputsOfNormalizerRule()],
  prefixParselets: {
    PREV: new PrevParselet(),
    LINE_REF: new LineRefParselet(),
    SUM_RANGE_CALL: new RangeAggregateParselet(false),
    AVERAGE_RANGE_CALL: new RangeAggregateParselet(true),
    TOTAL_ABOVE: new AboveAggregateParselet("total"),
    SUM_ABOVE: new AboveAggregateParselet("total"),
    AVERAGE_ABOVE: new AboveAggregateParselet("average"),
    COUNT_ABOVE: new AboveAggregateParselet("count"),
    MIN_ABOVE: new AboveAggregateParselet("min"),
    MAX_ABOVE: new AboveAggregateParselet("max"),
    MEDIAN_ABOVE: new AboveAggregateParselet("median"),
    SECTION_SUM: new SectionAggregateParselet("sectionSum"),
    SECTION_AVERAGE: new SectionAggregateParselet("sectionAverage"),
    SECTION_COUNT: new SectionAggregateParselet("sectionCount"),
    INPUTS_OF: new InputsOfParselet(),
  },
  pluginFunctions: {
    prev: prevHandler,
    lineRef: lineRefHandler,
    sumRange: sumRangeHandler,
    averageRange: averageRangeHandler,
    totalAbove: totalAboveHandler,
    averageAbove: averageAboveHandler,
    countAbove: countAboveHandler,
    minAbove: minAboveHandler,
    maxAbove: maxAboveHandler,
    medianAbove: medianAboveHandler,
    sectionSum: sectionSumHandler,
    sectionAverage: sectionAverageHandler,
    sectionCount: sectionCountHandler,
    // `inputs of line N` has no entry of its own: it reaches its handler
    // through lineRef. See TRACE_INPUTS in LinesPluginFunctions.ts for why.
  },
  tokenCategories: { INPUTS_OF: "keyword", COUNT_ABOVE: "keyword", MIN_ABOVE: "keyword", MAX_ABOVE: "keyword", MEDIAN_ABOVE: "keyword" },
};
