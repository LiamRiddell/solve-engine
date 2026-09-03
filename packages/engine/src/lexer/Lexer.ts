import { ExpressionLexer, LineClassification, LexerVocabulary, type ScanLineResult } from "./ExpressionLexer";
import { Token } from "@solve-js/lexer/Token";
import { EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import { LexerState } from "@solve-js/lexer/LexerState";
import { getTokenCategory } from "@solve-js/language/TokenCategoryMap";
import type { TokenCategory } from "@solve-js/language/TokenCategory";
import type { TokenLookup } from "@solve-js/lexer/TokenClassRegistry";

/**
 * Public tokenizer wrapper around {@link ExpressionLexer}.
 *
 * `ExpressionLexer` does the actual character-by-character scanning;
 * `Lexer` adds a materialized-token-array streaming interface
 * (`next()`/`peek()`) plus line-classification state (`reset()`) so
 * callers can iterate a line's tokens without re-scanning on each peek.
 *
 * Each `ExpressionEngine` instance owns its own `Lexer`, and packages
 * extend it via {@link registerVocabulary} (keywords, operators, units)
 * see `IEnginePackage.lexerVocabulary`.
 */
export class Lexer {
  /** Expression-mode lexer (Phase A: V8-optimized, replaces moo) */
  private expressionLexer: ExpressionLexer;
  private currentState: LexerState = LexerState.Main;
  private peekedToken: Token | undefined;
  private hasPeeked = false;

  // Materialized token array from the last reset() call, used for
  // next()/peek() streaming access.
  private tokens: Token[] = [];
  private tokenIdx: number = 0;

  /**
   * @param localeCode - Locale code (e.g., "en", "de"). Defaults to "en".
   * @param tokenLookup - Optional TokenLookup from TokenClassRegistry.
   *   When provided, configures ExpressionLexer to use registry-built
   *   keyword/unit/phrase lookups instead of internal instance maps.
   */
  constructor(localeCode = "en", tokenLookup?: TokenLookup) {
    // Pass the lookup directly to ExpressionLexer's constructor, it's an
    // instance field now, not a static. Each Lexer instance gets its own
    // isolated lookup, preventing cross-instance corruption.
    this.expressionLexer = new ExpressionLexer(localeCode, tokenLookup);
  }

  reset(input: string, state?: LexerState): void {
    const newState = state ?? LexerState.Main;
    this.currentState = newState;
    this.hasPeeked = false;
    this.peekedToken = undefined;

    // Phase B: Main state classifies the line with the markdown scanner.
    // Skip lines (headings, fences, HRs, etc.) produce empty token arrays.
    // Expression lines and lines with inline solves are tokenized normally.
    if (newState === LexerState.Main) {
      const classification = this.expressionLexer.classifyLine(input);
      if (classification.skip) {
        this.tokens = [];
        this.tokenIdx = 0;
        return;
      }
      // Expression line or markdown line with inline solves, tokenize.
      this.expressionLexer.reset(input);
      this.tokens = this.expressionLexer.tokenizeAll();
      this.tokenIdx = 0;
    } else {
      // Non-main states (Inline, String), expression tokenization.
      this.expressionLexer.reset(input);
      this.tokens = this.expressionLexer.tokenizeAll();
      this.tokenIdx = 0;
    }
  }

  /**
   * Classify a single line of markdown text (Phase B).
   * Delegates to the ExpressionLexer's character-by-character scanner.
   */
  classifyLine(lineText: string): LineClassification {
    return this.expressionLexer.classifyLine(lineText);
  }

  /**
   * Find all inline solve markers in a line (Phase B).
   * Delegates to the ExpressionLexer's character-by-character scanner.
   */
  findInlineSolves(lineText: string) {
    return this.expressionLexer.findInlineSolves(lineText);
  }

  /**
   * Every keyword this lexer currently recognizes (locale + plugin-contributed),
   * mapped to the token type it lexes to. Delegates to the ExpressionLexer.
   */
  getKeywords(): Record<string, string> {
    return this.expressionLexer.getKeywords();
  }

  next(): Token | undefined {
    if (this.hasPeeked) {
      this.hasPeeked = false;
      return this.peekedToken;
    }
    // Materialized token array (ExpressionLexer path).
    if (this.tokenIdx < this.tokens.length) {
      return this.tokens[this.tokenIdx++];
    }
    return undefined;
  }

  peek(): Token | undefined {
    if (this.hasPeeked) return this.peekedToken;
    this.peekedToken = this.next();
    this.hasPeeked = true;
    return this.peekedToken;
  }

  [Symbol.iterator](): Iterator<Token> {
    return this.tokens[Symbol.iterator]();
  }

  /**
   * Register a plugin to extend the lexer with custom tokens.
   * Delegates to the underlying ExpressionLexer.
   *
   * @see LexerVocabulary for the supported extension points.
   */
  registerVocabulary(plugin: LexerVocabulary): void {
    this.expressionLexer.registerVocabulary(plugin);
  }

  /**
   * Unregister a plugin, removing its custom tokens from the lexer.
   * Delegates to the underlying ExpressionLexer.
   */
  unregisterVocabulary(plugin: LexerVocabulary): void {
    this.expressionLexer.unregisterVocabulary(plugin);
  }

  /**
   * Reset the lexer for expression-only text, skips the classifyLine()
   * overhead in reset() for callers that already know the input is an
   * evaluable expression (e.g., after isEmptyLine() confirmed non-skip).
   */
  resetExpression(input: string): void {
    this.currentState = LexerState.Main;
    this.hasPeeked = false;
    this.peekedToken = undefined;
    this.expressionLexer.reset(input);
    this.tokens = this.expressionLexer.tokenizeAll();
    this.tokenIdx = 0;
  }

  /**
   * Scan a full document in one pass, classifying each line and
   * tokenizing non-skipped lines. Delegates to ExpressionLexer.
   *
   * @returns ScanLineResult[], one per line, with classification + tokens.
   */
  scanDocument(text: string): ScanLineResult[] {
    return this.expressionLexer.scanDocument(text);
  }

  getState(): LexerState {
    return this.currentState;
  }

  setState(state: LexerState): void {
    this.currentState = state;
  }

  getHighlightTokens(lineText: string): {type: string; value: string; offset: number; col: number; length: number; category: TokenCategory | undefined}[] {
    const classification = this.expressionLexer.classifyLine(lineText);

    // For blockquote lines, strip the "> " prefix and tokenize the expression content.
    // This lets expressions inside blockquotes (e.g., "> 1 + 2") get syntax highlighted
    // while pure structural lines (headings, code fences) remain unhighlighted.
    if (classification.skip && lineText.startsWith("> ")) {
      return this.collectHighlightTokens(lineText.slice(2));
    }

    if (classification.skip) {
      return [];
    }

    return this.collectHighlightTokens(lineText);
  }

  /**
   * The same tokens {@link getHighlightTokens} reduces, before reduction.
   *
   * Exists because normalization operates on tokens, not on the flattened
   * shape, and a consumer that wants phrase-fused highlighting has to run the
   * normalizer between the two. See `LanguageService.getSemanticTokens`.
   *
   * @param lineText - One line of source.
   * @returns Every token on the line that is worth painting, unreduced.
   */
  getHighlightTokenObjects(lineText: string): Token[] {
    const classification = this.expressionLexer.classifyLine(lineText);
    if (classification.skip && lineText.startsWith("> ")) {
      return this.collectTokenObjects(lineText.slice(2));
    }
    if (classification.skip) return [];
    return this.collectTokenObjects(lineText);
  }

  private collectTokenObjects(lineText: string): Token[] {
    // Driven token by token off the scanner rather than through
    // resetExpression(), which tokenises the whole line up front and so has
    // nothing to hand back when the line faults part way. Highlighting is
    // painted while the line is still being typed, and an unterminated string
    // is what a line looks like between the opening quote and the closing one:
    // the tokens read before the fault are the right thing to paint, and
    // letting the throw escape blanked the line.
    this.currentState = LexerState.Main;
    this.hasPeeked = false;
    this.peekedToken = undefined;
    this.expressionLexer.reset(lineText);
    const result: Token[] = [];
    try {
      for (const token of this.expressionLexer) {
        if (token.type === "WS" || token.type === "NEWLINE") continue;
        if (token.type.startsWith("MD_")) continue;
        if (token.type === "INLINE_SOLVE_START" || token.type === "BACKTICK_CLOSE") continue;
        result.push(token);
      }
    } catch (thrown) {
      if (!(thrown instanceof EngineError)) throw thrown;
    }
    this.tokens = result;
    this.tokenIdx = 0;
    return result;
  }

  private collectHighlightTokens(lineText: string): {type: string; value: string; offset: number; col: number; length: number; category: TokenCategory | undefined}[] {
    return this.collectTokenObjects(lineText).map(token => ({
      type: token.type,
      value: token.value,
      offset: token.offset,
      col: token.col,
      // `text`, not `value`: this is a span into the source, and the two
      // differ for a string literal, whose value is the payload while its
      // text still carries the quote characters the reader typed.
      length: token.text.length,
      category: getTokenCategory(token.type),
    }));
  }
}

/**
 * A lexer for operations that do not depend on registered vocabulary.
 *
 * Line classification and inline-solve detection read characters looking for
 * headings, comment markers, fences and backtick spans, and never consult the
 * keyword, unit or operator tables. Every lexer therefore returns the same
 * answer, so the callers that have no engine to ask can use this one. Checked
 * by `__tests__/lexer/LineClassificationIsVocabularyIndependent.spec.ts`.
 *
 * Do not tokenize with this. An engine's own lexer carries the vocabulary its
 * packages registered; this one carries none.
 */
export const sharedLexer = new Lexer("en", undefined);