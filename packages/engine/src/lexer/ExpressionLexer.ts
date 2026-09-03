import { Token, tokenTypeId, registerAllTokenTypes } from '@solve-js/lexer/Token';
import { knownUnits } from '@solve-js/lexer/units';
import { getLocale, type ILocale } from '@solve-js/constants/locales';
import { ErrorFactory, EngineError } from '@solve-js/errors/UnifiedErrorFramework';
import type { TokenLookup } from '@solve-js/lexer/TokenClassRegistry';

// Bootstrap all token types at module load
registerAllTokenTypes();

// The ids of the token types this scanner constructs directly, resolved once.
// tokenTypeId() is a Map lookup on a string key; it was being called at every
// token construction (65 sites) to re-resolve a value that registerAllTokenTypes
// above fixed at load, which measured at 5.9 ns against 0.4 ns for a constant,
// roughly a twentieth of the cost of lexing a token. Types chosen at run time
// (a plugin keyword, a locale keyword, an operator table entry) still resolve
// through tokenTypeId() where they are used.
const TT_BACKTICK_OPEN = tokenTypeId('BACKTICK_OPEN');
const TT_BIGINT = tokenTypeId('BIGINT');
const TT_COMMENT = tokenTypeId('COMMENT');
const TT_CURRENCY_SYMBOL = tokenTypeId('CURRENCY_SYMBOL');
const TT_DOLLAR = tokenTypeId('DOLLAR');
const TT_DOT = tokenTypeId('DOT');
const TT_EURO = tokenTypeId('EURO');
const TT_HEX_COLOUR = tokenTypeId('HEX_COLOUR');
const TT_IDENT = tokenTypeId('IDENT');
const TT_INLINE_SOLVE_START = tokenTypeId('INLINE_SOLVE_START');
const TT_LSHIFT = tokenTypeId('LSHIFT');
const TT_NEQ = tokenTypeId('NEQ');
const TT_NUMBER = tokenTypeId('NUMBER');
const TT_PLUS_MINUS = tokenTypeId('PLUS_MINUS');
const TT_POUND = tokenTypeId('POUND');
const TT_RSHIFT = tokenTypeId('RSHIFT');
const TT_RUBLE = tokenTypeId('RUBLE');
const TT_SLASH = tokenTypeId('SLASH');
const TT_STAR = tokenTypeId('STAR');
const TT_STRING = tokenTypeId('STRING');
const TT_TAG = tokenTypeId('TAG');
const TT_UNIT = tokenTypeId('UNIT');
const TT_URSHIFT = tokenTypeId('URSHIFT');
const TT_WON = tokenTypeId('WON');
const TT_YEN = tokenTypeId('YEN');

// ── Markdown line classification (Phase B) ──────────────────────────────

/** What a line is, structurally, before anything tries to evaluate it. */
export type MarkdownLineType =
  | 'expression'
  | 'prose'
  | 'heading'
  | 'blockquote'
  | 'list'
  | 'code_fence'
  | 'math_fence'
  | 'table'
  | 'table_separator'
  | 'hr'
  | 'wikilink'
  | 'comment'
  | 'empty';

/**
 * What a line is and whether it holds anything to evaluate.
 *
 * Produced by a character-level scan that never consults the keyword, unit or
 * operator tables, so any lexer gives the same answer for the same line. See
 * `__tests__/lexer/LineClassificationIsVocabularyIndependent.spec.ts`.
 */
export interface LineClassification {
  /** The type of this markdown line */
  type: MarkdownLineType;
  /** Whether this line should be skipped (no expression evaluation) */
  skip: boolean;
  /** Whether the line contains inline solve markers (`s`...``) */
  hasInlineSolve: boolean;
  /**
   * Offset of the first evaluable character, when structural markup precedes
   * it. Absolute, in the same coordinates the classification was asked for,
   * and absent when the whole line is evaluable.
   *
   * A list marker is markup, not arithmetic. `- 100 + 20` is a bullet holding
   * `100 + 20`, but `-` is also a prefix operator, so without this the line
   * evaluated as negative one hundred and answered -80: a wrong answer that
   * looks like a right one. `*` and `+` in the same position could not even do
   * that, one erroring and the other correct by luck, so the three markers
   * disagreed with each other about the same document.
   *
   * Consumers must slice both the text and the token stream from here, or the
   * two describe different lines.
   */
  contentOffset?: number;
}

/** Inline solve position with precise coordinates */
export interface InlineSolveSpan {
  /** Character offset of the `s`` marker */
  start: number;
  /** Character offset past the closing `` ` `` */
  end: number;
  /** The expression text between the backticks */
  expression: string;
  /** 1-based column of the `s`` marker */
  columnNumber: number;
  /** Token index of INLINE_SOLVE_START in the line's token array (set during tokenization). */
  startTokenIndex?: number;
  /** Token index of closing BACKTICK_OPEN in the line's token array (set during tokenization). */
  endTokenIndex?: number;
}

/**
 * Result from a single line processed by scanDocument().
 * Combines line classification, tokenized tokens, and inline solve spans
 * into a single structure, eliminating the need for separate classifyLine()
 * findInlineSolves(), and per-line Lexer.reset() calls.
 */
export interface ScanLineResult {
  /** The raw line text (without trailing newline). */
  text: string;
  /** 1-based line number within the document. */
  lineNumber: number;
  /** Character offset of the line start within the document. */
  startOffset: number;
  /** Character offset of the line end (before newline). */
  endOffset: number;
  /** The line classification. */
  classification: LineClassification;
  /** Tokenized tokens (empty array if line is skipped). */
  tokens: Token[];
  /** Inline solve spans found in this line (empty if none). */
  inlineSolves: InlineSolveSpan[];
  /**
   * The structured error the tokeniser raised on this line, if it raised one
   * (an unterminated string literal is the one it can raise today). The line
   * carries no tokens then, and the rest of the document is unaffected: a
   * half-typed quote used to escape {@link ExpressionLexer.scanDocument} as
   * a throw and take every other line's result down with it.
   */
  error?: EngineError;
}

// ── Character class constants ─────────────────────────────────────────────
// Used as the result of the CHAR_CLASS lookup table. V8 compiles the
// outer switch on these small integer constants into a jump table.
const enum CharClass {
  SKIP       = 0,  // Invalid / control / unicode fallback
  WHITESPACE = 1,  // space, tab, \n, \r
  DIGIT      = 2,  // 0-9
  ALPHA      = 3,  // a-z, A-Z, _
  DOT        = 4,  // . (could be decimal point or DOT token)
  OPERATOR   = 5,  // + - * / ^ % ( ) [ ] { } , : ; = ? & | ~ ! < >
  QUOTE      = 6,  // "
  HASH       = 7,  // # (comment)
  DOLLAR     = 8,  // $
  POUND      = 9,  // £ (U+00A3)
  EURO       = 10, // € (U+20AC)
  BACKTICK   = 11, // `
}

// ── Static character class table (built once at module load) ──────────────
function buildCharClassTable(): Uint8Array {
  const table = new Uint8Array(128);

  // Digits 0-9
  for (let i = 48; i <= 57; i++) table[i] = CharClass.DIGIT;

  // Uppercase A-Z
  for (let i = 65; i <= 90; i++) table[i] = CharClass.ALPHA;

  // Lowercase a-z
  for (let i = 97; i <= 122; i++) table[i] = CharClass.ALPHA;

  // Underscore
  table[95] = CharClass.ALPHA;

  // Dot
  table[46] = CharClass.DOT;

  // Whitespace
  table[32] = CharClass.WHITESPACE;  // space
  table[9]  = CharClass.WHITESPACE;  // tab
  table[10] = CharClass.WHITESPACE;  // \n
  table[13] = CharClass.WHITESPACE;  // \r

  // Operators / punctuation
  table[33] = CharClass.OPERATOR;  // !
  table[37] = CharClass.OPERATOR;  // %
  table[38] = CharClass.OPERATOR;  // &
  table[40] = CharClass.OPERATOR;  // (
  table[41] = CharClass.OPERATOR;  // )
  table[42] = CharClass.OPERATOR;  // *
  table[43] = CharClass.OPERATOR;  // +
  table[44] = CharClass.OPERATOR;  // ,
  table[45] = CharClass.OPERATOR;  // -
  table[47] = CharClass.OPERATOR;  // /
  table[58] = CharClass.OPERATOR;  // :
  table[59] = CharClass.OPERATOR;  // ;
  table[60] = CharClass.OPERATOR;  // <
  table[61] = CharClass.OPERATOR;  // =
  table[62] = CharClass.OPERATOR;  // >
  table[63] = CharClass.OPERATOR;  // ?
  table[91] = CharClass.OPERATOR;  // [
  table[93] = CharClass.OPERATOR;  // ]
  table[94] = CharClass.OPERATOR;  // ^
  table[123] = CharClass.OPERATOR; // {
  table[124] = CharClass.OPERATOR; // |
  table[125] = CharClass.OPERATOR; // }
  table[126] = CharClass.OPERATOR; // ~
  // "@" was previously unclassified (defaulted to CharClass.SKIP, silently
  // dropped before ever reaching OP_MAP). See OP_MAP's own "@" entry doc
  // comment for why this is being activated now.
  table[64] = CharClass.OPERATOR;  // @

  // Other
  table[34] = CharClass.QUOTE;    // "
  table[35] = CharClass.HASH;     // #
  table[36] = CharClass.DOLLAR;   // $
  table[96] = CharClass.BACKTICK; // `

  return table;
}

/**
 * Whether a non-ASCII code point separates tokens rather than joining them.
 *
 * The CHAR_CLASS table above is 128 entries wide, so every code point past
 * ASCII falls through to one branch that reads it as part of an identifier.
 * That is right for `café`, `日本語` and emoji, and wrong for the dozen or so
 * code points that are whitespace without being ASCII whitespace. Without this,
 * a no-break space between two operands JOINED them: `1<NBSP>+<NBSP>1` lexed as
 * one identifier and reported "Undefined variable: 1 + 1", and a byte-order
 * mark at the head of a file did the same to its first line. Both arrive
 * constantly in pasted text, from a web page, a word processor, a spreadsheet
 * export, or a Windows editor that writes a BOM.
 *
 * The zero-width JOINERS are deliberately absent. U+200D is what holds a family
 * emoji together as one grapheme, and U+200C is its non-joining partner; both
 * bind their neighbours rather than separating them, so they stay identifier
 * characters. U+200B, the zero-width SPACE, is a separator despite being
 * invisible, which is exactly why it is worth handling: it is unreadable on
 * screen and would otherwise silently break the line it lands in.
 *
 * @param cc - A UTF-16 code unit, only meaningful for values >= 128.
 * @returns True when the character should be skipped like a space.
 */
function isUnicodeSpace(cc: number): boolean {
  return (
    cc === 0x0085 ||                    // NEL, next line
    cc === 0x00A0 ||                    // no-break space
    cc === 0x1680 ||                    // ogham space mark
    (cc >= 0x2000 && cc <= 0x200A) ||   // en quad through hair space, incl. figure/thin space
    cc === 0x200B ||                    // zero-width space
    cc === 0x2028 ||                    // line separator
    cc === 0x2029 ||                    // paragraph separator
    cc === 0x202F ||                    // narrow no-break space
    cc === 0x205F ||                    // medium mathematical space
    cc === 0x3000 ||                    // ideographic space
    cc === 0xFEFF                       // byte-order mark / zero-width no-break space
  );
}

// ── Monomorphic Token class ───────────────────────────────────────────────
// V8 assigns a single stable HiddenClass because all properties are
// initialized in the constructor and never added/removed afterwards.
// This enables fast property access (inline cache hits) and allows
// allocation in V8's nursery (cheap GC).
// All 9 fields are always set, no optional fields, no different shapes.
/**
 * A token, as the lexer produces it.
 *
 * A class rather than an object literal because tokens are created on every
 * keystroke and a shared hidden class keeps that path predictable for the
 * engine running it.
 */
export class LexerToken implements Token {
  constructor(
    public type: string,
    public typeId: number,
    public value: string,
    public text: string,
    public offset: number,
    public lineBreaks: number,
    public line: number,
    public col: number,
    /** See {@link Token.sourceEnd}. Set only on normalizer-fused tokens. */
    public sourceEnd?: number,
  ) {}
}

// ── Two-character operator lookup ─────────────────────────────────────────
// Maps first-char → (second-char → token type). Used for operators like
// ==, !=, >=, <=, **, <<, >>.
interface TwoCharOpMap {
  [firstChar: number]: { [secondChar: number]: string };
}
const TWO_CHAR_OPS: TwoCharOpMap = {
  61: { 61: 'EQUALITY', 62: 'THEREFORE' },  // ==, => (opposite char order from >='s GTE below — no collision)
  33: { 61: 'NEQ' },       // !=
  62: { 61: 'GTE' },       // >=
  60: { 61: 'LTE' },       // <=
  38: { 38: 'LOGICAL_AND' }, // &&
  124: { 124: 'LOGICAL_OR' }, // ||
  43: { 61: 'PLUS_EQUALS' },  // +=  (compound assignment, running totals)
  45: { 61: 'MINUS_EQUALS' }, // -=  (neither + nor - had a two-char op before)
  // Note: ** is NOT a single token, the existing moo lexer emits two
  // separate STAR tokens, and the parser consumes them that way.
  // 42: { 42: 'EXPONENT' },  // **, disabled for moo compatibility
};
// Note: LSHIFT (<<) and RSHIFT (>>) are handled separately because
// 60 is also used for LTE, so we check LTE first then LSHIFT.

// ── Single-character operator lookup ──────────────────────────────────────
const OP_MAP: Record<number, string> = {
  43: 'PLUS',     // +
  45: 'MINUS',    // -
  42: 'STAR',     // *
  47: 'SLASH',    // /
  94: 'CARET',    // ^
  37: 'PERCENT',  // %
  40: 'LPAREN',   // (
  41: 'RPAREN',   // )
  91: 'LBRACKET', // [
  93: 'RBRACKET', // ]
  123: 'LBRACE',  // {
  125: 'RBRACE',  // }
  44: 'COMMA',    // ,
  58: 'COLON',    // :
  59: 'SEMICOLON',// ;
  61: 'EQUALS',   // =
  63: 'QUESTION', // ?
  33: 'BANG',     // !
  38: 'BIT_AND',  // &
  124: 'BIT_OR',  // |
  60: 'LT',       // <
  62: 'GT',       // >
  126: 'BIT_NOT', // ~
  // "@", activates the token type name already dormant-reserved for this
  // exact purpose (see Token.ts's OVER/RATE_AT doc comment and
  // normalizer/TokenNormalizer.ts's NON_WORD_NAMES, both of which already
  // anticipated "AT" as a future "@" symbol token before this addition).
  // Backs the time package's video-timecode literal's alternate fps
  // separator (`01:02:03:04 @ 30fps`, equivalent to `... at 30fps`). See
  // packages/time/parselets/VideoTimecodeParselet.ts.
  64: 'AT',       // @
};

/**
 * Plugin interface for extending the ExpressionLexer with custom tokens.
 *
 * Plugins can register:
 * - `keywords`: Map identifier strings to custom token types (checked after locale keywords).
 * - `operators`: Map multi-character operator sequences to custom token types.
 * - `units`: Register additional unit identifiers (checked alongside built-in units).
 *
 * Multi-word phrase matching has been moved to the TokenNormalizer post-lexer
 * stage. To register phrase patterns, use `IEnginePackage.normalizerRules` instead.
 *
 * All registrations are additive, built-in patterns still work.
 */
export interface LexerVocabulary {
  /**
   * Keyword → tokenType mappings. Each key is a lowercase identifier that,
   * when encountered, will emit the specified token type instead of IDENT.
   * These are checked AFTER the locale's built-in keywordMap, so locale
   * keywords take priority.
   */
  keywords?: Record<string, string>;

  /**
   * Multi-character operator → tokenType mappings. Each key is the exact
   * character sequence (e.g., "::", "->", "=>") and the value is the token
   * type to emit. Two-character operators take priority during matching.
   * Built-in operators (==, !=, >=, <=, <<, >>) always take priority.
   */
  operators?: Record<string, string>;

  /**
   * Additional unit identifiers to recognize (e.g., "gp", "osrs", "tile").
   * These are checked alongside the built-in `knownUnits` set.
   */
  units?: string[];

  /**
   * Whole-line patterns matched against the RAW line text, BEFORE any
   * per-character tokenization begins.
   *
   * Every other extension point in this file (`keywords`/`operators`/
   * `units`, plus `IEnginePackage.phrases`/`normalizerRules`) transforms
   * a token STREAM -- they all assume the line is, at some granularity,
   * valid Solve syntax. This hook exists for the one shape that isn't:
   * a package whose grammar captures arbitrary free-form text terminated
   * by a fixed marker (e.g. a natural-language query ending in `= ?`),
   * where the text itself ("distance to the moon") would never tokenize
   * or parse as a normal expression and must be captured verbatim
   * instead -- see `packages/knowledge/` for the reference use.
   *
   * Each entry's `pattern` is tested (via `RegExp.exec`) against the
   * full, untrimmed line text. If it matches AND capture group 1 is
   * non-empty after trimming, the ENTIRE line becomes a single
   * synthetic token of `tokenType` whose `value`/`text` is the trimmed
   * capture group -- the character-by-character scanner never runs for
   * that line. Patterns are tried in registration order; the first
   * match wins. A package registering a rule here still needs a
   * `prefixParselets` entry for `tokenType` to actually consume the
   * resulting token.
   *
   * Because this bypasses tokenization entirely, a matching line can
   * contain characters that would otherwise be lexer errors (unmatched
   * quotes, stray symbols, ...) -- by design, since the whole point is
   * to hand the package raw text the normal pipeline was never meant to
   * parse.
   */
  rawLinePatterns?: Array<{ pattern: RegExp; tokenType: string }>;
}

// ── Expression gating (L1) ──────────────────────────────────────────────
// Pre-computed Set of character codes that indicate an expression might
// be present. Used by hasExpressionIndicators() to gate prose lines
// before full tokenization.
//
// NOTE: Currently unused, L1 prose gating was removed from classifyFromPositions()
// because it incorrectly skipped keyword-only lines ("pi"), single identifiers
// ("hello"), and short alpha lines. Retained for future re-implementation with
// keyword-awareness and proper test coverage.
const EXPRESSION_INDICATOR_CODES = (() => {
  const set = new Set<number>();
  // Digits 0-9
  for (let i = 48; i <= 57; i++) set.add(i);
  // Operators / punctuation
  // Note: colon (58) is intentionally excluded, it's common in prose
  // (e.g., "Subject: Hello world") and would cause false-positive
  // expression classification. Variable assignment lines like
  // ":myVar = 5" are still caught by '=' and digit indicators.
  const opCodes = [43, 45, 42, 47, 94, 37, 40, 41, 91, 93, 123, 125, 61, 60, 62, 33, 38, 124, 126, 59, 63];
  for (const c of opCodes) set.add(c);
  // Currency
  set.add(36);   // $
  set.add(0x00A3); // £
  set.add(0x20AC); // €
  set.add(0x00A5); // ¥
  set.add(0x20BD); // ₽
  set.add(0x20A9); // ₩
  // Backtick (inline solve)
  set.add(96);   // `
  // Dot (could be decimal)
  set.add(46);   // .
  // Hash (comment, still an expression indicator)
  set.add(35);   // #
  return set;
})();

// ── ExpressionLexer ───────────────────────────────────────────────────────
/**
 * Character-by-character tokenizer for expression text.
 *
 * Scans a raw line/expression string into a stream of typed tokens
 * (numbers, identifiers, operators, units, keywords, ...), handling
 * markdown-line classification (`classifyLine`), inline `` s`...` `` solve
 * spans, and package-contributed vocabulary (registered via
 * {@link registerVocabulary}/{@link unregisterVocabulary}, keywords
 * operators, and units a package wants recognized as their own token
 * types rather than falling through to generic identifiers).
 *
 * Most consumers should use the higher-level {@link Lexer} wrapper, which
 * adds streaming `next()`/`peek()` access over this class's scan results.
 */
export class ExpressionLexer {
  private static readonly CHAR_CLASS = buildCharClassTable();
  /**
   * Configured TokenLookup from TokenClassRegistry. When set, replaces
   * the internal keyword map and unit set with registry-built equivalents.
   * Enables data-driven keyword/unit registration across locale keywords,
   * provider keywords, and plugins.
   *
   * Set at construction time via the constructor parameter. Plugin-registered
   * keywords/units (via registerVocabulary()) are checked alongside
   * the configuredLookup, neither source is bypassed.
   */	private configuredLookup: TokenLookup | null = null;

	// Instance state
  private input: string = '';
  private pos: number = 0;
  private len: number = 0;

  // Line / column tracking (1-indexed)
  private line: number = 1;
  private lineStartPos: number = 0;

  // Open-bracket context stack for the current line, one entry per unclosed
  // `(`/`[`, `true` when a comma inside it is a separator rather than a
  // thousands group. A `[` (vector/matrix) and a CALL `(` (`rgb(255,255,255)`,
  // preceded by an identifier) are separator contexts; a bare GROUPING `(`
  // (`(1,000)`, preceded by an operator or the line start) is not, so a
  // parenthesised thousands number still reads as one scalar. The number scanner
  // consults the innermost entry. Tracked here because the flat token stream
  // carries no nesting otherwise; reset per line, so an unbalanced bracket
  // cannot bleed the decision into the next.
  private groupingStack: boolean[] = [];

  // Keyword map: lowercase identifier → token type (locale keywords only)
  private keywordMap: Map<string, string>;

  // ── Merged lookup collections (keywordMap + pluginKeywordMap, knownUnits + pluginUnits)
  private mergedKeywords: Map<string, string>;
  // ReadonlySet: only membership is ever tested, which lets the common
  // no-plugin-units case share the built-in `knownUnits` set without a copy.
  private mergedUnits: ReadonlySet<string>;

  // Plugin-extensible keyword map (merged with locale keywordMap)
  private pluginKeywordMap: Map<string, string> = new Map();

  // Plugin-extensible two-char operators: firstChar → (secondChar → tokenType)
  private pluginOperators: Map<number, Map<number, string>> = new Map();

  // Plugin-extensible units (merged with knownUnits)
  private pluginUnits: Set<string> = new Set();	// Fast-path guards: skip plugin lookups entirely when no plugins registered
	private hasPluginOps = false;

  // Locale for function-identifier lookups
  private localeCode: string;
  private locale: ILocale;

  /**
   * Inline solve spans collected during the most recent tokenization pass.
   * Populated by [Symbol.iterator]() and consumed by scanDocument().
   */
  _inlineSolveSpans: InlineSolveSpan[] = [];

  // Plugin-extensible raw-line patterns. See LexerVocabulary.rawLinePatterns.
  private pluginRawLinePatterns: Array<{ pattern: RegExp; tokenType: string }> = [];

  /**
   * If a `rawLinePatterns` rule matches the FULL text most recently passed
   * to {@link reset}, this holds the single synthetic token that
   * {@link tokenizeAll} should return instead of running the
   * character-by-character scanner. Cleared (re-evaluated) on every
   * {@link reset} call. `null` when no plugin registered any raw-line
   * patterns, or none matched, the overwhelmingly common case, checked
   * with a `length === 0` guard before ever touching this field so a
   * plugin-free lexer pays zero cost for the feature.
   */
  private pendingRawLineToken: Token | null = null;

  /**
   * Test `text` against every registered `rawLinePatterns` rule, in
   * registration order. Returns a synthetic token for the first rule
   * whose `pattern` matches AND whose capture group 1 is non-empty after
   * trimming; returns `null` if no rule matches (the normal
   * character-by-character scanner should run instead).
   */
  private matchRawLine(text: string): Token | null {
    for (const rule of this.pluginRawLinePatterns) {
      const m = rule.pattern.exec(text);
      if (m && typeof m[1] === 'string') {
        const value = m[1].trim();
        if (value.length > 0) {
          return new LexerToken(rule.tokenType, tokenTypeId(rule.tokenType), value, value, 0, 0, this.line, 1);
        }
      }
    }
    return null;
  }

  /** Rebuild merged keyword and unit collections after plugin registration. */
  // `knownUnits` is a 1000+ entry built-in set. A single combined rebuild used
  // to copy it (and the whole keyword map) on every registerVocabulary call, so
  // each keyword-only package paid for it for nothing, the single largest cost
  // in engine construction. The merged keyword map is now maintained
  // incrementally (a plugin keyword can never shadow a built-in, so it is a plain
  // set/delete on the existing map, see registerVocabulary), and only the units
  // still need an occasional rebuild, done here.
  private rebuildMergedUnits(): void {
    // No plugin units is the common case: reference the built-in set directly
    // rather than copying 1000+ entries. mergedUnits is read-only (membership
    // tests only), so sharing the constant is safe; a later plugin unit builds a
    // fresh union instead of mutating it.
    this.mergedUnits = this.pluginUnits.size === 0
      ? knownUnits
      : new Set([...knownUnits, ...this.pluginUnits]);
  }

  constructor(localeCode = 'en', lookup?: TokenLookup) {
    this.localeCode = localeCode;
    this.locale = getLocale(localeCode);
    this.configuredLookup = lookup ?? null;
    this.keywordMap = new Map<string, string>();
    for (const [k, v] of Object.entries(this.locale.keywordMap)) {
      this.keywordMap.set(k.toLowerCase(), v);
    }
    this.mergedKeywords = new Map(this.keywordMap);
    // No plugin units yet: share the built-in set (read-only). A later plugin
    // unit builds a fresh union in rebuildMergedUnits() rather than mutating it.
    this.mergedUnits = knownUnits;
  }

  /**
   * Register a plugin to extend the lexer with custom tokens.
   *
   * All registrations are additive, built-in patterns still work.
   * Keywords, operators, and units from the plugin are merged
   * with existing ones. Calling multiple times adds more entries.
   *
   * Note: multi-word phrases are now handled by the TokenNormalizer
   * (see `IEnginePackage.normalizerRules`), not the lexer.
   *
   * Built-in tokens CANNOT be overridden. Throws a EngineError if the
   * plugin attempts to register a keyword, operator, or unit
   * that conflicts with a built-in one.
   */
  registerVocabulary(plugin: LexerVocabulary): void {
    if (plugin.keywords) {
      for (const [keyword, tokenType] of Object.entries(plugin.keywords)) {
        const lower = keyword.toLowerCase();
        // Guard: prevent overriding built-in locale keywords
        if (this.keywordMap.has(lower)) {
          throw ErrorFactory.config(
            'PLUGIN_KEYWORD_COLLISION',
            `Plugin keyword "${keyword}" conflicts with built-in keyword ` +
            `(type: ${this.keywordMap.get(lower)}). Built-in keywords cannot be overridden.`,
            { keyword, builtinType: this.keywordMap.get(lower) }
          );
        }
        this.pluginKeywordMap.set(lower, tokenType);
        // Straight into the merged view: guarded above against shadowing a
        // built-in, so no full rebuild is needed.
        this.mergedKeywords.set(lower, tokenType);
      }
    }

    if (plugin.operators) {
      this.hasPluginOps = true;
      for (const [chars, tokenType] of Object.entries(plugin.operators)) {
        // Only support 2-char operators for the fast path
        if (chars.length === 2) {
          const first = chars.charCodeAt(0);
          const second = chars.charCodeAt(1);

          // Guard: prevent overriding built-in two-char operators (==, !=, >=, <=)
          const builtInSecondMap = TWO_CHAR_OPS[first];
          if (builtInSecondMap && builtInSecondMap[second] !== undefined) {
            throw ErrorFactory.config(
              'PLUGIN_OPERATOR_COLLISION',
              `Plugin operator "${chars}" conflicts with built-in operator ` +
              `(type: ${builtInSecondMap[second]}). Built-in operators cannot be overridden.`,
              { operator: chars, builtinType: builtInSecondMap[second] }
            );
          }
          // Guard: prevent overriding LSHIFT (<<) and RSHIFT (>>)
          if (first === 60 && second === 60) {
            throw ErrorFactory.config(
              'PLUGIN_OPERATOR_COLLISION',
              `Plugin operator "${chars}" conflicts with built-in operator ` +
              `(type: LSHIFT). Built-in operators cannot be overridden.`,
              { operator: chars, builtinType: 'LSHIFT' }
            );
          }
          if (first === 62 && second === 62) {
            throw ErrorFactory.config(
              'PLUGIN_OPERATOR_COLLISION',
              `Plugin operator "${chars}" conflicts with built-in operator ` +
              `(type: RSHIFT). Built-in operators cannot be overridden.`,
              { operator: chars, builtinType: 'RSHIFT' }
            );
          }
          // Guard: prevent overriding comment sequences (//)
          if (first === 47 && second === 47) {
            throw ErrorFactory.config(
              'PLUGIN_OPERATOR_COLLISION',
              `Plugin operator "${chars}" conflicts with built-in comment sequence. ` +
              `Comment sequences cannot be overridden.`,
              { operator: chars, builtinType: 'COMMENT' }
            );
          }

          let inner = this.pluginOperators.get(first);
          if (!inner) {
            inner = new Map();
            this.pluginOperators.set(first, inner);
          }
          inner.set(second, tokenType);
        }
      }
    }

    if (plugin.units) {
      for (const unit of plugin.units) {
        // Guard: prevent overriding built-in units
        if (knownUnits.has(unit)) {
          throw ErrorFactory.config(
            'PLUGIN_UNIT_COLLISION',
            `Plugin unit "${unit}" conflicts with a built-in unit. ` +
            `Built-in units cannot be overridden.`,
            { unit }
          );
        }
        this.pluginUnits.add(unit);
      }
      this.rebuildMergedUnits();
    }

    if (plugin.rawLinePatterns) {
      this.pluginRawLinePatterns.push(...plugin.rawLinePatterns);
    }
  }

  /**
   * Unregister a plugin, removing its custom tokens from the lexer.
   *
   * This is the inverse of registerVocabulary(). All keywords, operators,
   * and units registered by the plugin are removed. After
   * unregistration, those tokens will revert to their default behavior
   * (e.g., keywords become IDENT, operators become ERROR).
   *
   * Calling unregisterVocabulary with a plugin that was never registered
   * is safe, it simply has no effect.
   */
  unregisterVocabulary(plugin: LexerVocabulary): void {
    if (plugin.keywords) {
      for (const keyword of Object.keys(plugin.keywords)) {
        const lower = keyword.toLowerCase();
        this.pluginKeywordMap.delete(lower);
        this.mergedKeywords.delete(lower);
      }
    }

    if (plugin.operators) {
      for (const chars of Object.keys(plugin.operators)) {
        if (chars.length === 2) {
          const first = chars.charCodeAt(0);
          const second = chars.charCodeAt(1);
          const inner = this.pluginOperators.get(first);
          if (inner) {
            inner.delete(second);
            if (inner.size === 0) {
              this.pluginOperators.delete(first);
            }
          }
        }
      }
      this.hasPluginOps = this.pluginOperators.size > 0;
    }

    if (plugin.units) {
      for (const unit of plugin.units) {
        this.pluginUnits.delete(unit);
      }

      this.rebuildMergedUnits();
    }

    if (plugin.rawLinePatterns) {
      const toRemove = new Set(plugin.rawLinePatterns);
      this.pluginRawLinePatterns = this.pluginRawLinePatterns.filter((r) => !toRemove.has(r));
    }
  }

  reset(input: string): void {
    this.input = input;
    this.pos = 0;
    this.len = input.length;
    this.line = 1;
    this.lineStartPos = 0;
    this.pendingRawLineToken = this.pluginRawLinePatterns.length > 0 ? this.matchRawLine(input) : null;
  }

  /**
   * Scan a full document text in a single pass, classifying each line and
   * tokenizing non-skipped lines.
   *
   * Replaces the separate classifyLine() + findInlineSolves() + per-line
   * reset() + tokenizeAll() pattern with a single character-by-character
   * walk through the entire document. Key benefits:
   *
   * - **Single reset()**: `this.pos`, `this.len`, `this.line`, and
   *   `this.lineStartPos` are set once for the whole document, not per-line.
   * - **Single classification**: classifyLine() runs once per line inline;
   *   skipped lines are jumped over without tokenization.
   * - **Shared tokenization**: Non-skipped lines are tokenized using the
   *   existing state machine, yielding Token[] without per-line reset().
   * - **Inline solve detection**: findInlineSolves() is called only for
   *   lines that classifyLine() marks as having inline solves.
   *
   * Tokenization is scoped to each line by temporarily restricting
   * `this.len` to the line end position, so the [Symbol.iterator]
   * generator naturally stops at the line boundary. After tokenization,
   * `this.len` is restored and `this.pos` advances past the newline.
   *
   * @param text The full document text (with newlines).
   * @returns Array of ScanLineResult, one per line, in document order.
   */
  scanDocument(text: string): ScanLineResult[] {
    this.input = text;
    this.pos = 0;
    this.len = text.length;
    this.line = 1;
    this.lineStartPos = 0;

    const results: ScanLineResult[] = [];
    const input = this.input;
    const docLen = this.len;

    while (this.pos < docLen) {
      const lineStart = this.pos;

      // ── Find end of current line (newline boundary) ───────────────
      let lineEnd = this.pos;
      while (lineEnd < docLen) {
        const cc = input.charCodeAt(lineEnd);
        if (cc === 10 || cc === 13) break;  // \n or \r
        lineEnd++;
      }

      const lineNumber = this.line;

      // ── Classify the line ─────────────────────────────────────────
      // Uses classifyFromPositions() to read from this.input directly
      // avoids allocating a substring and keeps classification reads
      // within the same memory region as tokenization.
      const classification = this.classifyFromPositions(lineStart, lineEnd);

      // ── Slice line text for ScanLineResult.text ────────────────
      // Hoisted above tokenization (rather than after, as originally) so the
      // raw-line-pattern check below can test the exact substring a plugin
      // registered via `LexerVocabulary.rawLinePatterns`. See reset()/
      // tokenizeAll() for the single-expression-string equivalent of this
      // same check.
      const lineText = input.slice(lineStart, lineEnd);

      // ── Tokenize non-skipped lines ────────────────────────────────
      let tokens: Token[] = [];
      let error: EngineError | undefined;
      if (!classification.skip) {
        const rawToken = this.pluginRawLinePatterns.length > 0 ? this.matchRawLine(lineText) : null;
        if (rawToken) {
          tokens = [rawToken];
        } else {
          // Scope tokenization to just this line by temporarily restricting len.
          // The [Symbol.iterator]() generator captures `this.len` at call time,
          // so creating the iterator AFTER setting this.len = lineEnd ensures
          // tokenization stops at the line boundary. After tokenization,
          // this.pos will be at lineEnd (the newline position).
          const savedLen = this.len;
          this.len = lineEnd;
          // Start past any structural marker, so the marker never becomes a
          // token. Token source offsets stay absolute, so everything
          // downstream (spans, highlighting, inline solves) still lines up
          // with the raw document.
          if (classification.contentOffset !== undefined) this.pos = classification.contentOffset;
          try {
            tokens = Array.from(this);
          } catch (thrown) {
            // A tokeniser error belongs to this line, the way a parse error
            // already does. Letting it escape aborted the whole scan, so one
            // half-typed quote blanked every other line's result. The line
            // keeps its text and its error; the scan carries on from the
            // next line, with the position restored to where this one ends.
            if (!(thrown instanceof EngineError)) throw thrown;
            error = thrown;
            tokens = [];
            this._inlineSolveSpans = [];
            this.line = lineNumber;
          } finally {
            this.len = savedLen;
          }
          // this.pos is set to lineEnd below, which also covers the error path.
        }
      }

      // ── Detect inline solves ──────────────────────────────────────
      // Two data sources are merged:
      //   1. _inlineSolveSpans, token indices collected inline during
      //      [Symbol.iterator](). Provides correct startTokenIndex /
      //      endTokenIndex. Also handles \` escape (skips the pair
      //      instead of closing the span early).
      //   2. findInlineSolves(), character-level string scan for
      //      expression text. Still needed because token-based
      //      reconstruction loses whitespace (the lexer skips spaces),
      //      which breaks multi-word expressions like
      //      "2 weeks in days" → "2weeksindays" (wrong tokenization).
      let inlineSolves: InlineSolveSpan[] = [];
      if (classification.hasInlineSolve) {
        if (!classification.skip && tokens.length > 0) {
          const charSpans = this.findInlineSolves(lineText);
          inlineSolves = this._inlineSolveSpans.map((span, i) => ({
            start: charSpans[i]?.start ?? 0,
            end: charSpans[i]?.end ?? 0,
            expression: charSpans[i]?.expression ?? '',
            columnNumber: charSpans[i]?.columnNumber ?? span.columnNumber,
            startTokenIndex: span.startTokenIndex,
            endTokenIndex: span.endTokenIndex,
          }));
        } else {
          // Skipped lines weren't tokenized, fall back to string scan
          inlineSolves = this.findInlineSolves(lineText);
        }
      }

      const scanned: ScanLineResult = {
        text: lineText,
        lineNumber,
        startOffset: lineStart,
        endOffset: lineEnd,
        classification,
        tokens,
        inlineSolves,
      };
      if (error) scanned.error = error;
      results.push(scanned);

      // ── Advance past newline ─────────────────────────────────────
      this.pos = lineEnd;
      if (this.pos < docLen) {
        const nlChar = input.charCodeAt(this.pos);
        if (nlChar === 13) {  // \r
          this.pos++;
          if (this.pos < docLen && input.charCodeAt(this.pos) === 10) {
            this.pos++;  // skip \n in \r\n
          }
        } else if (nlChar === 10) {  // \n
          this.pos++;
        }
      }
      this.line++;
      this.lineStartPos = this.pos;
    }

    return results;
  }

  /**
   * Tokenize an expression string into an array of Tokens.
   *
   * Delegates to the lazy [Symbol.iterator]() generator and collects all
   * yielded tokens via Array.from(). For memory-sensitive use cases, prefer
   * iterating the lexer directly with for...of to avoid array allocation.
   *
   * Optimizations:
   *  - CHAR_CLASS jump table (Uint8Array) → switch on small integers
   *  - Direct character-code dispatch (c0 cached pattern)
   *  - Mathematical digit parsing (integer math, not slice+parseFloat)
   *  - Inline operator tokenizer with two-char peek-ahead
   *  - Whitespace eliminated in-lexer (never emitted)
   *  - 0-char and 1-char fast paths
   */
  tokenizeAll(): Token[] {
    if (this.pendingRawLineToken) {
      this._inlineSolveSpans = [];
      return [this.pendingRawLineToken];
    }
    return Array.from(this);
  }

  // ── Lazy iterator ─────────────────────────────────────────────────────
  /**
   * Lazy token-by-token generator. Yields each token without allocating an
   * intermediate Token[] array. Supports for...of and spread usage.
   *
   * Usage:
   *   for (const t of lexer) { ... }  // lazy, no array allocation
   *   const tokens = [...lexer];       // materializes via spread
   *   const tokens = lexer.tokenizeAll(); // materializes via Array.from()
   *
   * IMPORTANT: This generator captures `this.len` ONCE at creation time
   * (const len = this.len). `scanDocument()` relies on this behavior to
   * scope tokenization to a single line by temporarily restricting
   * `this.len` to the line end position before creating the iterator.
   * Do NOT refactor to re-read `this.len` mid-loop without also updating
   * `scanDocument()`.
   */
  *[Symbol.iterator](): Generator<Token, void, undefined> {
    const len = this.len;

    // ── 0-char fast path ────────────────────────────────────────────────
    if (len === 0) { this._inlineSolveSpans = []; return; }

    // Inline solve tracking state, collected inline during tokenization
    let tokenIndex = 0;
    let openSpan: { startTokenIndex: number; startColumn: number } | null = null;
    const collectedSpans: InlineSolveSpan[] = [];

    // ── 1-char fast path ────────────────────────────────────────────────
    if (len === 1) {
      const c0 = this.input.charCodeAt(0);
      const cc = ExpressionLexer.CHAR_CLASS[c0] ?? CharClass.SKIP;

      switch (cc) {
        case CharClass.DIGIT:
          yield new LexerToken('NUMBER', TT_NUMBER, this.input, this.input, 0, 0, 1, 1);
          tokenIndex++;
          break;

        case CharClass.DOT:
          // A lone '.' is a DOT, as the main loop makes it. This case used to
          // share the NUMBER arm above, so a stray dot on a line of its own
          // evaluated to 0 while ". " or "a." reported an error.
          yield new LexerToken('DOT', TT_DOT, '.', '.', 0, 0, 1, 1);
          tokenIndex++;
          break;

        case CharClass.ALPHA: {
          const input = this.input;
          const identLower = input.toLowerCase();
          // Use pre-merged collections (built-in + plugin), single lookup each
          if (this.mergedUnits.has(input)) {
            yield new LexerToken('UNIT', TT_UNIT, input, input, 0, 0, 1, 1);
          } else {
            const kwType = this.mergedKeywords.get(identLower);
            if (kwType) {
              yield new LexerToken(kwType, tokenTypeId(kwType), input, input, 0, 0, 1, 1);
            } else {
              yield new LexerToken('IDENT', TT_IDENT, input, input, 0, 0, 1, 1);
            }
          }
          tokenIndex++;
          break;
        }

        case CharClass.OPERATOR: {
          const opType = OP_MAP[c0];
          if (opType) {
            yield new LexerToken(opType, tokenTypeId(opType), this.input, this.input, 0, 0, 1, 1);
            tokenIndex++;
          }
          break;
        }

        case CharClass.QUOTE:
          // Delegate to tokenizeString for correctness (handles unterminated)
          this.pos = 0;
          yield this.tokenizeString();
          tokenIndex++;
          break;

        case CharClass.HASH:
          // Delegate to tokenizeComment for correctness
          this.pos = 0;
          yield this.tokenizeComment();
          tokenIndex++;
          break;

        case CharClass.DOLLAR:
          yield new LexerToken('DOLLAR', TT_DOLLAR, '$', '$', 0, 0, 1, 1);
          tokenIndex++;
          break;

        case CharClass.BACKTICK:
          // s` is 2 chars, openSpan can never be set in the 1-char fast path
          yield new LexerToken('BACKTICK_OPEN', TT_BACKTICK_OPEN, '`', '`', 0, 0, 1, 1);
          tokenIndex++;
          break;

        default: {
          // CharClass.SKIP, includes non-ASCII characters (code >= 128)
          if (isUnicodeSpace(c0)) {
            // A line holding nothing but a no-break space or a byte-order mark
            // holds no expression, exactly as a line holding one space does.
            // Yielding an IDENT for it made it an undefined variable instead.
          } else if (c0 === 0x00D7) {  // × → STAR
            yield new LexerToken('STAR', TT_STAR, '\u00D7', '\u00D7', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x00F7) {  // ÷ → SLASH
            yield new LexerToken('SLASH', TT_SLASH, '\u00F7', '\u00F7', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x00B1) {  // U+00B1 plus-minus sign, the uncertainty operator
            yield new LexerToken('PLUS_MINUS', TT_PLUS_MINUS, '\u00B1', '\u00B1', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x2260) {  // ≠ → NEQ
            yield new LexerToken('NEQ', TT_NEQ, '\u2260', '\u2260', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x00A3) {  // £
            yield new LexerToken('POUND', TT_POUND, '\u00A3', '\u00A3', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x20AC) {  // €
            yield new LexerToken('EURO', TT_EURO, '\u20AC', '\u20AC', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x00A5) {  // ¥
            yield new LexerToken('YEN', TT_YEN, '¥', '¥', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x20BD) {  // ₽
            yield new LexerToken('RUBLE', TT_RUBLE, '₽', '₽', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x20A9) {  // ₩
            yield new LexerToken('WON', TT_WON, '₩', '₩', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x20B9) {  // ₹ (Indian rupee) — see uom/CurrencyAliases.ts
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₹', '₹', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x20BA) {  // ₺ (Turkish lira)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₺', '₺', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x20B4) {  // ₴ (Ukrainian hryvnia)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₴', '₴', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x20AA) {  // ₪ (Israeli new shekel)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₪', '₪', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x20AB) {  // ₫ (Vietnamese dong)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₫', '₫', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x20A6) {  // ₦ (Nigerian naira)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₦', '₦', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 === 0x20B1) {  // ₱ (Philippine peso)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₱', '₱', 0, 0, 1, 1);
            tokenIndex++;
          } else if (c0 >= 128) {
            // Unknown unicode, treat as IDENT for forward compatibility
            yield new LexerToken('IDENT', TT_IDENT, this.input, this.input, 0, 0, 1, 1);
            tokenIndex++;
          }
          break;
        }
      }
      this._inlineSolveSpans = collectedSpans;
      return;
    }

    const input = this.input;
    // Fresh nesting stack for this pass (see the field's doc).
    this.groupingStack.length = 0;

    // ── Main tokenization loop ──────────────────────────────────────────
    while (this.pos < len) {
      const c0 = input.charCodeAt(this.pos);
      const cc = ExpressionLexer.CHAR_CLASS[c0] ?? CharClass.SKIP;

      // ── Escaped backtick inside inline solve ────────────────────────
      // \` is treated as an escaped backtick, skip both characters
      // without closing the inline solve span. Without this, the
      // backtick would close the span early, producing wrong expression
      // text for expressions like s`hello \` world`.
      if (openSpan && c0 === 92 && this.pos + 1 < len && input.charCodeAt(this.pos + 1) === 96) {
        this.pos += 2;  // skip \ and `
        continue;
      }

      switch (cc) {
        // ── Whitespace, skip entirely, track newlines ────────────────
        case CharClass.WHITESPACE:
          this.pos++;
          if (c0 === 10) {  // \n
            this.line++;
            this.lineStartPos = this.pos;
            this.groupingStack.length = 0;  // each line groups thousands on its own
          } else if (c0 === 13) {  // \r
            this.line++;
            if (this.pos < len && input.charCodeAt(this.pos) === 10) {
              this.pos++;  // skip \n in \r\n
            }
            this.lineStartPos = this.pos;
            this.groupingStack.length = 0;
          }
          break;

        // ── Digit, inline number tokenizer ───────────────────────────
        case CharClass.DIGIT:
          yield this.tokenizeNumber();
          tokenIndex++;
          break;

        // ── Alpha / underscore, identifier or keyword ────────────────
        case CharClass.ALPHA: {
          const token = this.tokenizeIdentifier();
          if (token.type === 'INLINE_SOLVE_START') {
            openSpan = { startTokenIndex: tokenIndex, startColumn: token.col };
          }
          yield token;
          tokenIndex++;
          break;
        }

        // ── Dot, could be decimal (.5) or DOT token ─────────────────
        case CharClass.DOT:
          if (this.pos + 1 < len) {
            const nextCc = ExpressionLexer.CHAR_CLASS[input.charCodeAt(this.pos + 1)] ?? CharClass.SKIP;
            if (nextCc === CharClass.DIGIT) {
              yield this.tokenizeNumber();
            } else {
              const col = this.pos - this.lineStartPos + 1;
              yield new LexerToken('DOT', TT_DOT, '.', '.', this.pos, 0, this.line, col);
              this.pos++;
            }
          } else {
            const col = this.pos - this.lineStartPos + 1;
            yield new LexerToken('DOT', TT_DOT, '.', '.', this.pos, 0, this.line, col);
            this.pos++;
          }
          tokenIndex++;
          break;

        // ── Operator / punctuation ────────────────────────────────────
        case CharClass.OPERATOR:
          yield this.tokenizeOperator();
          tokenIndex++;
          break;

        // ── String literal ────────────────────────────────────────────
        case CharClass.QUOTE:
          yield this.tokenizeString();
          tokenIndex++;
          break;

        // ── Comment (# or //) ─────────────────────────────────────────
        case CharClass.HASH:
          yield this.tokenizeComment();
          tokenIndex++;
          break;

        // ── Dollar sign $ ─────────────────────────────────────────────
        case CharClass.DOLLAR: {
          const col = this.pos - this.lineStartPos + 1;
          yield new LexerToken('DOLLAR', TT_DOLLAR, '$', '$', this.pos, 0, this.line, col);
          this.pos++;
          tokenIndex++;
          break;
        }

        // ── Backtick ` ───────────────────────────────────────────────
        case CharClass.BACKTICK: {
          const col = this.pos - this.lineStartPos + 1;
          yield new LexerToken('BACKTICK_OPEN', TT_BACKTICK_OPEN, '`', '`', this.pos, 0, this.line, col);
          this.pos++;
          if (openSpan) {
            const span = openSpan;  // narrow for TS
            collectedSpans.push({
              start: 0, end: 0, expression: '',
              columnNumber: span.startColumn,
              startTokenIndex: span.startTokenIndex,
              endTokenIndex: tokenIndex,
            });
            openSpan = null;
          }
          tokenIndex++;
          break;
        }

        // ── Non-ASCII characters ─────────────────────────────────────
        default: {
          const col = this.pos - this.lineStartPos + 1;
          if (isUnicodeSpace(c0)) {
            // Separates its neighbours instead of joining them. See
            // isUnicodeSpace()'s doc comment: this branch is why a sum pasted
            // out of a web page or a spreadsheet evaluates at all.
            this.pos++;
            if (c0 === 0x2028 || c0 === 0x2029 || c0 === 0x0085) {
              // The three that are line breaks rather than spaces, tracked the
              // same way "\n" is above so a later token reports its own line.
              this.line++;
              this.lineStartPos = this.pos;
            }
          } else if (c0 === 0x00D7) {  // × → STAR
            yield new LexerToken('STAR', TT_STAR, '\u00D7', '\u00D7', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x00F7) {  // ÷ → SLASH
            yield new LexerToken('SLASH', TT_SLASH, '\u00F7', '\u00F7', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x00B1) {  // U+00B1 plus-minus sign, the uncertainty operator
            yield new LexerToken('PLUS_MINUS', TT_PLUS_MINUS, '\u00B1', '\u00B1', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x2260) {  // ≠ → NEQ
            yield new LexerToken('NEQ', TT_NEQ, '\u2260', '\u2260', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x00A3) {  // £
            yield new LexerToken('POUND', TT_POUND, '\u00A3', '\u00A3', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x20AC) {  // €
            yield new LexerToken('EURO', TT_EURO, '\u20AC', '\u20AC', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x00A5) {  // ¥
            yield new LexerToken('YEN', TT_YEN, '¥', '¥', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x20BD) {  // ₽
            yield new LexerToken('RUBLE', TT_RUBLE, '₽', '₽', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x20A9) {  // ₩
            yield new LexerToken('WON', TT_WON, '₩', '₩', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x20B9) {  // ₹ (Indian rupee) — see uom/CurrencyAliases.ts
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₹', '₹', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x20BA) {  // ₺ (Turkish lira)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₺', '₺', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x20B4) {  // ₴ (Ukrainian hryvnia)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₴', '₴', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x20AA) {  // ₪ (Israeli new shekel)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₪', '₪', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x20AB) {  // ₫ (Vietnamese dong)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₫', '₫', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x20A6) {  // ₦ (Nigerian naira)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₦', '₦', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 === 0x20B1) {  // ₱ (Philippine peso)
            yield new LexerToken('CURRENCY_SYMBOL', TT_CURRENCY_SYMBOL, '₱', '₱', this.pos, 0, this.line, col);
            this.pos++;
            tokenIndex++;
          } else if (c0 >= 128) {
            // Unknown unicode, treat as IDENT for forward compatibility.
            // tokenizeIdentifier() now includes cc >= 128 in its reading loop,
            // so this properly advances past all consecutive Unicode chars.
            yield this.tokenizeIdentifier();
            tokenIndex++;
          } else {
            // Unknown ASCII, silently skip
            this.pos++;
          }
          break;
        }
      }
    }
    this._inlineSolveSpans = collectedSpans;
  }

  // ── Inline number tokenizer ────────────────────────────────────────────
  /**
   * Character-by-character number parsing.
   *
   * Supports: integers, floats, scientific notation (1.5e10, 1.5e-10),
   * hex (0xFF), binary (0b1010), octal (0o17), BigInt suffix (123n),
   * thousands separators (1,234 or 1.234.567).
   *
   * Returns a LexerToken and advances `this.pos` past the number.
   */
  private tokenizeNumber(): Token {
    const input = this.input;
    const len = this.len;
    let pos = this.pos;
    const start = pos;
    const startCol = pos - this.lineStartPos + 1;
    let cc: number;

    // ── Hex literal: 0x / 0X ───────────────────────────────────────────
    if (input.charCodeAt(pos) === 48 && pos + 1 < len) {
      const next = input.charCodeAt(pos + 1);
      if (next === 0x78 || next === 0x58) {  // 'x' or 'X'
        pos += 2;
        while (
          pos < len &&
          ((cc = input.charCodeAt(pos)),
            (cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 70) || (cc >= 97 && cc <= 102))
        ) {
          pos++;
        }
        const text = input.slice(start, pos);
        this.pos = pos;
        return new LexerToken('NUMBER', TT_NUMBER, text, text, start, 0, this.line, startCol);
      }
      // ── Binary literal: 0b / 0B ─────────────────────────────────────
      if (next === 0x62 || next === 0x42) {  // 'b' or 'B'
        pos += 2;
        while (pos < len && ((cc = input.charCodeAt(pos)), cc === 48 || cc === 49)) {
          pos++;
        }
        const text = input.slice(start, pos);
        this.pos = pos;
        return new LexerToken('NUMBER', TT_NUMBER, text, text, start, 0, this.line, startCol);
      }
      // ── Octal literal: 0o / 0O ───────────────────────────────────────
      if (next === 0x6F || next === 0x4F) {  // 'o' or 'O'
        pos += 2;
        while (pos < len && ((cc = input.charCodeAt(pos)), cc >= 48 && cc <= 55)) {
          pos++;
        }
        const text = input.slice(start, pos);
        this.pos = pos;
        return new LexerToken('NUMBER', TT_NUMBER, text, text, start, 0, this.line, startCol);
      }
    }

    let hasIntPart = false;

    // ── Integer part ───────────────────────────────────────────────────
    while (pos < len && ((cc = input.charCodeAt(pos)), cc >= 48 && cc <= 57)) {
      hasIntPart = true;
      pos++;
    }

    // ── Thousands separators, coalesce with digits ────────────────────
    while (hasIntPart && pos < len && (input.charCodeAt(pos) === 44 || input.charCodeAt(pos) === 46)) {
      // A comma inside a call or bracket is an argument/element separator, not a
      // thousands group: `rgb(255,255,255)` is three numbers and `[100,200,300]`
      // a three-element vector, not `255255255`/`100200300`. A comma in a bare
      // grouping paren (`(1,000)`) still groups thousands, and so does a
      // top-level comma (`1,000,000`). The innermost bracket's context decides;
      // the `.` grouping form is context-free and unaffected. See
      // {@link groupingStack}.
      if (
        input.charCodeAt(pos) === 44 &&
        this.groupingStack.length > 0 &&
        this.groupingStack[this.groupingStack.length - 1]
      ) {
        break;
      }
      if (pos + 4 <= len) {
        const d1 = input.charCodeAt(pos + 1);
        const d2 = input.charCodeAt(pos + 2);
        const d3 = input.charCodeAt(pos + 3);
        // A genuine thousands group is always exactly 3 digits, followed
        // by either another separator, or a non-digit (end of number,
        // operator, unit, EOF), never a 4th consecutive digit. Without
        // this check, a plain decimal fraction with 4+ digits after the
        // point, e.g. "0.0001", had its first 3 fractional digits
        // misread as a "." thousands-group, silently truncating the
        // number to "0.000" and leaving the remaining digit(s) as a
        // separate, unrelated NUMBER token right after it (so
        // "0.0001 BTC to USD" tokenized as "0.000", "1", "BTC", "to",
        // "USD", two number literals instead of one, and evaluated to
        // a bare 0 instead of a real BTC quantity).
        const d4 = pos + 4 < len ? input.charCodeAt(pos + 4) : -1;
        const isGroupOfExactlyThree = !(d4 >= 48 && d4 <= 57);
        if (
          d1 >= 48 && d1 <= 57 &&
          d2 >= 48 && d2 <= 57 &&
          d3 >= 48 && d3 <= 57 &&
          isGroupOfExactlyThree
        ) {
          pos += 4;
          hasIntPart = true;
          continue;
        }
      }
      break;
    }

    // ── Decimal part (.xxx) ───────────────────────────────────────────
    let hasDecimal = false;
    if (pos < len && input.charCodeAt(pos) === 46) {
      if (pos + 1 < len) {
        const nextCc = input.charCodeAt(pos + 1);
        if (nextCc >= 48 && nextCc <= 57) {
          hasDecimal = true;
          pos++;
          while (pos < len && ((cc = input.charCodeAt(pos)), cc >= 48 && cc <= 57)) {
            pos++;
          }
        }
      }
    }

    // ── Exponent (e / E [+-]? \n+) ────────────────────────────────────
    let hasExponent = false;
    if (pos < len) {
      const ec = input.charCodeAt(pos);
      if (ec === 0x65 || ec === 0x45) {  // 'e' or 'E'
        if (pos + 1 < len) {
          const next = input.charCodeAt(pos + 1);
          if (
            (next >= 48 && next <= 57) ||
            next === 43 || next === 45  // + or -
          ) {
            hasExponent = true;
            pos++;
            if (next === 43 || next === 45) pos++;
            while (pos < len && ((cc = input.charCodeAt(pos)), cc >= 48 && cc <= 57)) {
              pos++;
            }
          }
        }
      }
    }

    // ── BigInt suffix check ────────────────────────────────────────────
    if (pos < len && input.charCodeAt(pos) === 110) {  // 'n'
      if (hasIntPart && !hasDecimal && !hasExponent) {
        pos++;
        const text = input.slice(start, pos);
        this.pos = pos;
        return new LexerToken('BIGINT', TT_BIGINT, text, text, start, 0, this.line, startCol);
      }
    }

    // ── Emit NUMBER token ──────────────────────────────────────────────
    const text = input.slice(start, pos);
    this.pos = pos;
    return new LexerToken('NUMBER', TT_NUMBER, text, text, start, 0, this.line, startCol);
  }

  // ── Inline identifier / keyword tokenizer ──────────────────────────────
  /**
   * Reads [a-zA-Z_][a-zA-Z0-9_]* and resolves to:
   *   - A unit type (via knownUnits, case-sensitive)
   *   - A keyword type (via locale keywordMap, case-insensitive)
   *   - IDENT if none of the above
   *
   * Multi-word phrases (e.g., "to the power of") are handled by the
   * TokenNormalizer post-lexer pass, not the lexer.
   */
  private tokenizeIdentifier(): Token {
    const input = this.input;
    const len = this.len;
    let pos = this.pos;
    const start = pos;
    const startCol = pos - this.lineStartPos + 1;
    let cc: number;

    // Read [a-zA-Z0-9_]* plus any Unicode (>= 128) including emoji surrogate pairs.
    // Without this, non-ASCII characters cause an infinite loop: the default case
    // calls tokenizeIdentifier(), the while loop doesn't match the Unicode char,
    // pos never advances, and the outer loop re-reads the same char forever.
    while (
      pos < len &&
      ((cc = input.charCodeAt(pos)),
        (cc >= 48 && cc <= 57) ||   // 0-9
        (cc >= 65 && cc <= 90) ||   // A-Z
        (cc >= 97 && cc <= 122) ||  // a-z
        cc === 95 ||                 // _
        (cc >= 128 && !isUnicodeSpace(cc)))  // Unicode (accented chars, emoji, etc.), but not Unicode whitespace
    ) {
      pos++;
    }

    const identText = input.slice(start, pos);
    const identLower = identText.toLowerCase();

    // ── Inline solve marker: s` (lowercase 's' followed by backtick) ──
    if (identLower === 's' && pos < len && input.charCodeAt(pos) === 96) {
      pos++;
      this.pos = pos;
      const fullText = input.slice(start, pos);
      return new LexerToken('INLINE_SOLVE_START', TT_INLINE_SOLVE_START, fullText, fullText, start, 0, this.line, startCol);
    }

    // ── Unit lookup (case-sensitive)
    const isKnownUnit = this.mergedUnits.has(identText);
    if (isKnownUnit) {
      if (!this.isFollowedByLParen(pos)) {
        this.pos = pos;
        return new LexerToken('UNIT', TT_UNIT, identText, identText, start, 0, this.line, startCol);
      }
    }

    // ── Keyword lookup (case-insensitive)
    const localeKwType = this.mergedKeywords.get(identLower);
    if (localeKwType) {
      this.pos = pos;
      return new LexerToken(localeKwType, tokenTypeId(localeKwType), identText, identText, start, 0, this.line, startCol);
    }

    // ── Fall through: emit IDENT
    // Multi-word phrases are now handled by the TokenNormalizer post-lexer pass,
    // which keeps the lexer slim and focused on single-token production.
    this.pos = pos;
    return new LexerToken('IDENT', TT_IDENT, identText, identText, start, 0, this.line, startCol);
  }

  /**
   * Peek past in-expression whitespace (space, tab) from `pos` to check
   * if the next significant character is '('.
   */
  private isFollowedByLParen(pos: number): boolean {
    const len = this.len;
    let lookPos = pos;
    while (lookPos < len) {
      const cc = this.input.charCodeAt(lookPos);
      if (cc === 40) return true;
      if (cc !== 32 && cc !== 9) break;
      lookPos++;
    }
    return false;
  }

  // ── Inline operator tokenizer ─────────────────────────────────────────
  /**
   * Whether the `(` at `parenPos` opens a function call rather than a bare
   * grouping, deciding whether a comma inside it is a separator or a thousands
   * group (see {@link groupingStack}).
   *
   * It is a call when the nearest non-whitespace character before it belongs to
   * the value the call applies to: a closing `)`/`]` (a call on a result), or an
   * IDENTIFIER (`rgb(`, `vec2(`). A run of digits alone is a number, not an
   * identifier, so `2(1,000)` is implicit multiplication over the grouping
   * `(1,000)`, not a call, while `vec2(` and `atan2(` (identifiers that end in a
   * digit) are calls. A `(` after an operator, a comma, or the line start is a
   * grouping.
   */
  private precededByCallTarget(parenPos: number): boolean {
    const input = this.input;
    const start = this.lineStartPos;
    let i = parenPos - 1;
    while (i >= start && (input.charCodeAt(i) === 32 || input.charCodeAt(i) === 9)) i--;  // skip spaces/tabs
    if (i < start) return false;  // line start (or only whitespace before): a grouping
    const c = input.charCodeAt(i);
    const isWord = (ch: number): boolean =>
      (ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95;
    const isAlpha = (ch: number): boolean =>
      (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95;
    // A non-word char before "(" (an operator, a comma, a `)`/`]`, or the line
    // start) is a grouping. There is no curried/first-class call or index-
    // application in this grammar, so `)(` and `](` are implicit multiplication
    // over a grouping (`(2)(1,000)` is `2 * 1000`), not a call. The only call
    // targets are an identifier or a FUNC keyword, handled below.
    if (!isWord(c)) return false;
    // Walk back over the whole word run. A bare number run (`2(1,000)`) is
    // implicit multiplication over a grouping, not a call.
    const wordEnd = i + 1;
    let hasAlpha = false;
    while (i >= start) {
      const ch = input.charCodeAt(i);
      if (!isWord(ch)) break;
      if (isAlpha(ch)) hasAlpha = true;
      i--;
    }
    if (!hasAlpha) return false;
    // The word is an identifier. A KEYWORD that is not a function name is a
    // word-operator or connective (`mod`, `xor`, `and`, `to`, `in`) or a
    // constant (`pi`, `e`), and the `(...)` after it is a grouped operand, so
    // its comma still groups thousands (`100 mod (1,000)` is `100 mod 1000`).
    // A plain identifier (a function like `rgb`, or a variable) or a function
    // keyword (`sqrt`, `max`) is a real call target, where the comma separates.
    const word = input.slice(i + 1, wordEnd).toLowerCase();
    const keywordType = this.mergedKeywords.get(word);
    return keywordType === undefined || keywordType === "FUNC";
  }

  /**
   * Reads an operator/punctuation token.
   * Handles two-char operators (==, !=, >=, <=, **) and the special
   * cases << (LSHIFT) and >> (RSHIFT).
   */
  private tokenizeOperator(): Token {
    const input = this.input;
    const pos = this.pos;
    const col = pos - this.lineStartPos + 1;
    const c0 = input.charCodeAt(pos);
    const len = this.len;

    // ── Two-character operators ────────────────────────────────────────
    if (pos + 1 < len) {
      const c1 = input.charCodeAt(pos + 1);

      // ==, !=, >=, <=
      const secondMap = TWO_CHAR_OPS[c0];
      if (secondMap) {
        const twoCharType = secondMap[c1];
        if (twoCharType) {
          const text = input.slice(pos, pos + 2);
          this.pos = pos + 2;
          return new LexerToken(twoCharType, tokenTypeId(twoCharType), text, text, pos, 0, this.line, col);
        }
      }

      // // comment
      if (c0 === 47 && c1 === 47) {
        let commentPos = pos + 2;
        while (commentPos < len) {
          const cc = input.charCodeAt(commentPos);
          if (cc === 10 || cc === 13) break;
          commentPos++;
        }
        const text = input.slice(pos, commentPos);
        this.pos = commentPos;
        return new LexerToken('COMMENT', TT_COMMENT, text, text, pos, 0, this.line, col);
      }

      // << (LSHIFT), >> (RSHIFT) and >>> (URSHIFT).
      //
      // >>> is tested before >>, or the two-char match would consume the first
      // two angle brackets and leave a stray > for the parser to choke on.
      if (c0 === 60 && c1 === 60) {
        this.pos = pos + 2;
        return new LexerToken('LSHIFT', TT_LSHIFT, '<<', '<<', pos, 0, this.line, col);
      }
      if (c0 === 62 && c1 === 62) {
        if (input.charCodeAt(pos + 2) === 62) {
          this.pos = pos + 3;
          return new LexerToken('URSHIFT', TT_URSHIFT, '>>>', '>>>', pos, 0, this.line, col);
        }
        this.pos = pos + 2;
        return new LexerToken('RSHIFT', TT_RSHIFT, '>>', '>>', pos, 0, this.line, col);
      }

      // ── Plugin-registered two-char operators ──────────────────────
      if (this.hasPluginOps) {
        const pluginInner = this.pluginOperators.get(c0);
        if (pluginInner) {
          const pluginType = pluginInner.get(c1);
          if (pluginType) {
            const text = input.slice(pos, pos + 2);
            this.pos = pos + 2;
            return new LexerToken(pluginType, tokenTypeId(pluginType), text, text, pos, 0, this.line, col);
          }
        }
      }
    }

    // ── Single-character operator ──────────────────────────────────────
    this.pos = pos + 1;
    // Track `(`/`[` nesting so the number scanner can tell a thousands group
    // from an argument/element separator (see {@link groupingStack}). `[` always
    // opens a separator context (a vector/matrix). `(` opens a separator context
    // only when it is a CALL, i.e. it directly follows a value the call applies
    // to, an identifier/unit, or a closing `)`/`]`; a bare GROUPING `(`, after an
    // operator or the line start, keeps thousands so `(1,000)` stays one number.
    // `)`/`]` pop; a stray closer with an empty stack is ignored.
    if (c0 === 91) {  // [
      this.groupingStack.push(true);
    } else if (c0 === 40) {  // (
      this.groupingStack.push(this.precededByCallTarget(pos));
    } else if (c0 === 41 || c0 === 93) {  // ) or ]
      if (this.groupingStack.length > 0) this.groupingStack.pop();
    }
    const opType = OP_MAP[c0];
    const text = input.charAt(pos);
    return new LexerToken(opType || 'ERROR', tokenTypeId(opType || 'ERROR'), text, text, pos, 0, this.line, col);
  }

  // ── String literal tokenizer ──────────────────────────────────────────
  /**
   * Reads a double-quoted string literal. Supports backslash escapes.
   *
   * `text` is the raw source slice, quotes included, because that is what
   * `offset` + `text.length` has to span for a host to underline the literal.
   * `value` is the PAYLOAD, quotes excluded, because that is what
   * `PUSH_STRING` puts into the Value.
   *
   * The two used to be the same string. `"abc"` carried the five characters
   * `"abc"` as its value, which was invisible on screen (the formatter prints
   * the payload raw and the retained quotes landed where a display would have
   * put them back) and not invisible anywhere else: `parseFloat('"5"')` is NaN
   * whatever the digits say, so `"5" + 5` answered 5.
   *
   * An unterminated literal is an error rather than a string that happens to
   * reach the end of the line. It used to return what it had, so `"abc` and
   * `"abc"` were indistinguishable by payload once the quotes were stripped,
   * which is the other half of why they are stripped here rather than later.
   */
  private tokenizeString(): Token {
    const input = this.input;
    const len = this.len;
    const start = this.pos;
    const startCol = start - this.lineStartPos + 1;
    let pos = start + 1;
    let lineBreaks = 0;

    while (pos < len) {
      const c0 = input.charCodeAt(pos);
      if (c0 === 34) {
        pos++;
        const text = input.slice(start, pos);
        const value = input.slice(start + 1, pos - 1);
        this.pos = pos;
        return new LexerToken('STRING', TT_STRING, value, text, start, lineBreaks, this.line, startCol);
      }
      if (c0 === 92 && pos + 1 < len) {
        pos += 2;
        continue;
      }
      if (c0 === 10) {
        this.line++;
        this.lineStartPos = pos + 1;
        lineBreaks++;
      }
      pos++;
    }

    this.pos = pos;
    throw ErrorFactory.parsing(
      "UNTERMINATED_STRING",
      `Unterminated string literal: ${input.slice(start, pos)}`,
      { literal: input.slice(start, pos), offset: start },
    );
  }

  // ── Markdown line scanner (Phase B) ───────────────────────────────────

  /**
   * L1 expression gating: quickly determine if a line contains any
   * characters that indicate an expression (digits, operators, currency,
   * backticks, parentheses, etc.).
   *
   * Pure prose lines (e.g., "The quick brown fox jumps over the lazy dog")
   * return false and can be skipped without full tokenization (L2).
   *
   * This is a fast character-by-character scan that stops at the first
   * expression indicator. Called once per line in classifyFromPositions().
   */
  static hasExpressionIndicators(input: string, start: number, end: number): boolean {
    const indicatorCodes = EXPRESSION_INDICATOR_CODES;
    for (let i = start; i < end; i++) {
      const cc = input.charCodeAt(i);
      // Check digits and operators via pre-computed Set (O(1) lookup)
      if (indicatorCodes.has(cc)) return true;
      // Unicode math/currency symbols (≥ 128, not in the 128-byte table)
      if (cc >= 128) {
        // ×, ÷, ≠, £, €, ¥, ₽, ₩, common expression symbols
        if (cc === 0x00D7 || cc === 0x00F7 || cc === 0x2260 ||
            cc === 0x00A3 || cc === 0x20AC ||
            cc === 0x00A5 || cc === 0x20BD || cc === 0x20A9) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Classify a line by its character positions within this.input.
   * Reads directly from this.input using start/end boundaries.
   * DOES NOT modify this.pos, purely a read-only classifier.
   */
  /**
   * Advance past the whitespace after a list marker, and past a task-item
   * checkbox if one follows.
   *
   * The checkbox is included because it is markup by the same argument the
   * marker is, and because leaving it stopped the line dead: `- [ ] 100 + 20`
   * lexed `[ ]` as a matrix literal and reported that a matrix cannot be
   * empty, which tells a user writing a to-do list nothing they can act on.
   *
   * @param from - Offset just past the marker character.
   * @param end - Line end, never read past.
   * @returns Offset of the first evaluable character.
   */
  private skipMarkerGap(from: number, end: number): number {
    const input = this.input;
    let pos = from;
    while (pos < end && (input.charCodeAt(pos) === 32 || input.charCodeAt(pos) === 9)) pos++;

    // `[ ]`, `[x]`, `[X]`, or any single-character state Obsidian allows.
    if (pos + 2 < end && input.charCodeAt(pos) === 91 && input.charCodeAt(pos + 2) === 93) {
      let after = pos + 3;
      while (after < end && (input.charCodeAt(after) === 32 || input.charCodeAt(after) === 9)) after++;
      // Only when whitespace followed, so `[1,2]` opening a real matrix is
      // never mistaken for a checkbox.
      if (after > pos + 3) return after;
    }
    return pos;
  }

  /**
   * The end offset (exclusive) of a `#hex` colour literal starting at `hashPos`,
   * or -1 if the run there is not one. A colour is `#` followed by EXACTLY 3, 4,
   * 6 or 8 hex digits (the CSS forms `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`) and
   * then a boundary, not a longer word or number. This is the one predicate that
   * carves colours out of the two things `#` otherwise means, a markdown heading
   * at line start and a comment mid-line, and it is pure character logic so line
   * classification stays vocabulary-independent. Examples: `#f00`, `#ff0000`,
   * `#deadbeef` match; `# Heading` (space), `#tag`/`#todo` (non-hex letter),
   * `#12345` (length 5), `#ff0000zz` (trailing word) do not.
   */
  private matchHexColourEnd(hashPos: number, end: number): number {
    const input = this.input;
    let p = hashPos + 1;
    let n = 0;
    while (p < end) {
      const c = input.charCodeAt(p);
      const isHex = (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
      if (!isHex) break;
      n++;
      p++;
    }
    if (n !== 3 && n !== 4 && n !== 6 && n !== 8) return -1;
    if (p < end) {
      const c = input.charCodeAt(p);
      const isWord = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
      if (isWord) return -1;
    }
    return p;
  }

  /**
   * Whether an inline-solve opener (`s` + backtick) occurs in `[from, end)`.
   *
   * Bounded by hand rather than written as `input.indexOf("s\`", from)`. This
   * used to be the `indexOf` form with an `idx < end` check afterwards, which
   * is correct but not bounded: when {@link scanDocument} is classifying,
   * `this.input` is the whole document, so a line with no marker scanned to
   * the END OF THE DOCUMENT before the check could reject the hit. Every line
   * paid for every line after it, and a whole-document parse was quadratic in
   * line count (measured at 28.9 us per line at 10,000 lines against 10.1 us
   * at 1,000, and two thirds of the parse's self time in a profile). A prose
   * document with many candidate `s` characters was worse still. The
   * wikilink close in {@link indexOfWithin} had the same shape.
   */
  private hasInlineSolveWithin(from: number, end: number): boolean {
    const input = this.input;
    const last = end - 1;
    for (let i = from; i < last; i++) {
      if (input.charCodeAt(i) === 115 && input.charCodeAt(i + 1) === 96) return true;
    }
    return false;
  }

  /**
   * `input.indexOf(needle, from)` restricted to `[from, end)`, returning -1
   * when the needle does not occur wholly before `end`. See
   * {@link hasInlineSolveWithin} for why the plain `indexOf` was not enough.
   */
  private indexOfWithin(needle: string, from: number, end: number): number {
    const input = this.input;
    const last = end - needle.length;
    const first = needle.charCodeAt(0);
    for (let i = from; i <= last; i++) {
      if (input.charCodeAt(i) !== first) continue;
      let k = 1;
      while (k < needle.length && input.charCodeAt(i + k) === needle.charCodeAt(k)) k++;
      if (k === needle.length) return i;
    }
    return -1;
  }

  private classifyFromPositions(start: number, end: number): LineClassification {
    const len = end;

    if (start >= len) {
      return { type: 'empty', skip: true, hasInlineSolve: false };
    }

    const input = this.input;
    let pos = start;

    while (pos < len) {
      const cc = input.charCodeAt(pos);
      if (cc !== 32 && cc !== 9) break;
      pos++;
    }

    if (pos >= len) {
      return { type: 'empty', skip: true, hasInlineSolve: false };
    }

    const c0 = input.charCodeAt(pos);
    let hasInline: boolean | undefined;

    // ── Heading: #{1,6} ' ' ──────────────────────────────────────────
    if (c0 === 35) {
      // A bare #hex colour is a value, not a heading. A real heading has a space
      // after its #(s), so the colour shape (# + 3/4/6/8 hex digits) never
      // collides with one. This line is tokenized like any expression.
      if (this.matchHexColourEnd(pos, len) !== -1) {
        if (hasInline === undefined) hasInline = this.hasInlineSolveWithin(pos, len);
        return { type: 'expression', skip: false, hasInlineSolve: hasInline };
      }
      let hashCount = 1;
      while (pos + hashCount < len && input.charCodeAt(pos + hashCount) === 35) {
        hashCount++;
      }
      if (hashCount <= 6 && pos + hashCount < len && input.charCodeAt(pos + hashCount) === 32) {
        return { type: 'heading', skip: true, hasInlineSolve: false };
      }
      return { type: 'heading', skip: true, hasInlineSolve: false };
    }

    // ── Blockquote: > ' ' ────────────────────────────────────────────
    if (c0 === 62) {
      if (pos + 1 < len && input.charCodeAt(pos + 1) === 32) {
        return { type: 'blockquote', skip: true, hasInlineSolve: false };
      }
    }

    // ── Code fence: ``` or ~~~ ────────────────────────────────────────
    if (c0 === 96 && pos + 2 < len && input.charCodeAt(pos + 1) === 96 && input.charCodeAt(pos + 2) === 96) {
      return { type: 'code_fence', skip: true, hasInlineSolve: false };
    }
    if (c0 === 126 && pos + 2 < len && input.charCodeAt(pos + 1) === 126 && input.charCodeAt(pos + 2) === 126) {
      return { type: 'code_fence', skip: true, hasInlineSolve: false };
    }

    // ── Math fence: $$ ────────────────────────────────────────────────
    if (c0 === 36 && pos + 1 < len && input.charCodeAt(pos + 1) === 36) {
      return { type: 'math_fence', skip: true, hasInlineSolve: false };
    }

    // ── Horizontal rule: ---, ***, ___ (3+ same char, then only whitespace)
    if (c0 === 45 || c0 === 42 || c0 === 95) {
      let count = 1;
      while (pos + count < len && input.charCodeAt(pos + count) === c0) {
        count++;
      }
      if (count >= 3) {
        let trailPos = pos + count;
        while (trailPos < len && (input.charCodeAt(trailPos) === 32 || input.charCodeAt(trailPos) === 9)) {
          trailPos++;
        }
        if (trailPos >= len) {
          return { type: 'hr', skip: true, hasInlineSolve: false };
        }
      }
    }

    // ── Unordered list: - ' ', * ' ', + ' ' ──────────────────────────
    if ((c0 === 45 || c0 === 42 || c0 === 43) && pos + 1 < len && input.charCodeAt(pos + 1) === 32) {
      if (hasInline === undefined) hasInline = this.hasInlineSolveWithin(pos, len);
      // The space is what makes this a marker rather than an operator, and it
      // is required by CommonMark for exactly that reason. `-100 + 20` has no
      // space and stays arithmetic; `- 100 + 20` is a bullet.
      return { type: 'list', skip: false, hasInlineSolve: hasInline, contentOffset: this.skipMarkerGap(pos + 1, len) };
    }

    // ── Ordered list: \n+ '. ' ────────────────────────────────────────
    if (c0 >= 48 && c0 <= 57) {
      let digitPos = pos;
      while (digitPos < len && input.charCodeAt(digitPos) >= 48 && input.charCodeAt(digitPos) <= 57) {
        digitPos++;
      }
      if (digitPos < len && input.charCodeAt(digitPos) === 46) {
        if (digitPos + 1 < len && input.charCodeAt(digitPos + 1) === 32) {
          if (hasInline === undefined) hasInline = this.hasInlineSolveWithin(pos, len);
          return { type: 'list', skip: false, hasInlineSolve: hasInline, contentOffset: this.skipMarkerGap(digitPos + 1, len) };
        }
      }
    }

    // ── Table / table separator: | ────────────────────────────────────
    if (c0 === 124) {
      let tPos = pos + 1;
      while (tPos < len) {
        const tc = input.charCodeAt(tPos);
        if (tc !== 45 && tc !== 58 && tc !== 124 && tc !== 32 && tc !== 9 && tc !== 13) break;
        tPos++;
      }
      if (tPos >= len) {
        return { type: 'table_separator', skip: true, hasInlineSolve: false };
      }
    }

    // ── Wikilink / embed: [[ or ![[ ───────────────────────────────────
    if (c0 === 91 && pos + 1 < len && input.charCodeAt(pos + 1) === 91) {
      const closePos = this.indexOfWithin(']]', pos + 2, len);
      if (closePos !== -1) {
        let trailPos = closePos + 2;
        while (trailPos < len && (input.charCodeAt(trailPos) === 32 || input.charCodeAt(trailPos) === 9)) {
          trailPos++;
        }
        if (trailPos >= len) {
          return { type: 'wikilink', skip: true, hasInlineSolve: false };
        }
      }
    }
    if (c0 === 33 && pos + 2 < len && input.charCodeAt(pos + 1) === 91 && input.charCodeAt(pos + 2) === 91) {
      const closePos = this.indexOfWithin(']]', pos + 3, len);
      if (closePos !== -1) {
        let trailPos = closePos + 2;
        while (trailPos < len && (input.charCodeAt(trailPos) === 32 || input.charCodeAt(trailPos) === 9)) {
          trailPos++;
        }
        if (trailPos >= len) {
          return { type: 'wikilink', skip: true, hasInlineSolve: false };
        }
      }
    }

    // ── Comment: // ──────────────────────────────────────────────────
    if (c0 === 47 && pos + 1 < len && input.charCodeAt(pos + 1) === 47) {
      return { type: 'comment', skip: true, hasInlineSolve: false };
    }

    // ── Default: expression or prose line ─────────────────────────────
    if (c0 === 62) {
      let trail = pos + 1;
      while (trail < len && (input.charCodeAt(trail) === 32 || input.charCodeAt(trail) === 9)) trail++;
      if (trail >= len) return { type: 'blockquote', skip: true, hasInlineSolve: false };
    }
    if (c0 === 45 || c0 === 42 || c0 === 43) {
      let trail = pos + 1;
      while (trail < len && (input.charCodeAt(trail) === 32 || input.charCodeAt(trail) === 9)) trail++;
      if (trail >= len) return { type: 'list', skip: false, hasInlineSolve: false };
    }
    if (hasInline === undefined) hasInline = this.hasInlineSolveWithin(pos, len);

    // A line built only from characters the tokenizer discards produces no
    // tokens, so it has nothing to evaluate. Whitespace-only lines already
    // classify as empty above; the gap was an unknown ASCII character like a
    // backslash, which the lexer skips (it falls through to CharClass.SKIP)
    // rather than tokenising. A run of them ("\\", "\\\\") reached the
    // expression path, lexed to an empty token stream, and the engine reported
    // that stream as the number 0: a result on screen for a line that holds no
    // expression at all. Classify it as empty, the same as a blank line, so
    // every surface (the batch parse, the incremental evaluator, and the
    // playground's shouldEvaluateLine) skips it rather than answering 0. A
    // non-ASCII code point is real content (it lexes as an IDENT for forward
    // compatibility), so only ASCII whitespace and skip characters count here.
    if (!hasInline) {
      let onlySkippable = true;
      for (let i = pos; i < len; i++) {
        const code = input.charCodeAt(i);
        if (code >= 128 || ExpressionLexer.CHAR_CLASS[code] > CharClass.WHITESPACE) {
          onlySkippable = false;
          break;
        }
      }
      if (onlySkippable) {
        return { type: 'empty', skip: true, hasInlineSolve: false };
      }
    }

    // Return expression, all non-markdown-structure lines are tokenized.
    // (L1 prose gating removed: it incorrectly skipped keyword-only lines
    // like "pi", single identifiers like "hello", and any line without
    // digits/operators/currency. Can be re-added with keyword-awareness
    // and proper test coverage.)
    return { type: 'expression', skip: false, hasInlineSolve: hasInline };
  }

  /**
   * Classify a single line of markdown text.
   */
  classifyLine(lineText: string): LineClassification {
    const savedInput = this.input;
    const savedLen = this.len;
    const savedPos = this.pos;
    this.input = lineText;
    this.len = lineText.length;
    this.pos = 0;
    const result = this.classifyFromPositions(0, lineText.length);
    this.input = savedInput;
    this.len = savedLen;
    this.pos = savedPos;
    return result;
  }

  /**
   * Every keyword this lexer currently recognizes, locale keywords
   * (`pi`, `sqrt`, `convert`, ...) merged with any plugin-contributed ones
   * from `registerVocabulary()` (e.g. a package's custom keywords), mapped to
   * the token type they lex to. A snapshot copy, not a live reference
   * mutating the return value has no effect on the lexer.
   */
  getKeywords(): Record<string, string> {
    return Object.fromEntries(this.mergedKeywords);
  }

  /**
   * Find all inline solve markers in a line with precise coordinate mapping.
   */
  findInlineSolves(lineText: string): InlineSolveSpan[] {
    const results: InlineSolveSpan[] = [];
    const len = lineText.length;
    let pos = 0;

    while (pos < len) {
      const sPos = lineText.indexOf('s`', pos);
      if (sPos === -1) break;

      const exprStart = sPos + 2;

      let exprEnd = exprStart;
      while (exprEnd < len) {
        const cc = lineText.charCodeAt(exprEnd);
        if (cc === 92 && exprEnd + 1 < len) {
          exprEnd += 2;
          continue;
        }
        if (cc === 96) break;
        exprEnd++;
      }

      if (exprEnd >= len) {
        exprEnd = len;
      }

      const expression = lineText.slice(exprStart, exprEnd);
      const end = exprEnd < len ? exprEnd + 1 : exprEnd;

      results.push({
        start: sPos,
        end,
        expression,
        columnNumber: sPos + 1,
      });

      pos = end;
    }

    return results;
  }

  // ── Comment tokenizer ─────────────────────────────────────────────────
  /**
   * Reads a comment: # to end of line, or // to end of line.
   */
  private tokenizeComment(): Token {
    const input = this.input;
    const len = this.len;
    const start = this.pos;
    const startCol = start - this.lineStartPos + 1;

    // A `#hex` colour literal is not a comment. Recognised here (the single
    // choke-point both `#` call sites reach) so `#ff0000` becomes a HEX_COLOUR
    // token while `# comment`, `#tag`, `#face` (length 4 all-hex still counts as a
    // colour) and `// c` stay comments. Only fires when the char is `#`, never `/`.
    if (input.charCodeAt(start) === 35) {
      const hexEnd = this.matchHexColourEnd(start, len);
      if (hexEnd !== -1) {
        const text = input.slice(start, hexEnd);
        this.pos = hexEnd;
        return new LexerToken('HEX_COLOUR', TT_HEX_COLOUR, text, text, start, 0, this.line, startCol);
      }

      // A bounded `#tag` annotation: `#` then a letter then a run of
      // `[A-Za-z0-9_-]`, consuming only the tag, not the rest of the line. So
      // `1200 #housing // note` keeps the `// note` comment, and a mid-line tag
      // no longer swallows the line. `# ` (space) and `#123` (leading digit)
      // still fall through to a comment; a line-start `#` is a heading
      // (classified elsewhere); a `#hex` colour is caught above.
      const first = input.charCodeAt(start + 1);
      const isLetter = (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
      // #198: a `#` glued to the end of a word or number is not a tag. The
      // category-tag scanner (packages/tags/TagScanner.ts) only counts a tag at
      // a non-word boundary (`(?:^|[^0-9A-Za-z_])#...`), so `100#food`, `$100#food`
      // and `a#b` are excluded there; the lexer must agree, or a line renders
      // tagged but is silently left out of the totals. A line-first `#` never
      // reaches here (the classifier makes it a heading), so a mid-line tag only
      // needs its preceding character to be a non-word char.
      const prevCode = start > this.lineStartPos ? input.charCodeAt(start - 1) : -1;
      const prevIsWordChar =
        (prevCode >= 48 && prevCode <= 57) ||
        (prevCode >= 65 && prevCode <= 90) ||
        (prevCode >= 97 && prevCode <= 122) ||
        prevCode === 95;
      if (isLetter && !prevIsWordChar) {
        let tagEnd = start + 2;
        while (tagEnd < len) {
          const c = input.charCodeAt(tagEnd);
          const isTagChar = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45;
          if (!isTagChar) break;
          tagEnd++;
        }
        // Store the name without the `#`, matching how LINE_REF keeps the bare
        // number.
        const name = input.slice(start + 1, tagEnd);
        this.pos = tagEnd;
        return new LexerToken('TAG', TT_TAG, name, name, start, 0, this.line, startCol);
      }
    }

    let pos = this.pos;

    if (pos + 1 < len && input.charCodeAt(pos + 1) === 47) {
      pos += 2;
    } else {
      pos++;
    }

    while (pos < len) {
      const c0 = input.charCodeAt(pos);
      if (c0 === 10 || c0 === 13) break;
      pos++;
    }

    const text = input.slice(start, pos);
    this.pos = pos;
    return new LexerToken('COMMENT', TT_COMMENT, text, text, start, 0, this.line, startCol);
  }
}