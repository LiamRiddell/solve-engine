import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { PrevParselet } from "./parselets/PrevParselet";
import { LineRefParselet } from "./parselets/LineRefParselet";
import { RangeAggregateParselet } from "./parselets/RangeAggregateParselet";
import { AboveAggregateParselet } from "./parselets/AboveAggregateParselet";
import { lineRefNormalizerRule, rangeCallNormalizerRule } from "./normalizer/LineRefNormalizerRule";
import {
  prevHandler, lineRefHandler, sumRangeHandler, averageRangeHandler,
  totalAboveHandler, averageAboveHandler,
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
 * - `sum(`/`total(`/`average(`, normalizer-fused ONLY when immediately
 *   followed by `LPAREN`, so `:sum = 100` and MathPhrases' existing
 *   `"total of X, Y"` phrase (no paren after "of") are both unaffected.
 * - "aggregate everything above until a blank line/heading"
 *   phrase-fused as `"total above"`/`"sum above"`/`"average above"`
 *   (deliberately NOT Numi/Numbr's bare `total`/`sum` wording, that's
 *   exactly the bare-keyword collision class this codebase already
 *   regressed on once, see `MathPhrasesPackage.ts`'s "total" note).
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
  },
  normalizerRules: [lineRefNormalizerRule(), rangeCallNormalizerRule()],
  prefixParselets: {
    PREV: new PrevParselet(),
    LINE_REF: new LineRefParselet(),
    SUM_RANGE_CALL: new RangeAggregateParselet(false),
    AVERAGE_RANGE_CALL: new RangeAggregateParselet(true),
    TOTAL_ABOVE: new AboveAggregateParselet(false),
    SUM_ABOVE: new AboveAggregateParselet(false),
    AVERAGE_ABOVE: new AboveAggregateParselet(true),
  },
  pluginFunctions: {
    prev: prevHandler,
    lineRef: lineRefHandler,
    sumRange: sumRangeHandler,
    averageRange: averageRangeHandler,
    totalAbove: totalAboveHandler,
    averageAbove: averageAboveHandler,
  },
};
