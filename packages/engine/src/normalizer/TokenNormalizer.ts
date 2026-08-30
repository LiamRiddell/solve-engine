//#region ─── Module Overview ───────────────────────────────────────────────────

/**
 * TokenNormalizer, post-lexer token normalization pass.
 *
 * ## Purpose
 * Applies domain-specific {@link NormalizerRule | NormalizerRules} to the raw
 * token stream produced by the {@link ExpressionLexer}. This keeps the lexer
 * slim and focused on single-token production, while multi-token pattern
 * matching (phrases, implicit operators, domain merges) lives here.
 *
 * ## What rules can do
 * - **Phrase fusion**: Merge consecutive words into compound tokens
 *   (e.g., `IDENT + ... + IDENT` → `CARET`)
 * - **Implicit operator insertion**: Insert missing operators between tokens
 *   (e.g., `NUMBER IDENT` → `NUMBER STAR IDENT`)
 * - **Domain-specific transformations**: Coalesce item names, currency pairs,
 *   percentage syntax, etc.
 *
 * ## Architecture
 * Providers register NormalizerRules alongside Parselets and OpCode handlers
 * via {@link IEnginePackage.normalizerRules}. The normalizer applies them
 * greedily left-to-right in multiple passes with safety limits.
 *
 * @module TokenNormalizer
 */

//#endregion
//#region ─── Imports ──────────────────────────────────────────────────────────

import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, RuleSlot, TokenFusion } from "./NormalizerRule";
import { PhraseTrie } from "./PhraseTrie";
import { RuleIndex, isEmptyMask, effectiveShape } from "./RuleIndex";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

//#endregion
//#region ─── NormalizerOptions, Configuration ────────────────────────────────

/**
 * Configuration options for the normalization pass.
 *
 * These control safety limits and diagnostic callbacks. The defaults
 * are chosen to be generous enough for any realistic expression while
 * preventing runaway token expansion from recursive rules.
 */
export interface NormalizerOptions {
  /**
   * Maximum number of full passes over the token stream before bailing out.
   * Prevents infinite loops from recursive rule chains.
   * @default 100
   */
  maxPasses?: number;

  /**
   * Maximum number of tokens allowed after normalization.
   * If exceeded, an Error is thrown rather than passing a bloated stream
   * to the parser.
   * @default 10000
   */
  maxTokens?: number;

  /**
   * Callback invoked for each fusion event during normalization.
   * Used by diagnostic mode to populate {@link NormalizerOutput.fusions}.
   * When `undefined`, fusions are still tracked internally but no callbacks fire.
   */
  onFusion?: (fusion: TokenFusion) => void;

  /**
   * Try every registered rule at every position, ignoring the shape index.
   *
   * Diagnostic only, and much slower. It exists so the indexed walk can be
   * compared against the unindexed one over a corpus: the index is a pure
   * filter, so the two must agree token for token, and a rule whose declared
   * {@link NormalizerRule.shape} is too narrow shows up as a difference rather
   * than as a feature that quietly stopped working.
   * `NormalizerIndexFidelity.spec` is the consumer.
   *
   * @default false
   */
  ignoreRuleIndex?: boolean;
}

//#endregion
//#region ─── Default Options ──────────────────────────────────────────────────

/** Sensible defaults that catch infinite loops without limiting real expressions. */
const DEFAULT_OPTIONS: Required<NormalizerOptions> = {
  maxPasses: 100,
  maxTokens: 10000,
  onFusion: () => {},
  ignoreRuleIndex: false,
};

//#endregion
//#region ─── createFusedToken, Token Factory ──────────────────────────────────

/**
 * Creates a new normalized token from fused source tokens.
 *
 * The fused token inherits position information (offset, line, column)
 * from the first source token, which preserves source-map accuracy
 * for error messages and diagnostic highlighting.
 *
 * It also records where the source text ENDS, on `sourceEnd`. The start alone
 * is not enough to describe the span a fusion covers, because `text` is the
 * replacement rather than the original: `10 frames` fuses into a FRAME_COUNT
 * whose text is `10`, and a timecode fuses into a token whose text is a
 * comma-separated tuple that appears nowhere in the line. Anything painting the
 * line needs both ends, and only this function is in a position to know them.
 *
 * @param type         - The new token type (e.g., "CARET", "TIMES_BY")
 * @param text         - The combined text representation (e.g., "to the power of")
 * @param sourceTokens - The original tokens being fused (at least 2)
 * @returns A new {@link LexerToken} with the fused type and combined text
 */
export function createFusedToken(
  type: string,
  text: string,
  sourceTokens: Token[]
): Token {
  const first = sourceTokens[0];
  const last = sourceTokens[sourceTokens.length - 1];
  const token = new LexerToken(
    type,
    tokenTypeId(type),
    text,
    text,
    first.offset,
    first.lineBreaks ?? 0,
    first.line,
    first.col,
  );
  // `text`, not `value`: this is where the SOURCE ended, and the two differ
  // for a string literal, whose value is the payload without its quotes.
  token.sourceEnd = last.sourceEnd ?? last.offset + last.text.length;
  return token;
}

/**
 * Record, on a token that replaced several, where its source text ended.
 *
 * Called centrally rather than left to each rule. A rule that builds its
 * replacement by hand rather than through {@link createFusedToken} is doing
 * nothing wrong, and several do: the date-literal rule needs a token whose
 * value is an epoch and whose text is the source, which that factory cannot
 * express. Stamping here means every fusion carries its span, including ones
 * written after this was.
 *
 * Reads `sourceEnd` off the last source token when it has one, so a fusion of
 * a fusion still describes the original text rather than the intermediate.
 *
 * @param fused - The single token the rule produced.
 * @param sourceTokens - The tokens it consumed.
 */
function recordSourceSpan(fused: Token, sourceTokens: Token[]): void {
  const last = sourceTokens[sourceTokens.length - 1];
  if (!last) return;
  fused.sourceEnd = last.sourceEnd ?? last.offset + last.text.length;
}

//#endregion
//#region ─── NON_WORD_TOKEN_TYPES, Type-guard skip set ────────────────────────

/**
 * Token types that can NEVER start a multi-word phrase.
 *
 * Used by {@link normalize} to skip the PhraseTrie walk entirely at
 * positions where the token type makes phrase matching impossible.
 * This avoids even the O(1) {@link PhraseTrie.canStart} check.
 *
 * Types NOT in this set (IDENT, KEYWORD, FUNC, UNIT, and any custom
 * types registered by packages) still pass through to the trie for
 * a full match attempt.
 */
// ── Non-word type ID lookup table (flat Uint8Array, true O(1) array index) ──
//
// Index = token typeId, value = 1 if non-word (skip trie), 0 otherwise.
// Array indexing avoids ALL hashing: no Set.has(), no Map.get(), no string ops.
//
// Custom types from packages get IDs beyond the table length, so the bounds
// check `tid < TABLE.length` safely passes them through to the trie.
//
// Arithmetic operators (PLUS, MINUS, STAR, SLASH, CARET, MOD, PERCENT) are
// intentionally excluded: in keyword locales the lexer maps "times"→STAR,
// "divide"→SLASH etc., and those tokens CAN start phrases like "times by".
/**
 * Token type names that can NEVER start a multi-word phrase.
 *
 * Exported for testing only, consumers should use the type-guard behavior
 * of {@link TokenNormalizer.normalize} rather than this list directly.
 */
export const NON_WORD_NAMES = [
	"NUMBER", "HEX", "BIGINT", "FLOAT",
	"LSHIFT", "RSHIFT", "BIT_AND", "BIT_OR", "BIT_XOR",
	"LPAREN", "RPAREN", "LBRACKET", "RBRACKET",
	"COMMA", "COLON", "EQUALS", "THEREFORE", "PIPE", "AMPERSAND", "AT",
	"SEMICOLON", "QUESTION", "EXCLAMATION",
	"EOF", "WS", "NEWLINE",
] as const;

/**
 * Flat Uint8Array lookup table: index = token typeId, value = 1 if non-word.
 *
 * Exported for testing only, consumers should not depend on the internal
 * table layout, as the set of non-word types may change.
 */
export const NON_WORD_TABLE: Uint8Array = (() => {
	// Resolve all non-word type names to their numeric IDs
	const ids = NON_WORD_NAMES.map(n => tokenTypeId(n));
	// Size the table to cover the largest ID + 1
	const len = Math.max(...ids) + 1;
	const table = new Uint8Array(len);
	// Mark non-word type positions
	for (const id of ids) table[id] = 1;
	return table;
})();

//#endregion
//#region ─── TokenNormalizer Class ─────────────────────────────────────────────

/**
 * Rule names already warned about, so a rule registered into many engines
 * says it once rather than once per engine.
 */
const warnedUnshapedRules = new Set<string>();

/**
 * Warn when a rule declares neither a shape nor a reason for not having one.
 *
 * An unshaped rule is tried at every position of every line, so its cost is
 * paid by every document rather than only by the feature it implements. The
 * warning names the rule and points at the two ways out, and it fires once per
 * rule name per process: a warning a package author sees on every engine they
 * construct is one they learn to filter out, which would make it worse than
 * useless.
 *
 * Deliberately not an error. A rule without a shape is correct, only slower,
 * and refusing to register it would break every package written before the
 * field existed.
 */
function warnIfUnshaped(rule: NormalizerRule): void {
  if (rule.shape !== undefined && rule.shape.length > 0) return;
  if (rule.startTokenTypes !== undefined) return;
  if (rule.unshapedReason !== undefined) return;
  if (warnedUnshapedRules.has(rule.name)) return;
  warnedUnshapedRules.add(rule.name);
  console.warn(
    `[TokenNormalizer] Rule "${rule.name}" declares no \`shape\`, so it is tried at every ` +
    `token of every line and slows down documents that never use it. Declare the tokens it ` +
    `can start at, e.g. shape: [{ types: ["IDENT"], values: ["myword"] }, { types: ["LPAREN"] }]. ` +
    `If it genuinely cannot be described that way, set \`unshapedReason\` to say why and this ` +
    `warning will stop.`,
  );
}

/**
 * Token normalizer: applies {@link NormalizerRule | NormalizerRules} to a token stream.
 *
 * ## Lifecycle
 * 1. **Registration**: Rules are added via {@link register} and sorted by priority
 * 2. **Normalization**: {@link normalize} applies rules greedily left-to-right
 * 3. **Cleanup**: {@link clear} or {@link unregister} removes rules
 *
 * ## Normalization algorithm
 * The normalizer uses a greedy left-to-right multi-pass algorithm:
 * - At each token position, rules are tried in priority order (highest first)
 * - When a rule matches, matched tokens are consumed and replaced
 * - Processing continues from the replacement position
 * - Multiple passes handle cascading matches (one rule's output triggers another)
 * - Safety limits ({@link NormalizerOptions.maxPasses}) prevent infinite loops
 *
 * @example
 * ```ts
 * const normalizer = new TokenNormalizer();
 * normalizer.register(phraseRule);       // "to the power of" → CARET
 * normalizer.register(implicitMultRule); // "2 x" → "2 * x"
 * const normalized = normalizer.normalize(rawTokens);
 * ```
 */
export class TokenNormalizer {
  /** Registered rules, unsorted, the source of truth. */
  private rules: NormalizerRule[] = [];

  /**
   * Priority-sorted copy of {@link rules}, rebuilt lazily on the next
   * {@link normalize} call after a mutation. Rules are registered once at
   * engine/package-registration time and essentially never change during a
   * session, but normalize() runs on every keystroke-driven evaluation, an
   * earlier version re-sorted a fresh copy of `rules` on every single call,
   * which meant every keystroke paid for an allocation + sort of a list that
   * had usually not changed since the last one. `null` means "stale, rebuild
   * on next use"; {@link register}/{@link unregister}/{@link clear} all
   * invalidate it.
   */
  private sortedRulesCache: NormalizerRule[] | null = null;

  /**
   * Per-token-type view of the priority-sorted rules: for a token type, the
   * rules that could match a token of that type (those with no
   * {@link NormalizerRule.startTokenTypes} hint, plus those that list the type),
   * in the same priority order {@link getSortedRules} produces. Built lazily on
   * the first token of each type and cached, so a document of many number and
   * operator tokens never re-tries the many rules that only fire on an
   * identifier. Invalidated alongside {@link sortedRulesCache}.
   */
  private rulesByTokenType = new Map<string, NormalizerRule[]>();

  /**
   * Shape index over the priority-sorted rules, rebuilt alongside
   * {@link sortedRulesCache}. `null` means "stale, rebuild on next use".
   *
   * This is what turns the per-position scan from "try every rule that could
   * fire on this token type" into "AND a few lookup planes and try what
   * survives", which is usually nothing. See {@link RuleIndex}.
   */
  private ruleIndexCache: RuleIndex | null = null;

  /** Reused by {@link rulesAt} so a position's candidate list costs no allocation. */
  private candidateBuffer: NormalizerRule[] = [];

  /**
   * How many times {@link normalize} has run, capped once the index is in use.
   *
   * The index costs a few tens of microseconds to build and pays that back
   * within a line or two, but an engine that normalises exactly once, which is
   * what evaluating a single expression on a fresh engine does, would never
   * reach the payback. Skipping the build on the first call keeps that case at
   * the cost it had before the index existed, and a document reaches line two
   * immediately.
   */
  private normalizeCalls = 0;

  /**
   * Phrase trie for single-pass multi-word phrase fusion.
   * Tried at each token position BEFORE other rules, the trie walk
   * is O(depth) vs O(R × W) for separate rule matching.
   */
  private phraseTrie = new PhraseTrie();

  /** Merged options with defaults applied. */
  private options: Required<NormalizerOptions>;

  // ── Constructor ──────────────────────────────────────────────────────────

  /**
   * @param options - Configuration overrides for safety limits and diagnostic callbacks
   */
  constructor(options: NormalizerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ── Rule Management ──────────────────────────────────────────────────────

  /**
   * Register a normalization rule.
   *
   * Rules are sorted by priority (descending) on each {@link normalize} call.
   * Multiple rules can share the same priority, they are tried in registration
   * order when priorities are equal.
   *
   * @param rule - The rule to register
   */
  register(rule: NormalizerRule): void {
    warnIfUnshaped(rule);
    this.rules.push(rule);
    this.sortedRulesCache = null;
    this.rulesByTokenType.clear();
    this.ruleIndexCache = null;
    this.ruleShapesCache = null;
  }

  /**
   * Unregister a normalization rule by its {@link NormalizerRule.name | name}.
   *
   * If multiple rules share the same name, all are removed. This is safe to
   * call with a name that doesn't match any rule, it simply has no effect.
   *
   * @param ruleName - The name of the rule to remove
   */
  unregister(ruleName: string): void {
    this.rules = this.rules.filter(r => r.name !== ruleName);
    this.sortedRulesCache = null;
    this.rulesByTokenType.clear();
    this.ruleIndexCache = null;
    this.ruleShapesCache = null;
  }

  /**
   * Remove all registered rules, resetting the normalizer to its initial state.
   * Also clears the phrase trie.
   */
  clear(): void {
    this.rules = [];
    this.sortedRulesCache = null;
    this.rulesByTokenType.clear();
    this.ruleIndexCache = null;
    this.ruleShapesCache = null;
    this.phraseTrie = new PhraseTrie();
  }

  /**
   * Priority-sorted view of {@link rules} (descending priority; registration
   * order preserved for ties, since {@link Array.prototype.sort} is stable).
   * Cached until the next mutation. See {@link sortedRulesCache}.
   */
  private getSortedRules(): NormalizerRule[] {
    if (this.sortedRulesCache === null) {
      this.sortedRulesCache = [...this.rules].sort((a, b) => b.priority - a.priority);
    }
    return this.sortedRulesCache;
  }

  /**
   * The priority-sorted rules to try at a token of `type`: every rule with no
   * {@link NormalizerRule.startTokenTypes} hint, plus those that list this type.
   * A rule that declares a different trigger would have returned null here
   * anyway, so omitting it is behaviour-preserving. Built once per distinct type
   * and cached, which is what turns the per-position rule scan from "try all R
   * rules" into "try only the ones that could fire on this token".
   */
  private getRuleIndex(): RuleIndex {
    if (this.ruleIndexCache === null) {
      this.ruleIndexCache = new RuleIndex(this.getSortedRules());
    }
    return this.ruleIndexCache;
  }

  /**
   * The rules to try at a position, in priority order.
   *
   * With a candidate mask, walks its set bits low to high, which is descending
   * priority because bit `i` is the rule at index `i` of the priority-sorted
   * list.
   *
   * The walk shifts a bit at a time rather than jumping to the next set bit
   * with `Math.clz32(bits & -bits)`, which is the idiomatic form and was 36x
   * SLOWER here: 45us per line against 1.2us, measured over the built-in rule
   * set. `clz32` is specified on uint32 and the masks come out of a
   * `Uint32Array` as doubles above 2^31, so every call pays a conversion that
   * swamps the handful of iterations it saves. A de Bruijn table matched the
   * shift scan to within noise and needs a magic constant, so the plain shift
   * wins on both counts. Worst case is 32 iterations per word of pure integer
   * work.
   *
   * With `null` (the {@link NormalizerOptions.ignoreRuleIndex} path) it falls
   * back to the type-bucketed list, which is the behaviour this replaced.
   *
   * Returns a buffer reused across positions, so the caller must finish with it
   * before calling again. Copying the surviving rules out here rather than
   * yielding them lazily is deliberate twice over: it keeps the mask's own
   * scratch buffer from being read after the next position overwrites it, and
   * it avoids a generator on the hottest loop in the pass.
   */
  private rulesAt(mask: Uint32Array | null, type: string): NormalizerRule[] {
    const buffer = this.candidateBuffer;
    buffer.length = 0;

    if (mask === null) {
      const list = this.rulesForTokenType(type);
      for (let i = 0; i < list.length; i++) buffer.push(list[i]);
      return buffer;
    }

    const rules = this.getRuleIndex().rules;
    for (let w = 0; w < mask.length; w++) {
      let bits = mask[w] >>> 0;
      let index = w * 32;
      while (bits !== 0) {
        if ((bits & 1) !== 0) buffer.push(rules[index]);
        bits >>>= 1;
        index++;
      }
    }
    return buffer;
  }

  private rulesForTokenType(type: string): NormalizerRule[] {
    let list = this.rulesByTokenType.get(type);
    if (list === undefined) {
      list = this.getSortedRules().filter(
        (rule) => rule.startTokenTypes === undefined || rule.startTokenTypes.includes(type),
      );
      this.rulesByTokenType.set(type, list);
    }
    return list;
  }

  /**
   * Get the number of currently registered rules (excludes phrase trie entries).
   */
  get ruleCount(): number {
    return this.rules.length;
  }

  /**
   * Every registered rule with the shape it declared, for diagnostic display.
   *
   * Exposes what the index is actually working with: a rule that declares a
   * shape is only tried where that shape can match, and one that declares none
   * is tried at every position of every line. Which is which is invisible from
   * the outside otherwise, and it is the difference between a package that
   * costs the documents that use it and one that costs all of them, so the
   * playground draws it.
   *
   * Returned in priority order, highest first, which is the order the
   * normalizer tries them in.
   */
  private ruleShapesCache: Array<{
    name: string;
    priority: number;
    shape: readonly RuleSlot[];
    unshapedReason?: string;
    indexedSlots: number;
  }> | null = null;

  getRuleShapes(): Array<{
    name: string;
    priority: number;
    shape: readonly RuleSlot[];
    unshapedReason?: string;
    indexedSlots: number;
  }> {
    // Memoised: the answer depends only on the rule set, but the diagnostic
    // pipeline builds a stage per LINE, so recomputing it there made a
    // 25-line document walk every rule 25 times to produce 25 identical lists.
    if (this.ruleShapesCache !== null) return this.ruleShapesCache;
    const index = this.getRuleIndex();
    this.ruleShapesCache = this.getSortedRules().map((rule) => {
      const shape = effectiveShape(rule);
      return {
        name: rule.name,
        priority: rule.priority,
        shape,
        unshapedReason: rule.unshapedReason,
        indexedSlots: Math.min(shape.length, index.depth),
      };
    });
    return this.ruleShapesCache;
  }

  /**
   * How many rules could fire at each position of `tokens`, against the total.
   *
   * The point of the index is that most positions admit no rule at all, and
   * this is what makes that visible rather than asserted.
   */
  getCandidateCounts(tokens: Token[]): number[] {
    const index = this.getRuleIndex();
    const counts: number[] = [];
    for (let pos = 0; pos < tokens.length; pos++) {
      const mask = index.candidates(tokens, pos);
      let n = 0;
      for (let w = 0; w < mask.length; w++) {
        let bits = mask[w] >>> 0;
        while (bits !== 0) { n += bits & 1; bits >>>= 1; }
      }
      counts.push(n);
    }
    return counts;
  }

  // ── Phrase Registration ────────────────────────────────────────────────

  /**
   * Register a multi-word phrase for fusion into a single compound token.
   *
   * This is the preferred way to add phrase patterns. It inserts into the
   * internal {@link PhraseTrie}, which collapses all phrase rules into a
   * single O(depth) trie walk per position, no separate rule scanning.
   *
   * @param phrase    - Multi-word phrase (e.g., "to the power of", "abyssal whip")
   * @param tokenType - Target token type after fusion (e.g., "CARET", "ITEM")
   */
  addPhrase(phrase: string, tokenType: string): void {
    this.phraseTrie.addPhrase(phrase, tokenType);
  }

  /**
   * Check whether a word can start any registered phrase.
   *
   * Used by {@link implicitMultiplyRule} to suppress `*` insertion
   * before phrase-starting identifiers (e.g., "2 power of 3" → `2 ^ 3`,
   * not `2 * power of 3`). Delegates to {@link PhraseTrie.canStart}.
   */
  /**
   * Get all registered phrases and their target token types.
   *
   * Exposes the full phrase trie structure for diagnostic rendering
   * in the playground's NormalizerTab. Returns ALL registered phrases,
   * not just the ones that matched in the last evaluation.
   */
  getPhrases(): Record<string, string> {
    return this.phraseTrie.getAllPhrases();
  }

  canStartPhrase(word: string): boolean {
    return this.phraseTrie.canStart(word);
  }

  // ── Normalization ────────────────────────────────────────────────────────

  /**
   * Normalize a token stream by applying all registered rules.
   *
   * ## Algorithm
   * Applies rules greedily left-to-right in multiple passes:
   * 1. Sort rules by priority (descending)
   * 2. Walk the token stream left to right
   * 3. At each position, try rules in priority order
   * 4. On match: consume matched tokens, insert replacements, restart from insert point
   * 5. On no match: pass token through unchanged
   * 6. Repeat until a full pass produces no changes, or maxPasses is reached
   *
   * ## Fusion tracking
   * When a rule consumes more tokens than it produces, the normalizer calls
   * `onFusion` with a {@link TokenFusion} record for diagnostic collection.
   * This populates {@link NormalizerOutput.fusions} in the playground pipeline view.
   *
   * ## Safety
   * If the normalized token count exceeds {@link NormalizerOptions.maxTokens},
   * an Error is thrown to prevent memory exhaustion from runaway rule expansion.
   *
   * @param tokens   - Raw tokens from the lexer
   * @param onFusion - Optional fusion callback (overrides {@link NormalizerOptions.onFusion})
   * @returns Normalized tokens ready for parsing
   * @throws {Error} If the normalized token count exceeds maxTokens
   */
  normalize(tokens: Token[], onFusion?: (fusion: TokenFusion) => void): Token[] {
    // ── Early exit: nothing to normalize ──
    if (tokens.length === 0) return tokens;

    // Rules are consulted per token type via rulesForTokenType(), which builds
    // on the priority-sorted cache in getSortedRules().
    const fusionHandler = onFusion ?? this.options.onFusion;
    const maxPasses = this.options.maxPasses;
    const maxTokens = this.options.maxTokens;

    // Hoisted out of the pass loop: the rule set cannot change mid-normalize,
    // so the index is resolved once rather than per position.
    const warmedUp = this.normalizeCalls > 0;
    if (!warmedUp) this.normalizeCalls = 1;
    const useIndex = warmedUp && !this.options.ignoreRuleIndex;
    const ruleIndex = useIndex ? this.getRuleIndex() : null;

    let current = tokens;
    let changed = true;
    let passCount = 0;

    // Multi-pass loop: rules may trigger cascading matches across passes
    while (changed && passCount < maxPasses) {
      changed = false;
      passCount++;

      // Built lazily: a pass that changes nothing must not allocate an array
      // and copy every token into it only to throw the copy away. `null` means
      // "nothing has changed yet, `current` is still the answer"; the first
      // rule to fire calls ensureResult() to materialise it. A document whose
      // lines mostly normalise to themselves is the common case, and it now
      // costs no allocation at all.
      let result: Token[] | null = null;
      let pos = 0;

      // Single-pass left-to-right greedy walk
      while (pos < current.length) {
        let matched = false;

        // ── Fast path: phrase trie (O(depth) single walk vs O(R × W) per rule) ──
        // O(1) type-guard: skip trie entirely for tokens that can't start phrases.
        // Flat Uint8Array indexed by typeId, no hashing, no Set lookup, true O(1).
        const tid = current[pos].typeId;
        if (tid >= NON_WORD_TABLE.length || NON_WORD_TABLE[tid] === 0) {
          const trieMatch = this.phraseTrie.matchAt(current, pos);
          if (trieMatch) {
            const sourceTokens = current.slice(pos, pos + trieMatch.consumed);
            if (result === null) result = current.slice(0, pos);
            for (const rt of trieMatch.replacement) {
              result.push(rt);
            }
            if (trieMatch.consumed > 1 && trieMatch.replacement.length === 1) {
              recordSourceSpan(trieMatch.replacement[0], sourceTokens);
              fusionHandler({
                rule: trieMatch.ruleName ?? "phrase-trie",
                sourceTokens,
                fusedToken: trieMatch.replacement[0],
              });
            }
            pos += trieMatch.consumed;
            changed = true;
            continue; // trie matched — skip other rules at this position (no need to set matched)
          }
        }

        // Try, in priority order, only the rules whose declared shape admits
        // this position. The index is a pure filter: bit order is priority
        // order, and a rule it excludes would have returned null here anyway
        // (see RuleIndex). `ignoreRuleIndex` restores the exhaustive scan so
        // the two can be compared.
        const candidates = useIndex
          ? ruleIndex!.candidates(current, pos)
          : null;
        if (candidates !== null && isEmptyMask(candidates)) {
          // Nothing can fire here. This is the common case in running prose,
          // and reaching it costs a few array loads rather than one call per
          // registered rule.
          if (result !== null) result.push(current[pos]);
          pos++;
          continue;
        }
        for (const rule of this.rulesAt(candidates, current[pos].type)) {
          const match = rule.match(current, pos);
          if (match) {
            // Collect source tokens for fusion tracking
            const sourceTokens = current.slice(pos, pos + match.consumed);

            // Insert replacement tokens into result
            if (result === null) result = current.slice(0, pos);
            for (const rt of match.replacement) {
              result.push(rt);
            }

            // Track fusion events for diagnostics:
            // - Multiple tokens → single token: classic fusion
            // - Multiple tokens → fewer tokens: partial fusion
            if (match.consumed > 1 && match.replacement.length === 1) {
              recordSourceSpan(match.replacement[0], sourceTokens);
              fusionHandler({
                rule: rule.name,
                sourceTokens,
                fusedToken: match.replacement[0],
              });
            } else if (match.consumed > 1 && match.replacement.length < match.consumed) {
              for (const rt of match.replacement) {
                fusionHandler({
                  rule: rule.name,
                  sourceTokens,
                  fusedToken: rt,
                });
              }
            }

            // Advance position past consumed tokens
            pos += match.consumed;
            changed = true;
            matched = true;
            break; // Rule matched — restart at new position with highest-priority rules
          }
        }

        if (!matched) {
          // No rule matched at this position, pass token through unchanged.
          // Only copied when an earlier position already forced the array.
          if (result !== null) result.push(current[pos]);
          pos++;
        }
      }

      // Nothing fired anywhere in this pass, so the stream is already its own
      // normal form and `changed` is false; the loop is about to end.
      if (result === null) break;
      const passResult: Token[] = result;

      // Safety: bail if token count explodes (runaway rule expansion)
      if (passResult.length > maxTokens) {
        // A raw Error here would bypass ThreeTierEvaluator's DAG-preservation
        // enrichment on compile failure (it specifically checks for
        // EngineError). Same reasoning as ExpressionEngineSafety.ts's
        // complexity/length checks, which this mirrors.
        throw ErrorFactory.validation(
          "NORMALIZED_TOKEN_LIMIT_EXCEEDED",
          `Normalized token count (${passResult.length}) exceeds safety limit (${maxTokens})`,
          { tokenCount: passResult.length, maxTokens }
        );
      }

      current = passResult;
    }

    return current;
  }
}

//#endregion
