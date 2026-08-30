//#region ─── Module Overview ───────────────────────────────────────────────────

/**
 * NormalizerRule, pluggable token normalization rule for the
 * TokenNormalizer post-lexer pass.
 *
 * ## Purpose
 * After the ExpressionLexer produces raw tokens (numbers, identifiers,
 * operators, etc.), the TokenNormalizer applies domain-specific rules
 * to transform the token stream before parsing. This keeps the lexer
 * focused on single-token production and moves multi-token pattern
 * matching into a dedicated normalization layer.
 *
 * ## How rules work
 * Rules are applied in priority order (highest first). At each token
 * position, the normalizer tries every rule in priority order until one
 * matches. Matched tokens are consumed and replaced; unmatched tokens
 * pass through unchanged.
 *
 * ## What rules can do
 * - **Phrase fusion**: Merge consecutive words into compound tokens
 *   (e.g., `"to" "the" "power" "of"` → `CARET`)
 * - **Implicit operators**: Insert missing operators between tokens
 *   (e.g., `NUMBER IDENT` → `NUMBER STAR IDENT`)
 * - **Domain transformations**: Coalesce item names, currency pairs, etc.
 *
 * ## Why a separate file?
 * This is a duplicate-free copy of the interface defined in
 * TokenNormalizer.ts. Storing it in a separate file avoids circular
 * imports, TokenNormalizer imports NormalizerRule, and rule factories
 * import TokenNormalizer's `createFusedToken`.
 *
 * @module NormalizerRule
 */

//#endregion
//#region ─── Imports ──────────────────────────────────────────────────────────

import type { Token } from "@solve-js/lexer/Token";

//#endregion
//#region ─── NormalizerMatch, Rule Match Result ──────────────────────────────

/**
 * Result of a successful rule match attempt against the token stream.
 *
 * When a {@link NormalizerRule.match} function finds a pattern at the
 * current position, it returns a NormalizerMatch describing how many
 * tokens to consume and what to replace them with.
 *
 * @example
 * ```ts
 * // The phrase "to the power of" (5 tokens) becomes a single CARET token
 * const match: NormalizerMatch = {
 *   consumed: 5,
 *   replacement: [caretToken],
 * };
 * ```
 */
export interface NormalizerMatch {
  /**
   * Number of tokens consumed from the stream at the match position.
   * Must be ≥ 1, a match always advances the cursor.
   */
  consumed: number;

  /**
   * Replacement tokens to insert at the match position.
   * May be empty (deletion), a single token (fusion), or multiple
   * tokens (expansion/splitting).
   */
  replacement: Token[];

  /**
   * Human-readable rule name for diagnostic fusion tracking.
   * When set, the normalizer uses this instead of the rule's `name`
   * in {@link TokenFusion} records. Used by {@link PhraseTrie} to
   * report which specific phrase matched (e.g., "phrase:to the power of").
   */
  ruleName?: string;
}

//#endregion
//#region ─── NormalizerRule, Pluggable Rule Interface ────────────────────────

/**
 * One position of a rule's leading shape, as a declarative constraint.
 *
 * A slot says what the token at that offset from the match position may be.
 * Both fields are optional and an omitted one constrains nothing, so `{}` is a
 * wildcard slot, useful for reaching past a position a rule does not care about
 * to one it does.
 *
 * The exactness contract runs in one direction only, and it is the whole reason
 * this is safe to adopt gradually. Declaring MORE than the rule can match costs
 * a `match()` call that returns null, which is what happens today anyway.
 * Declaring LESS makes the rule unreachable at the positions left out, which is
 * a silent bug. So an incomplete shape (or none at all) is always correct, and
 * only an over-narrow one is wrong. `NormalizerIndexFidelity.spec` checks every
 * declaration against its rule's real behaviour.
 */
export interface RuleSlot {
  /**
   * Token types admitted at this slot. Omit when the type is unconstrained,
   * or when the rule accepts so many that naming them filters nothing.
   */
  readonly types?: readonly string[];

  /**
   * Token values admitted at this slot, compared case-insensitively.
   *
   * This is the axis that separates rules sharing a start type. The
   * call-fusion rules all begin at an `IDENT`, the commonest token in prose,
   * so type alone leaves every one of them a candidate at every word; the word
   * itself is what tells them apart, and each already owns that set as an
   * exported constant.
   *
   * A rule whose own check is case-SENSITIVE (the stock ticker rule matches
   * upper case only) may still declare its lower-cased words here: the index
   * only ever over-approximates, and the rule's own check still runs.
   */
  readonly values?: readonly string[];
}

/**
 * A pluggable normalization rule registered with the TokenNormalizer.
 *
 * Each rule has a {@link name}, {@link priority}, and {@link match} function.
 * The match function receives the current token stream and a position,
 * and returns a {@link NormalizerMatch} on success or `null` on failure.
 *
 * ## Priority ordering
 * Higher priority rules are tried first at each position. This allows
 * long phrases (priority 100, e.g. "to the power of") to match before
 * shorter fragments (priority 80, e.g. "power of").
 *
 * ## Match contract
 * - Must be pure (no side effects, no mutation of input tokens)
 * - Must return `null` for any position that doesn't match
 * - Consumed tokens must be consecutive starting at `pos`
 * - Replacement tokens must be valid for downstream parsing
 *
 * @example
 * ```ts
 * // A phrase fusion rule that converts "to the power of" into CARET
 * const phraseRule: NormalizerRule = {
 *   name: 'phrase:to the power of',
 *   priority: 100,
 *   match: (tokens, pos) => {
 *     if (pos + 4 > tokens.length) return null;
 *     const phrase = tokens.slice(pos, pos + 5)
 *       .map(t => t.value.toLowerCase()).join(' ');
 *     if (phrase === 'to the power of') {
 *       return {
 *         consumed: 5,
 *         replacement: [createFusedToken('CARET', 'to the power of', tokens.slice(pos, pos + 5))],
 *       };
 *     }
 *     return null;
 *   },
 * };
 * ```
 */
export interface NormalizerRule {
  /**
   * Human-readable name for debugging and diagnostic display.
   * Convention: `"category:description"`, e.g. `"phrase:to the power of"`.
   */
  readonly name: string;

  /**
   * Priority for ordering rules. Higher values are tried first.
   * Recommended ranges:
   * - 100: Long multi-word phrase fusion (e.g., "to the power of")
   * - 80:  Short phrase fusion (e.g., "power of", "times by")
   * - 50:  Implicit operator insertion (e.g., implicit multiply)
   * - 20:  Domain-specific transformations
   */
  readonly priority: number;

  /**
   * The token types this rule can match at position `pos`, as a performance
   * hint. When present, the normalizer only tries the rule at a position whose
   * token type is in this list, and skips it everywhere else.
   *
   * This MUST be exact: a rule whose `match()` begins `if (tokens[pos].type !==
   * "IDENT") return null` can only ever match an `IDENT`, so declaring
   * `["IDENT"]` changes nothing (the rule would have returned null at every
   * other position anyway) while letting the normalizer skip it for the many
   * number/operator tokens in a document. Omit it, or list every type the rule
   * can match, when the first token is not fixed; an omitted hint means "always
   * try", the original behaviour. Declaring a type the rule cannot actually
   * start on is harmless; declaring too FEW (missing a type it can match) makes
   * the rule silently unreachable there, which is a bug.
   */
  readonly startTokenTypes?: readonly string[];

  /**
   * The rule's leading shape: what the tokens from the match position onward
   * may be, one {@link RuleSlot} per position.
   *
   * This generalises {@link startTokenTypes}, which constrains only the first
   * token. Constraining the first token alone is not enough to separate the
   * rules that matter: every rule firing on a bare `NUMBER` declares the same
   * start type, so they all remain candidates at every number in the document.
   * What distinguishes them is the token after it, `NUMBER COLON` being a clock
   * time and `NUMBER SLASH` a network address, and that fact is only usable by
   * an index if the rule states it rather than hiding it inside `match()`.
   *
   * Depth is the rule's choice, not the interface's. The normalizer builds one
   * lookup plane per declared slot and intersects them, so a rule that declares
   * three positions is filtered on three. It may also index fewer planes than
   * were declared, which stays correct for the reason given on {@link RuleSlot}:
   * a shallower filter admits more candidates, and each surviving rule still
   * runs its own `match()`.
   *
   * Prefer this to {@link startTokenTypes} in new rules. When both are given,
   * this wins; `startTokenTypes: ["IDENT"]` means exactly `shape: [{ types:
   * ["IDENT"] }]`.
   *
   * @example
   * ```ts
   * // 9:00am, 16:00, a clock time is a number followed by a colon
   * shape: [{ types: ["NUMBER"] }, { types: ["COLON"] }]
   *
   * // sha256("hi"), a known word followed by an opening parenthesis
   * shape: [{ types: ["IDENT"], values: HASH_NAMES }, { types: ["LPAREN"] }]
   * ```
   */
  readonly shape?: readonly RuleSlot[];

  /**
   * Why this rule cannot declare a {@link shape}, for the few that genuinely
   * cannot.
   *
   * A rule with neither a shape nor a `startTokenTypes` hint is tried at every
   * position of every line, so it raises the cost of the whole document rather
   * than only its own feature. Registering one logs a warning naming the rule,
   * which is how a package author finds out before their users do.
   *
   * Some rules really cannot be described by a leading shape: an unbounded
   * forward scan, a greedy match against a table the host mutates at runtime.
   * Setting this states that case, silences the warning, and leaves the reason
   * in the code where the next person will read it. It is deliberately a
   * sentence and not a boolean, because "why" is the part worth keeping.
   *
   * @example
   * ```ts
   * unshapedReason: "Scans forward an unbounded number of NUMBER UNIT pairs, so no fixed leading shape describes it.",
   * ```
   */
  readonly unshapedReason?: string;


  /**
   * Attempt to match a pattern starting at position `pos` in the token stream.
   *
   * @param tokens - The current token stream (may be partially normalized from prior passes)
   * @param pos    - The current position to attempt matching from
   * @returns A {@link NormalizerMatch} if the pattern is found, or `null` if no match
   */
  match(tokens: Token[], pos: number): NormalizerMatch | null;
}

//#endregion
//#region ─── TokenFusion, Fusion Event Record ────────────────────────────────

/**
 * Record of a token fusion event performed by the normalizer.
 *
 * When a rule merges multiple source tokens into fewer replacement tokens,
 * the normalizer fires a {@link NormalizerOptions.onFusion | fusion callback}
 * with this record. The playground uses these records to render the
 * fusion detail table showing exactly which tokens were merged and by
 * which rule.
 *
 * @example
 * ```ts
 * // "to" "the" "power" "of" fused into CARET "^"
 * const fusion: TokenFusion = {
 *   rule: "phrase:to the power of",
 *   sourceTokens: [toToken, theToken, powerToken, ofToken],
 *   fusedToken: caretToken,
 * };
 * ```
 */
export interface TokenFusion {
  /** The name of the rule that triggered this fusion (e.g., "phrase:to the power of") */
  rule: string;

  /** The original tokens before fusion, always ≥ 2 tokens */
  sourceTokens: Token[];

  /** The resulting fused token with its new type and combined value */
  fusedToken: Token;
}

//#endregion
