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
   * @param _tokenLookup - Ignored. The lexer never read the lookup it was
   *   handed; the parameter stays so existing callers compile.
   *   @deprecated Removed in 3.0.
   */
  constructor(localeCode = "en", _tokenLookup?: TokenLookup) {
    this.expressionLexer = new ExpressionLexer(localeCode);
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

  /**
   * Where the part of a line worth highlighting starts, or -1 when the line is
   * markdown structure with nothing to highlight (a heading, a fence, a rule).
   *
   * Two markers are set aside, and every span is still measured on the line as
   * written, so a host colours the characters it thinks it is colouring:
   *
   * - A blockquote's `> `. The evaluator skips a quoted line, but its content
   *   is still painted, so `> 1 + 2` reads as the sum it quotes.
   * - A list marker (`- `, `* `, `+ `, `1. `, and a task's `- [ ] `), the same
   *   one the evaluator starts past (`LineClassification.contentOffset`), so
   *   `- 100 + 20` is painted as the `100 + 20` it evaluates, not as a minus.
   *   Inside a blockquote too: `> - 1 + 2` starts at the `1`.
   *
   * Spans on a quoted line used to be measured from the text after the `> `,
   * two columns short of the characters they named (#567).
   *
   * @param lineText - One line of source.
   * @param classification - The line's classification, when the caller already has it.
   * @returns The offset to highlight from, or -1 for nothing.
   */
  highlightContentStart(lineText: string, classification: LineClassification = this.expressionLexer.classifyLine(lineText)): number {
    let start = 0;
    let content = classification;
    if (content.skip) {
      if (!lineText.startsWith("> ")) return -1;
      start = 2;
      content = this.expressionLexer.classifyLine(lineText.slice(2));
    }
    if (content.contentOffset !== undefined) start += content.contentOffset;
    return start;
  }

  /**
   * Every token on a line worth painting, each with its category and its span
   * on the line as written.
   *
   * @param lineText - One line of source.
   * @param from - Where to start, from {@link highlightContentStart} unless the
   *   caller already has it; -1 paints nothing.
   * @returns The tokens, in order, offsets measured on `lineText`.
   */
  getHighlightTokens(lineText: string, from: number = this.highlightContentStart(lineText)): {type: string; value: string; offset: number; col: number; length: number; category: TokenCategory | undefined}[] {
    if (from < 0) return [];
    return this.collectHighlightTokens(lineText, from);
  }

  /**
   * The same tokens {@link getHighlightTokens} reduces, before reduction.
   *
   * Exists because normalization operates on tokens, not on the flattened
   * shape, and a consumer that wants phrase-fused highlighting has to run the
   * normalizer between the two. See `LanguageService.getSemanticTokens`.
   *
   * @param lineText - One line of source.
   * @param from - As for {@link getHighlightTokens}.
   * @returns Every token on the line that is worth painting, unreduced.
   */
  getHighlightTokenObjects(lineText: string, from: number = this.highlightContentStart(lineText)): Token[] {
    if (from < 0) return [];
    return this.collectTokenObjects(lineText, from);
  }

  private collectTokenObjects(lineText: string, from: number): Token[] {
    // Scanned into an array this method owns rather than through
    // resetExpression(), which has nothing to hand back when the line faults
    // part way. Highlighting is painted while the line is still being typed,
    // and an unterminated string is what a line looks like between the
    // opening quote and the closing one: the tokens read before the fault are
    // the right thing to paint, and letting the throw escape blanked the line.
    this.currentState = LexerState.Main;
    this.hasPeeked = false;
    this.peekedToken = undefined;
    this.expressionLexer.reset(lineText, from);
    const raw: Token[] = [];
    try {
      this.expressionLexer.tokenizeInto(raw);
    } catch (thrown) {
      if (!(thrown instanceof EngineError)) throw thrown;
    }
    const result: Token[] = [];
    for (const token of raw) {
      if (token.type === "WS" || token.type === "NEWLINE") continue;
      if (token.type.startsWith("MD_")) continue;
      if (token.type === "INLINE_SOLVE_START" || token.type === "BACKTICK_CLOSE") continue;
      result.push(token);
    }
    this.tokens = result;
    this.tokenIdx = 0;
    return result;
  }

  private collectHighlightTokens(lineText: string, from: number): {type: string; value: string; offset: number; col: number; length: number; category: TokenCategory | undefined}[] {
    return this.collectTokenObjects(lineText, from).map(token => ({
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