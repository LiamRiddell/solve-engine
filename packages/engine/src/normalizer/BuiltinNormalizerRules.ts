//#region ─── Module Overview ───────────────────────────────────────────────────

/**
 * Built-in normalization rules for the {@link TokenNormalizer}.
 *
 * These rules handle common expression patterns that span multiple tokens.
 * Phrase fusion (e.g., "to the power of" → CARET) is handled by the
 * internal {@link PhraseTrie}. See {@link TokenNormalizer.addPhrase}.
 * This module only exports non-phrase rules like {@link implicitMultiplyRule}.
 *
 * @module BuiltinNormalizerRules
 */

//#endregion
//#region ─── Imports ──────────────────────────────────────────────────────────

import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "./NormalizerRule";

//#endregion
//#region ─── PHRASE_START_WORDS, Implicit Multiply Guard ─────────────────────

/**
 * Words that can start multi-word phrases, hardcoded fallback.
 *
 * This is ONLY used as the default fallback in {@link implicitMultiplyRule}
 * when no `canStart` predicate is provided. In the recommended pattern,
 * the {@link PhraseTrie}'s live `canStart()` set is passed instead, keeping
 * the guard in sync with package-registered phrases.
 *
 * @see {@link TokenNormalizer.canStartPhrase}
 */
/**
 * Words that introduce a rate denominator when a unit follows.
 *
 * Kept next to the implicit-multiplication rule because that is the only
 * thing they change here; the rate itself is built in the uom package.
 */
const RATE_DENOMINATOR_WORDS = new Set(["per", "a", "an", "each", "every"]);

const PHRASE_START_WORDS = new Set([
  "to", "power", "increase", "decrease", "times", "multiply", "divide", "by",
]);

//#endregion
//#region ─── implicitMultiplyRule, Implicit Operator Insertion ────────────────

/**
 * Creates a normalization rule that inserts an implicit multiplication operator
 * between adjacent tokens where multiplication is implied.
 *
 * ## When it fires
 * Inserts a STAR token between:
 * - `NUMBER IDENT` (e.g., "2 x" → "2 * x")
 * - `RPAREN IDENT` (e.g., "(x+1)y" → "(x+1) * y")
 * - `NUMBER LPAREN` (e.g., "2(x+1)" → "2 * (x+1)")
 * - `NUMBER PI` / `NUMBER E` (e.g., "2π" → "2 * π")
 *
 * ## When it doesn't fire
 * - When the following identifier starts a multi-word phrase
 *   (checked against {@link PHRASE_START_WORDS})
 * - When the following token is not an identifier or parenthesized expression
 *
 * ## Priority
 * Default priority is 50, below phrase fusion so phrases match first.
 *
 * @param priority - Rule priority (default 50)
 * @returns A {@link NormalizerRule} that inserts implicit multiply operators
 */
export function implicitMultiplyRule(
	priority: number = 50,
	canStart?: (word: string) => boolean
): NormalizerRule {
	const phraseGuard = canStart ?? ((word: string) => PHRASE_START_WORDS.has(word.toLowerCase()));

	return {
    name: "implicit:multiply",
    priority,
    // Both slots are exactly the `triggers` test below, which is the whole
    // condition: a value or closing bracket, then something a multiplication
    // could apply to.
    shape: [
      { types: ["NUMBER", "RPAREN"] },
      { types: ["IDENT", "LPAREN", "PI", "E", "SQRT_SIGN"] },
    ],
    match(tokens: Token[], pos: number): NormalizerMatch | null {
      // ── Need at least one token after the current position ──
      if (pos + 1 >= tokens.length) return null;

      const t = tokens[pos];
      const next = tokens[pos + 1];

      // ── Check trigger conditions ──
      // Ordered FIRST deliberately. The two guards below only ever suppress a
      // match, so testing them after the trigger cannot change any result, and
      // the first of them allocates a lower-cased copy of the next token's
      // value. Running that ahead of a pair of type comparisons meant every
      // position in the document paid a string allocation and a set lookup to
      // reach a test that rejects nearly all of them.
      const triggers =
        (t.type === "NUMBER" || t.type === "RPAREN") &&
        (next.type === "IDENT" || next.type === "LPAREN" || next.type === "PI" || next.type === "E" || next.type === "SQRT_SIGN");

      if (!triggers) return null;

      // ── Guard: suppress if the next identifier starts a phrase ──
      // Uses the trie's canStart when available, falls back to hardcoded set.
      // This prevents "2 power of 3" from becoming "2 * power of 3".
      const nextValue = next.value.toLowerCase();
      if (phraseGuard(nextValue)) return null;

      // ── Guard: a rate denominator, not a multiplication ──
      // "99 per week" is ninety-nine a week, not ninety-nine times something
      // called per. The trie guard above cannot cover this, because these are
      // not registered phrases; they are recognised by the uom package's
      // bare-denominator rule, which runs after this one and then finds its
      // fused token stranded in operand position. The slash spelling never had
      // the problem, which is what made it hard to see.
      if (RATE_DENOMINATOR_WORDS.has(nextValue) && tokens[pos + 2]?.type === "UNIT") return null;

      // ── Insert a STAR token at the next token's position ──
      const starToken = new LexerToken(
        "STAR", tokenTypeId("STAR"), "*", "*",
        next.offset, 0, next.line, next.col,
      );

      // consumed = 1: only the current token is replaced with [current, STAR]
      // The next token is NOT consumed, it stays for the next iteration
      return { consumed: 1, replacement: [t, starToken] };
    },
  };
}

//#endregion
//#region ─── isInsideRangeContext, Bracket/Call-Paren Context Guard ───────────

/** The most tokens {@link isSingleArgumentCall} reads looking for a call's close, so a hostile line costs a bounded scan. */
const SINGLE_ARGUMENT_SCAN_LIMIT = 10_000;

/**
 * Whether the bracket at `open` opens a call with one argument: no comma at
 * its own depth before its matching close. A comma inside a nested bracket or
 * list belongs to that. A bracket never closed, or one whose close is past
 * the scan limit, is not one.
 *
 * `total(...)` is `sum(...)` only in this one-argument form (`total(1:3)`,
 * `total([1, 2, 3])`), since `total(1, 2, 3)` is the aggregate over a list
 * of values and `sum(x^2, 1:3)`'s element form is `sum`'s alone.
 *
 * @param tokens - The pass's tokens.
 * @param open - The index of an `LPAREN`.
 */
export function isSingleArgumentCall(tokens: readonly Token[], open: number): boolean {
  if (tokens[open]?.type !== "LPAREN") return false;
  let depth = 0;
  const end = Math.min(tokens.length, open + 1 + SINGLE_ARGUMENT_SCAN_LIMIT);
  for (let i = open + 1; i < end; i++) {
    const type = tokens[i].type;
    if (type === "LPAREN" || type === "LBRACKET") depth++;
    else if (type === "RBRACKET") depth--;
    else if (type === "RPAREN") {
      if (depth === 0) return i > open + 1;
      depth--;
    } else if (depth === 0 && type === "COMMA") return false;
  }
  return false;
}

/**
 * The tokens after which a `[` opens a list rather than an index: an opening
 * bracket, a separator or an operator. After anything else (a name, a
 * closing bracket) it indexes or slices the value before it, `m[0:1, 0:1]`.
 * A token not named here keeps the index reading, the one a colon inside a
 * bracket has always had.
 */
const LIST_OPENS_AFTER: ReadonlySet<string> = new Set([
  "LPAREN", "LBRACKET", "COMMA", "SEMICOLON", "EQUALS",
  "PLUS", "MINUS", "STAR", "SLASH", "CARET", "PLUS_MINUS",
  "PLUS_EQUALS", "MINUS_EQUALS", "STAR_EQUALS", "SLASH_EQUALS",
  "EQUALITY", "NEQ", "GTE", "LTE", "LT", "GT", "LOGICAL_AND", "LOGICAL_OR", "THEREFORE",
]);

/**
 * Whether the `[` at `open` indexes or slices the value before it
 * (`m[0:1, 0:1]`) rather than opening a list (`[9:30, 10:15]`). A bracket at
 * the start of the line, or after an opening bracket, a separator or an
 * operator, opens a list.
 *
 * @param tokens - The pass's tokens.
 * @param open - The index of an `LBRACKET`.
 */
export function opensIndex(tokens: readonly Token[], open: number): boolean {
  const prev = tokens[open - 1];
  return prev !== undefined && !LIST_OPENS_AFTER.has(prev.type);
}

/** Whether the `(` at `open` is the bracket of a `map`, `reduce`, `sum` or `prod` call, or of a one-argument `total`. */
function opensMapReduceCall(tokens: readonly Token[], open: number): boolean {
  const prev = tokens[open - 1];
  if (prev === undefined) return false;
  if (prev.type === "MAP" || prev.type === "REDUCE" || prev.type === "SUM_FN" || prev.type === "PROD_FN") return true;
  if (prev.type !== "IDENT") return false;
  const word = prev.value.toLowerCase();
  if (word === "map" || word === "reduce" || word === "sum" || word === "prod") return true;
  // `total(1:3)` is `sum(1:3)`, in the one-argument form only (see isSingleArgumentCall).
  return word === "total" && isSingleArgumentCall(tokens, open);
}

/**
 * Whether token `pos` sits where a bare `NUMBER:NUMBER` means a range rather
 * than a clock time, a lap time or a video timecode: the index or slice of a
 * matrix (`a[0:1, 0:1]`), or the collection a `map`, `reduce`, `sum` or `prod`
 * call works through (`map(f, 0:3)`, `sum(1:3)`, `sum(x^2, 1:3)`).
 *
 * Only the collection is a range. The first of two or more arguments is the
 * element (or the transform), worked out once for each item, so it is never a
 * range, and a colon there is a clock time: `prod(9:30, 10:15)` multiplies a
 * time of day and is refused by name, where it used to stop at the colon with
 * the parser's wording. A list written in brackets is not a range context
 * either: its items are values, so `sum(x, [9:30, 10:15])` holds two clock
 * times. No list ever read a colon as a range (`[1:3]` stopped at the colon),
 * so nothing that answered changes.
 *
 * An ordinary grouping or call bracket is not a range context, so
 * `(9:00) + 5` is a clock time.
 *
 * The time, lap-time and timecode rules each match a bare `NUMBER COLON
 * NUMBER` with no other view of their context, which is why they ask this.
 *
 * The call word is read as written (`prev.value`), not only as the token the
 * map-reduce rule fuses it into: every rule in a normaliser pass sees the
 * same snapshot of tokens, so a rule at a later position cannot see a fusion
 * made at an earlier one in that pass, and on the first pass `map(` is still
 * the word.
 *
 * @param tokens - The pass's tokens.
 * @param pos - The position asked about.
 */
export function isInsideRangeContext(tokens: Token[], pos: number): boolean {
  // One frame for each bracket still open at `pos`: whether it can hold a
  // range at all, and for a call's bracket whether its first comma has been
  // passed, since only the arguments after it are the collection.
  const frames: { safe: boolean; call: boolean; open: number; pastFirst: boolean }[] = [];
  for (let i = 0; i < pos && i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "LBRACKET") {
      frames.push({ safe: opensIndex(tokens, i), call: false, open: i, pastFirst: false });
    } else if (t.type === "LPAREN") {
      const call = opensMapReduceCall(tokens, i);
      frames.push({ safe: call, call, open: i, pastFirst: false });
    } else if (t.type === "RBRACKET" || t.type === "RPAREN") {
      frames.pop();
    } else if (t.type === "COMMA" && frames.length > 0) {
      frames[frames.length - 1].pastFirst = true;
    }
  }
  const top = frames[frames.length - 1];
  if (top === undefined || !top.safe) return false;
  if (!top.call || top.pastFirst) return true;
  // The first argument is the collection only when it is the call's one argument.
  return isSingleArgumentCall(tokens, top.open);
}

//#endregion
//#region ─── createBuiltinNormalizerRules, All Built-in Rules ─────────────────

/**
 * Creates built-in non-phrase normalization rules.
 *
 * Returns implicit multiply insertion (priority 50).
 *
 * **Prefer** calling {@link implicitMultiplyRule} directly with a
 * `canStart` predicate wired to the normalizer's phrase trie:
 * ```ts
 * normalizer.register(implicitMultiplyRule(50, (w) => normalizer.canStartPhrase(w)));
 * ```
 * Without the predicate, this function falls back to a hardcoded
 * {@link PHRASE_START_WORDS} set that won't reflect package-registered phrases.
 *
 * @returns An array of {@link NormalizerRule} instances ready for registration
 */
export function createBuiltinNormalizerRules(): NormalizerRule[] {
  return [
    // ── Implicit operator insertion (priority 50) ──
    implicitMultiplyRule(),
  ];
}

/**
 * Built-in phrase → tokenType mappings.
 *
 * These are registered into the engine's {@link PhraseTrie} during
 * construction. Tests that create a standalone {@link TokenNormalizer}
 * should register these via {@link TokenNormalizer.addPhrase}. The table
 * itself lives in `lexer/BuiltinPhrases.ts`, shared with the lexer's token
 * lookup, and is re-exported here so existing imports keep working.
 */
export { BUILTIN_PHRASES } from "@solve-js/lexer/BuiltinPhrases";

//#endregion
