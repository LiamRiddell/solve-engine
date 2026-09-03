import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { Token, tokenTypeId, TokenTypes } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { SourceSpan } from "@solve-js/errors/EngineError";
import { DiagnosticPipeline, DiagnosticEventType, type DiagnosticEvent } from "@solve-js/diagnostics";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower, buildBindingPowerTable } from "@solve-js/parser/BindingPower";
import { getLocale } from "@solve-js/constants/locales";
import { bigIntLiteralDigits } from "@solve-js/parser/BigIntLiteral";

/**
 * Matches a CHAINED thousands-grouped integer using "." as the group
 * separator (e.g. "1.234.567"), independent of locale. Kept in sync with
 * the identical constant in NumberParselet.ts (not imported from there
 * that file transitively re-imports PrecedenceParser via Parser.ts's
 * `export { PrecedenceParser as Parser }`, so importing the other
 * direction would create a circular dependency for the sake of one
 * regex literal). See NumberParselet.ts's copy for the full explanation.
 */
const CHAINED_DOT_THOUSANDS_GROUPS = /^\d{1,3}(\.\d{3}){2,}$/;

/**
 * A plain fractional literal: digits, exactly one dot, digits, nothing else.
 *
 * The gate for compiling to PUSH_DECIMAL. It admits "0.10", "1.005", ".5" and
 * "5." and refuses anything with an exponent ("2.5e-3"), which parses as an
 * ordinary double instead, since scientific notation has no exact base-ten
 * value this representation would keep.
 */
const PLAIN_DECIMAL = /^\d*\.\d*$/;

/**
 * ── Hybrid Precedence Climbing Parser ─────────────────────────────────────────
 *
 * Two-tier dispatch strategy:
 *
 *   Tier 1 (Fast Path): Inline switch on token.typeId for built-in operators.
 *     - Prefix: NUMBER, IDENT, LPAREN, MINUS, PLUS, STRING
 *     - Infix:  checked via static BP_TABLE (Uint8Array indexed by typeId)
 *     - No Map.get(), no parselet function call overhead for ~95% of tokens
 *
 *   Tier 2 (Plugin Path): ParseletRegistry fallback for custom/plugin tokens.
 *     - Prefix: Map.get(tokenTypeId) for PrefixParselet
 *     - Infix:  Map.get(tokenTypeId) for InfixParselet
 *     - Full flexibility for custom syntax
 *
 * The parser emits directly to a BytecodeBuilder, no AST intermediate.
 * Implements the same public API as the legacy Parser class so existing
 * parselets continue to work without modification.
 */
export class PrecedenceParser {
  private tokens: Token[] = [];
  private current = 0;
  private depth = 0;
  private maxDepth: number;

  /** Cached registry reference, avoids property chain in hot loop */
  private registry: ParseletRegistry;

  /** BytecodeBuilder, set before each parseExpression call */
  private builder!: BytecodeBuilder;

  /** Diagnostic pipeline for parselet-matched events */
  private diagnosticPipeline: DiagnosticPipeline | undefined;
  private currentExpression: string = "";
  private localeCode: string;

  /** The locale's decimal separator, cached from {@link localeCode}. */
  private readonly decimalSeparator: string;

  /** The locale's thousands separator, cached from {@link localeCode}. */
  private readonly thousandsSeparator: string;

  /**
   * The binding power the current infix parselet is being invoked at, i.e. the
   * `minBp` of the expression it sits inside. Set immediately before each Tier-2
   * parselet runs. A parselet that decides whether to swallow a following
   * loose operator (UomLiteralParselet with a trailing `in`/`to`) reads this to
   * respect precedence it cannot otherwise see: `120 km / 2 hours in kph` must
   * group as `(120 km / 2 hours) in kph`, not `120 km / (2 hours in kph)`.
   */
  infixMinBindingPower = 0;

  /**
   * Static binding power table, built once at module load, shared across all instances.
   * Index = tokenTypeId, value = binding power (0 = not a built-in infix).
   */
  static readonly BP_TABLE: Uint8Array = buildBindingPowerTable();

  // ── Pre-computed token type IDs for inline dispatch ────────────────────────
  // Prefix built-ins
  private static readonly NUMBER_ID   = tokenTypeId(TokenTypes.NUMBER);
  private static readonly BIGINT_ID   = tokenTypeId(TokenTypes.BIGINT);
  private static readonly STRING_ID   = tokenTypeId(TokenTypes.STRING);
  private static readonly IDENT_ID    = tokenTypeId(TokenTypes.IDENT);
  private static readonly LPAREN_ID   = tokenTypeId(TokenTypes.LPAREN);
  private static readonly RPAREN_ID   = tokenTypeId(TokenTypes.RPAREN);
  private static readonly MINUS_ID    = tokenTypeId(TokenTypes.MINUS);
  private static readonly PLUS_ID     = tokenTypeId(TokenTypes.PLUS);
  private static readonly KEYWORD_ID  = tokenTypeId(TokenTypes.KEYWORD);

  // Infix built-ins (Tier 1, full inline emission)
  private static readonly STAR_ID     = tokenTypeId(TokenTypes.STAR);
  private static readonly SLASH_ID    = tokenTypeId(TokenTypes.SLASH);
  private static readonly MOD_ID      = tokenTypeId(TokenTypes.MOD);
  private static readonly CARET_ID    = tokenTypeId(TokenTypes.CARET);
  private static readonly LSHIFT_ID   = tokenTypeId(TokenTypes.LSHIFT);
  private static readonly RSHIFT_ID   = tokenTypeId(TokenTypes.RSHIFT);
  private static readonly URSHIFT_ID  = tokenTypeId(TokenTypes.URSHIFT);
  private static readonly BIT_AND_ID  = tokenTypeId(TokenTypes.BIT_AND);
  private static readonly BIT_OR_ID   = tokenTypeId(TokenTypes.BIT_OR);
  private static readonly BIT_XOR_ID  = tokenTypeId(TokenTypes.BIT_XOR);
  private static readonly PERCENT_ID  = tokenTypeId(TokenTypes.PERCENT);
  private static readonly OF_ID       = tokenTypeId(TokenTypes.OF);

  /**
   * Inline opcode map for Tier 1 infix operators.
   * tokenTypeId → OpCode. PERCENT and CARET are handled specially (not in this map).
   */
  private static readonly INFIX_OPCODE: Record<number, OpCode> = {
    [tokenTypeId(TokenTypes.PLUS)]:    OpCode.ADD,
    [tokenTypeId(TokenTypes.MINUS)]:   OpCode.SUB,
    [tokenTypeId(TokenTypes.STAR)]:    OpCode.MUL,
    [tokenTypeId(TokenTypes.SLASH)]:   OpCode.DIV,
    [tokenTypeId(TokenTypes.MOD)]:     OpCode.MOD,
    [tokenTypeId(TokenTypes.CARET)]:   OpCode.EXP,
    [tokenTypeId(TokenTypes.LSHIFT)]:  OpCode.LSHIFT,
    [tokenTypeId(TokenTypes.RSHIFT)]:  OpCode.RSHIFT,
    [tokenTypeId(TokenTypes.URSHIFT)]: OpCode.URSHIFT,
    [tokenTypeId(TokenTypes.BIT_AND)]: OpCode.BIT_AND,
    [tokenTypeId(TokenTypes.BIT_OR)]:  OpCode.BIT_OR,
    [tokenTypeId(TokenTypes.BIT_XOR)]: OpCode.BIT_XOR,
    [tokenTypeId(TokenTypes.OF)]:      OpCode.MUL,
  };

  /** Shared with every BytecodeBuilder so a nested-body builder resolves plugin calls by name. */
  private pluginFunctionIndex?: ReadonlyMap<string, number>;

  constructor(parseletRegistry: ParseletRegistry, maxDepth = 50, localeCode = "en", pluginFunctionIndex?: ReadonlyMap<string, number>) {
    this.registry = parseletRegistry;
    this.maxDepth = maxDepth;
    this.localeCode = localeCode;
    // Read once, not once per number literal. `localeCode` is set here and
    // never reassigned, so these cannot go stale, and the profile had
    // getLocale() plus its property chain inside the hot NUMBER path.
    const display = getLocale(localeCode).display;
    this.decimalSeparator = display.decimalSeparator;
    this.thousandsSeparator = display.thousandsSeparator;
    this.pluginFunctionIndex = pluginFunctionIndex;
  }

  /** Get locale code for NumberParselet to normalize separators */
  getLocaleCode(): string {
    return this.localeCode;
  }

  /**
   * Set the diagnostic pipeline for parselet matching events.
   * Cleared after each non-cached parse to avoid holding refs.
   */
  setDiagnosticPipeline(pipeline: DiagnosticPipeline | undefined, expression: string): void {
    this.diagnosticPipeline = pipeline;
    this.currentExpression = expression ?? "";
  }

  /**
   * Load tokens for parsing. Identical to Parser.load().
   *
   * @param hasParens - if false, skips the O(n) paren balance scan (~90% of expressions)
   */
  load(tokens: Token[], hasParens?: boolean): void {
    if (hasParens === false) {
      this.tokens = tokens;
      this.current = 0;
      this.depth = 0;
      return;
    }
    // Paren scan: count balance to skip array copy for balanced expressions.
    const LPAREN_ID = tokenTypeId(TokenTypes.LPAREN);
    const RPAREN_ID = tokenTypeId(TokenTypes.RPAREN);
    let openCount = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].typeId === LPAREN_ID) openCount++;
      else if (tokens[i].typeId === RPAREN_ID) openCount--;
    }
    this.tokens = openCount === 0 ? tokens : this.balanceParens(tokens, openCount);
    this.current = 0;
    this.depth = 0;
  }

  /**
   * Auto-balance unmatched parentheses.
   */
  private balanceParens(tokens: Token[], openCount: number): Token[] {
    const result = tokens.slice();
    if (openCount > 0) {
      const RPAREN_ID = tokenTypeId(TokenTypes.RPAREN);
      for (let i = 0; i < openCount; i++) {
        const lastToken = tokens[tokens.length - 1];
        result.push({
          type: TokenTypes.RPAREN,
          typeId: RPAREN_ID,
          value: ")",
          text: ")",
          offset: lastToken ? lastToken.offset + lastToken.text.length : 0,
          lineBreaks: 0,
          line: lastToken ? lastToken.line : 1,
          col: lastToken ? lastToken.col + lastToken.text.length : 1,
        } as Token);
      }
    } else if (openCount < 0) {
      const LPAREN_ID = tokenTypeId(TokenTypes.LPAREN);
      for (let i = 0; i < -openCount; i++) {
        result.unshift({
          type: TokenTypes.LPAREN,
          typeId: LPAREN_ID,
          value: "(",
          text: "(",
          offset: 0,
          lineBreaks: 0,
          line: 1,
          col: 1,
        } as Token);
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Main entry point: precedence climbing parse expression
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Parse a full expression starting at the current token position.
   *
   * @param minBp - minimum binding power (precedence climbing threshold).
   *   For left-associative operators, the recursive call uses `bp + 1`.
   *   For right-associative operators (^), it uses `bp - 1`.
   * @param _builder - accepted for parselet API compatibility; always uses `this.builder`.
   */
  parseExpression(minBp: number = 0, _builder?: BytecodeBuilder): void {
    // Accept builder via parameter for backward compatibility with the old Parser API.
    // The ExpressionEngine always calls setBuilder() before parseExpression(),
    // but tests and parselets pass builder as a parameter. A builder passed
    // here is in force for this parse only: a parselet compiling a nested body
    // into its own builder gets the outer one back afterwards.
    const outerBuilder = this.builder;
    if (_builder) {
      this.builder = _builder;
    }
    // Depth is restored in a finally rather than on each return, because a
    // parselet that throws part way through a line (the common case while
    // someone is typing) used to leave the counter one higher for good.
    this.depth++;
    try {
      if (this.depth > this.maxDepth) {
        throw ErrorFactory.parsing(
          "NESTING_DEPTH_EXCEEDED",
          `Parse nesting depth ${this.depth} exceeds maximum of ${this.maxDepth}`,
          { maxDepth: this.maxDepth, currentDepth: this.depth }
        );
      }
      this.parseExpressionBody(minBp);
    } finally {
      this.depth--;
      if (_builder) this.builder = outerBuilder;
    }
  }

  /** The prefix and infix loop of {@link parseExpression}, run with the depth already counted and the builder in place. */
  private parseExpressionBody(minBp: number): void {
    const token = this.consume();
    if (!token) {
      throw ErrorFactory.parsing({ code: "UNEXPECTED_END", message: "Unexpected end of expression", span: this.spanAtEnd() });
    }

    // ── Prefix ──────────────────────────────────────────────────────────────
    this.parsePrefix(token);

    // ── Infix loop (precedence climbing with inline Tier 1 dispatch) ──────────
    const tokens = this.tokens;
    const len = tokens.length;
    const bpTable = PrecedenceParser.BP_TABLE;
    const registry = this.registry;
    const builder = this.builder;
    let idx = this.current;

    while (idx < len) {
      const lookahead = tokens[idx];
      if (!lookahead) break;

      const bp = bpTable[lookahead.typeId];
      if (bp > 0) {
        // Tier 1: Built-in infix, full inline emission, zero parselet delegation
        if (bp <= minBp) break;

        if (this.diagnosticPipeline) {
          // Fast path skips the registry, but built-ins are still registered
          // there (for introspection/tests), look them up only in this
          // diagnostics-only branch so the playground's "matched parselets"
          // view isn't permanently blind to every arithmetic operator.
          const infixParselet = registry.getInfix(lookahead.typeId);
          if (infixParselet) {
            this.fireParseletMatched(infixParselet, lookahead, false, bp);
          }
        }

        this.current = ++idx;
        const typeId = lookahead.typeId;

        if (typeId === PrecedenceParser.PERCENT_ID) {
          // Postfix: no right operand. "50%" → Percentage holding 0.5.
          //
          // Must stay byte-for-byte equivalent to PercentParselet, which is
          // the Tier-2 registration of the same operator. This path is the one
          // that actually runs for ordinary expressions, so a change made only
          // in the parselet does nothing at all: that is exactly how the
          // divide-by-100 here outlived its replacement and kept `200 + 10%`
          // answering 200.10.
          builder.emitOpcode(OpCode.PUSH_NUMBER);
          builder.emitNumber(100);
          builder.emitOpcode(OpCode.DIV);
          builder.emitOpcode(OpCode.TO_PERCENTAGE);
        } else if (typeId === PrecedenceParser.CARET_ID && this.tryEmitMatrixCaretOp(builder)) {
          // `^T` (transpose) or `^-1` (inverse), already fully handled
          // including consuming their own trailing tokens.
        } else {
          // Infix: parse right operand, then emit opcode.
          // Right-associative for CARET (^), left-associative for all others.
          //
          // The threshold has to be bp - 1, not bp. The loop above breaks on
          // `bp <= minBp`, so a right operand parsed at `bp` stops at the next
          // `^` exactly as one parsed at `bp + 1` does: the old special case
          // was dead code and "2 ^ 3 ^ 2" grouped left, answering 64. One
          // below lets the recursive call keep consuming `^`, which is what
          // makes it 2^(3^2) = 512, as in mathematics, Python, Ruby and
          // JavaScript's `**`.
          //
          // Nothing else sits between Exponent (50) and Product (40), so
          // 49 cannot collide with another operator's level. Unary minus is
          // unaffected: it parses its operand at Prefix (60), above `^`
          // either way, so "-2 ^ 2" is still (-2)^2 = 4.
          const rightBp = (typeId === PrecedenceParser.CARET_ID) ? bp - 1 : bp + 1;
          this.parseExpression(rightBp, builder);
          builder.emitOpcode(PrecedenceParser.INFIX_OPCODE[typeId]);
        }
      } else {
        // Tier 2: Plugin parselet fallback, full flexibility for custom syntax
        const infixParselet = registry.getInfix(lookahead.typeId);
        if (!infixParselet) break;
        if (infixParselet.bindingPower <= minBp) break;

        this.current = ++idx;

        if (this.diagnosticPipeline) {
          this.fireParseletMatched(infixParselet, lookahead, false, infixParselet.bindingPower);
        }
        // Expose the level this parselet is bound at, so one that peeks past its
        // own token (a unit literal weighing whether a trailing `in`/`to` is
        // its own or an outer operator's) can respect precedence. See
        // infixMinBindingPower's doc comment.
        const outerMinBindingPower = this.infixMinBindingPower;
        this.infixMinBindingPower = minBp;
        try {
          // Parselet handles its own recursion for right operand internally
          infixParselet.parse(this, token, lookahead, builder);
        } finally {
          this.infixMinBindingPower = outerMinBindingPower;
        }
      }

      idx = this.current;
    }

    this.current = idx;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Prefix dispatch: inline switch for built-ins, parselet registry for plugins
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Parse a prefix token. Built-in tokens (NUMBER, IDENT, LPAREN, etc.) are
   * handled inline with zero registry lookup. Everything else falls through
   * to the parselet registry (Tier 2).
   */
  private parsePrefix(token: Token): void {
    const builder = this.builder;
    const typeId = token.typeId;

    if (this.diagnosticPipeline) {
      // Fast path below skips the registry for built-ins, but they're still
      // registered there (for introspection/tests), look up here so the
      // playground's "matched parselets" view isn't permanently blind to
      // every number, identifier, paren, and unary operator.
      const parselet = this.registry.getPrefix(typeId);
      if (parselet) {
        this.fireParseletMatched(parselet, token, true);
      }
    }

    switch (typeId) {
      // ── Numeric literals ──────────────────────────────────────────────────
      case PrecedenceParser.NUMBER_ID: {
        // Parse number with locale-aware separator normalization
        let v: number;
        // The exact dot-decimal text for a literal written with a fractional
        // point, so it can be pushed as PUSH_DECIMAL and keep its precision
        // where it later meets money. Stays null for every integer shape
        // (hex/bin/oct, chained-dot grouping, plain integers), which push the
        // ordinary PUSH_NUMBER and are unchanged.
        let decimalText: string | null = null;
        const raw = token.value;

        // Fast path: plain digits, with at most one ".".
        //
        // Most literals in a document are `144`, `1200`, `0.85`. The general
        // path below reaches the same answer for them only after six
        // startsWith() calls, two regular expressions and a split/join that
        // allocated whether or not the separator was present; a CPU profile put
        // this whole case at over a third of parse-and-compile. One character
        // scan settles it instead.
        //
        // Guarded on the decimal separator being ".", which is what makes a
        // lone dot unambiguous. Where "." groups thousands instead, `1.234`
        // means one thousand two hundred and thirty-four, so that locale has to
        // keep taking the general path.
        if (this.decimalSeparator === ".") {
          let dots = 0;
          let plain = raw.length > 0;
          for (let i = 0; i < raw.length; i++) {
            const c = raw.charCodeAt(i);
            if (c >= 48 && c <= 57) continue;
            if (c === 46 && dots === 0) { dots = 1; continue; }
            plain = false;
            break;
          }
          if (plain) {
            // One dot with digits optional on either side is exactly what
            // PLAIN_DECIMAL matches, so this agrees with it: that is the signal
            // for the exact-decimal opcode rather than a double.
            if (dots === 1) {
              builder.emitOpcode(OpCode.PUSH_DECIMAL);
              builder.emitString(raw);
              return;
            }
            builder.emitOpcode(OpCode.PUSH_NUMBER);
            builder.emitNumber(+raw);
            return;
          }
        }

        if (raw.startsWith("0x") || raw.startsWith("0X")) {
          v = parseInt(raw, 16);
          // A prefix with no digits after it ("0x" alone) makes parseInt
          // return NaN. This used to push straight through as a silent
          // NaN Number value instead of a visible error.
          if (Number.isNaN(v)) {
            throw ErrorFactory.parsing({ code: "INVALID_NUMBER_LITERAL", message: `Invalid hex literal: "${raw}"`, context: { raw }, span: this.spanOf(token) });
          }
        } else if (raw.startsWith("0b") || raw.startsWith("0B")) {
          v = parseInt(raw.slice(2), 2);
          if (Number.isNaN(v)) {
            throw ErrorFactory.parsing({ code: "INVALID_NUMBER_LITERAL", message: `Invalid binary literal: "${raw}"`, context: { raw }, span: this.spanOf(token) });
          }
        } else if (raw.startsWith("0o") || raw.startsWith("0O")) {
          v = parseInt(raw.slice(2), 8);
          if (Number.isNaN(v)) {
            throw ErrorFactory.parsing({ code: "INVALID_NUMBER_LITERAL", message: `Invalid octal literal: "${raw}"`, context: { raw }, span: this.spanOf(token) });
          }
        } else if (CHAINED_DOT_THOUSANDS_GROUPS.test(raw)) {
          // The lexer accepts "." as a thousands-group separator
          // independent of locale (ExpressionLexer's number-scanning
          // "Thousands separators" block), but the locale-based
          // normalization below only strips the ACTIVE locale's own
          // configured thousandsSeparator character, for "en" that's
          // ",", not ".", so a chained dot-grouped literal like
          // "1.234.567" fell through to parseFloat() untouched, which
          // stops at the second "." and silently truncated it to 1.234
          // (over 99% of the digits dropped, with no error). This is the
          // REAL number-parsing path for actual evaluation, Tier 1 of
          // the two-tier dispatch above always returns for NUMBER_ID, so
          // NumberParselet.parse() (which has the identical fix) never
          // actually runs except via direct unit tests / the "matched
          // parselets" diagnostic display.
          v = parseFloat(raw.split(".").join(""));
        } else {
          const decimalSep = this.decimalSeparator;
          const thousandsSep = this.thousandsSeparator;
          let normalized = raw;
          // Replace thousands separator with empty string (split+join avoids per-call RegExp compilation).
          // The indexOf guard stops that pair allocating an array and a string
          // for the many literals that contain no separator at all.
          if (thousandsSep && normalized.indexOf(thousandsSep) !== -1) {
            normalized = normalized.split(thousandsSep).join("");
          }
          // Replace locale decimal separator with "." for JavaScript parsing
          if (decimalSep && decimalSep !== ".") {
            normalized = normalized.replace(decimalSep, ".");
          }
          v = parseFloat(normalized);
          // A plain fractional literal (digits, one dot, digits) is what carries
          // an exact decimal. Scientific notation like "2.5e-3" has a dot too
          // but no exact base-ten form worth the trouble, so it stays a
          // PUSH_NUMBER double, and so does any integer (grouping stripped).
          if (PLAIN_DECIMAL.test(normalized)) decimalText = normalized;
        }
        if (decimalText !== null) {
          builder.emitOpcode(OpCode.PUSH_DECIMAL);
          builder.emitString(decimalText);
          return;
        }
        builder.emitOpcode(OpCode.PUSH_NUMBER);
        builder.emitNumber(v);
        return;
      }

      case PrecedenceParser.BIGINT_ID: {
        // Strips the `n` and any thousands grouping the lexer coalesced in.
        // This used to be `raw.slice(0, -1)` and nothing else, so `1.000n`
        // reached BigInt("1.000") and threw a raw SyntaxError. See
        // parser/BigIntLiteral.ts, which the parselet tier shares.
        builder.emitOpcode(OpCode.PUSH_BIGINT);
        builder.emitString(bigIntLiteralDigits(token.value, this.localeCode));
        return;
      }

      case PrecedenceParser.STRING_ID: {
        builder.emitOpcode(OpCode.PUSH_STRING);
        builder.emitString(token.value);
        return;
      }

      // ── Identifiers (variables) ────────────────────────────────────────────
      case PrecedenceParser.IDENT_ID: {
        // An identifier immediately followed by "(" may be a user-defined
        // function DEFINITION (`f(x) = ...`) or CALL (`f(5)`). See
        // parseUserFunctionDefOrCall's doc comment for the full
        // disambiguation. Only the (cheap) LPAREN check runs for the
        // overwhelmingly common case of a bare identifier with nothing
        // following it.
        if (this.peek()?.typeId === PrecedenceParser.LPAREN_ID) {
          this.parseUserFunctionDefOrCall(token, builder);
          return;
        }
        // IDENT tokens map to LOAD_VAR by default. The IdentifierParselet
        // and VariableParselet add STORE_VAR for assignments, those are
        // handled via the parselet registry below. Note this is also how a
        // user-defined function's own PARAMETER references compile. See
        // UserFunctionDef's doc comment in BytecodeBuilder.ts for why there
        // is no separate parameter-load opcode: `LOAD_VAR` resolution
        // dynamically checks the VM's innermost call frame first.
        builder.emitOpcode(OpCode.LOAD_VAR);
        builder.emitString(token.value);
        return;
      }

      // ── Grouping / bare-tuple vector literal ─────────────────────────────────
      // `(expr)` groups for precedence; `(x, y[, z[, w]])` is the bare-tuple
      // vector literal documented as an alternative to vec2/vec3/vec4(...)
      // (wiki: Arithmetic/Vector). This Tier-1 case is what actually runs for
      // every LPAREN in production parsing, GroupParselet.ts mirrors this
      // logic for registry-introspection/diagnostic-listing purposes, but a
      // package can never override LPAREN's dispatch here (Tier 1 always
      // wins over the ParseletRegistry fallback below), so both must be kept
      // in sync by hand.
      case PrecedenceParser.LPAREN_ID: {
        this.parseExpression(0, builder);
        let count = 1;
        while (this.match(TokenTypes.COMMA)) {
          this.parseExpression(0, builder);
          count++;
        }
        this.consume(TokenTypes.RPAREN);
        if (count > 1) {
          // Legacy bare-tuple vector sugar, a 1xN row-vector Matrix (see
          // packages/vector/parselets/VectorParselet.ts's comment).
          builder.emitOpcode(OpCode.MAT_NEW);
          builder.emitIndex(1);
          builder.emitIndex(count);
        }
        return;
      }

      // ── Unary operators ───────────────────────────────────────────────────
      case PrecedenceParser.MINUS_ID: {
        this.parseExpression(BindingPower.Prefix, builder);
        builder.emitOpcode(OpCode.NEG);
        return;
      }

      case PrecedenceParser.PLUS_ID: {
        this.parseExpression(BindingPower.Prefix, builder);
        builder.emitOpcode(OpCode.POS);
        return;
      }

      // ── Keyword constants ─────────────────────────────────────────────────
      case PrecedenceParser.KEYWORD_ID: {
        // Keywords are handled by parselets (pi→PI, e→E, etc.)
        // Fall through to registry below.
      }
    }

    // ── Tier 2: Plugin/parselet prefix path ──────────────────────────────────
    const prefixParselet = this.registry.getPrefix(typeId);
    if (!prefixParselet) {
      throw ErrorFactory.parsing({
        code: "NO_PREFIX_PARSELET",
        message: `No prefix parselet found for token: ${token.type} ("${token.value}")`,
        context: { tokenType: token.type, tokenValue: token.value },
        span: this.spanOf(token),
      });
    }

    prefixParselet.parse(this, token, builder);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // The "Tier-1 shape-exception" pattern
  // ═══════════════════════════════════════════════════════════════════════════════
  //
  // Tier 1 exists purely for performance, avoid a Map lookup + parselet call
  // on ~95% of tokens (see this file's own module doc comment above). A
  // recurring consequence: any grammar shape tied to a Tier-1 token type can
  // ONLY be implemented by hand-editing this switch, since a package-
  // registered ParseletRegistry parselet for that same token type would
  // simply never run in production (Tier 1 always wins over the registry
  // fallback). Five confirmed instances of this tension exist in this file
  // (plus one that had to move OUTSIDE it entirely):
  //   1. NUMBER_ID, the full locale-aware number-literal parsing (hex/
  //      binary/octal, chained-dot thousands grouping, decimal-separator
  //      normalization) is inlined in parsePrefix() above; NumberParselet.ts's
  //      own copy is dead code for real evaluation, kept registered only for
  //      the "matched parselets" diagnostic view.
  //   2. IDENT_ID, parseUserFunctionDefOrCall's lookahead (below) disambig-
  //      uates a function DEFINITION from a CALL from a plain variable load.
  //   3. LPAREN_ID, the bare-tuple vector-literal sugar ("(x,y[,z[,w]])" ->
  //      MAT_NEW) is inlined in parsePrefix() above; GroupParselet.ts mirrors
  //      it for introspection only and must be kept in sync by hand.
  //   4. CARET_ID, the transpose/inverse suffix table just below.
  //   5. PLUS_ID, the locale word "and" lexes as PLUS (Tier-1, fixed Sum
  //      binding power), so a registry parselet can never intercept it the
  //      way LogicalParselet.ts intercepts "or"/&&/||; unlike the other four,
  //      there's no SHAPE to special-case on here (the token itself IS the
  //      operator), so the workaround lives entirely outside this file, as a
  //      runtime Boolean/Boolean type-check inside vm/VM.ts's OpCode.ADD
  //      handler instead.
  //
  // Deliberate non-goal: none of this is exposed as an IEnginePackage
  // extension point (unlike prefixParselets/infixParselets). Letting
  // third-party packages register their own Tier-1 shape-matchers would put
  // per-package matcher iteration on a genuinely hot path (every CARET/
  // NUMBER/IDENT/LPAREN/PLUS token, matched or not), a materially bigger
  // separate product decision than "make this one table more concise," and
  // not one this pattern write-up makes.

  /**
   * A single `^`-suffix shape: `matches` peeks ahead (consuming nothing) to
   * check whether this shape starts at the current position; `emit` is only
   * called immediately after `matches` returned true for that SAME position,
   * and is responsible for consuming that shape's own trailing tokens and
   * emitting its bytecode.
   */
  private static readonly CARET_SUFFIX_RULES: ReadonlyArray<{
    name: string;
    matches(parser: PrecedenceParser): boolean;
    emit(parser: PrecedenceParser, builder: BytecodeBuilder): void;
  }> = [
    {
      name: "transpose (^T)",
      matches: (p) => {
        const next = p.peek();
        return next?.type === TokenTypes.IDENT && next.value === "T";
      },
      emit: (p, builder) => {
        p.advance();
        builder.emitOpcode(OpCode.CALL_BUILTIN);
        builder.emitIndex(63); // transpose — see VMBuiltins.ts
        builder.emitIndex(1);
      },
    },
    {
      name: "inverse (^-1)",
      matches: (p) => {
        const next = p.peek();
        if (next?.typeId !== PrecedenceParser.MINUS_ID) return false;
        const afterMinus = p.peekAt(1);
        return afterMinus?.type === TokenTypes.NUMBER && afterMinus.value === "1";
      },
      emit: (p, builder) => {
        p.advance();
        p.advance();
        builder.emitOpcode(OpCode.CALL_BUILTIN);
        builder.emitIndex(65); // inv — see VMBuiltins.ts
        builder.emitIndex(1);
      },
    },
  ];

  /**
   * After a `^` token (already consumed by the Tier-1 infix loop above),
   * checks {@link CARET_SUFFIX_RULES} in order for a shape that means
   * something other than ordinary exponentiation: `^T` (transpose) and `^-1`
   * (matrix inverse, LITERALLY the integer exponent `-1`; `^-2`, `^-1.5`
   * etc. still mean ordinary exponentiation). On a match, the rule's `emit`
   * consumes that shape's own tokens and this returns `true`. On no match,
   * consumes NOTHING, returning `false` so the caller falls through to
   * ordinary `EXP` parsing.
   *
   * Every rule dispatches purely on SHAPE, never on operand type (unknowable
   * at parse time): `inv()`'s own handler (`VMBuiltins.ts` index 65) returns
   * `1/x` for a plain Number, byte-identical to what `Math.pow(x, -1)`
   * already computed for `x^-1` before this feature existed, and a real
   * matrix inverse for a Matrix, so `5^-1` still means exactly what it always
   * has; only a Matrix operand actually inverts.
   *
   * Adding a future `^`-suffix shape is a new table entry here, not a new
   * if-block. See the "Tier-1 shape-exception" pattern write-up above for
   * why this table can't instead be a package-registered parselet.
   */
  private tryEmitMatrixCaretOp(builder: BytecodeBuilder): boolean {
    for (const rule of PrecedenceParser.CARET_SUFFIX_RULES) {
      if (rule.matches(this)) {
        rule.emit(this, builder);
        return true;
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // User-defined, parameterized, reusable functions (f(x) = 2*x + 1, then f(5))
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * From an LPAREN token index, scan forward tracking paren depth and
   * return the index of the matching RPAREN, or `null` if the parens never
   * balance before the token stream ends. No emission, no position
   * advance. Same class of technique as {@link balanceParens}'s own
   * pre-scan, just exposed mid-parse instead of only at `load()` time.
   * `openIdx` must point AT the LPAREN itself.
   */
  private findMatchingRParen(openIdx: number): number | null {
    let depth = 0;
    for (let i = openIdx; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.typeId === PrecedenceParser.LPAREN_ID) depth++;
      else if (t.typeId === PrecedenceParser.RPAREN_ID) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return null;
  }

  /**
   * Disambiguates a bare `IDENT` immediately followed by `(` between three
   * things, using ONLY a bracket-depth scan (no backtracking, nothing is
   * consumed until the shape is known):
   * - `f(x) = expr`, a DEFINITION: the matching `)` is followed by `=`.
   * - `f(5)`, a CALL to a (possibly not-yet-defined) function: anything
   *   else. This was never valid syntax before this feature (a bare
   *   `IDENT` immediately before `(` has no pre-existing "plain variable
   *   read + separately grouped `(...)`" meaning to preserve, confirmed
   *   via `BuiltinNormalizerRules.ts`'s `implicitMultiplyRule()`, which
   *   only inserts an implicit `*` for `NUMBER/RPAREN` immediately before
   *   `IDENT/LPAREN`, never for a bare `IDENT` immediately before
   *   `LPAREN`). Always commits to a CALL; an unregistered name produces a
   *   clear `UNDEFINED_FUNCTION` error at VM-execution time, the same
   *   forward-reference philosophy `LOAD_VAR`/`UNDEFINED_VARIABLE` already
   *   uses, rather than any parse-time registry lookup.
   * If the parens never balance, this falls through to the ordinary
   * `LOAD_VAR` path (a malformed expression surfaces its own parse error
   * shortly after, from the normal expression grammar).
   */
  private parseUserFunctionDefOrCall(nameToken: Token, builder: BytecodeBuilder): void {
    const closeIdx = this.findMatchingRParen(this.current);
    if (closeIdx === null) {
      builder.emitOpcode(OpCode.LOAD_VAR);
      builder.emitString(nameToken.value);
      return;
    }
    const afterClose = this.tokens[closeIdx + 1];
    if (afterClose?.type === TokenTypes.EQUALS) {
      this.parseUserFunctionDefinition(nameToken, builder);
    } else {
      this.parseUserFunctionCall(nameToken, builder);
    }
  }

  /**
   * A parameter name, accepted as either `IDENT` or `UNIT`, matches this
   * codebase's established `:name = value` variable-name policy
   * (`VariableParselet.ts` explicitly accepts `UNIT`-typed tokens too, e.g.
   * `:b = 5` for the "b" bits unit) since common short parameter names
   * like `h`/`l`/`b`/`t`/`s`/`m` collide with real unit abbreviations
   * (hour, liter, bits, ton, second, meter, ...) and lex as `UNIT`, not
   * `IDENT`.
   */
  private consumeParamName(): string {
    const token = this.peek();
    if (token?.type === TokenTypes.IDENT || token?.type === TokenTypes.UNIT) {
      this.consume();
      return token.value;
    }
    throw ErrorFactory.parsing({
      code: "USER_FUNCTION_INVALID_PARAM_NAME",
      message: `Expected a parameter name but got "${token?.type ?? "end of input"}"${token ? ` ("${token.value}")` : ""}`,
      context: { actualType: token?.type },
      span: token ? this.spanOf(token) : this.spanAtEnd(),
    });
  }

  private parseUserFunctionDefinition(nameToken: Token, builder: BytecodeBuilder): void {
    this.consume(TokenTypes.LPAREN);
    const params: string[] = [];
    if (this.peek()?.type !== TokenTypes.RPAREN) {
      params.push(this.consumeParamName());
      while (this.match(TokenTypes.COMMA)) {
        params.push(this.consumeParamName());
      }
    }
    this.consume(TokenTypes.RPAREN);
    this.consume(TokenTypes.EQUALS);

    if (params.length === 0) {
      throw ErrorFactory.parsing({
        code: "USER_FUNCTION_NO_PARAMS",
        message: `"${nameToken.value}()" has no parameters -- user-defined functions need at least one (a zero-argument definition is indistinguishable from a plain function CALL with no args, which this grammar doesn't otherwise support)`,
        context: { name: nameToken.value },
        span: this.spanOf(nameToken),
      });
    }

    // Compile the body into its OWN independent BytecodeBuilder, reusing
    // the SAME parser/token stream but directing emission elsewhere.
    // `parseExpression(minBp, _builder)` sets `this.builder = _builder`
    // with NO automatic restore, explicitly restoring via `setBuilder()`
    // afterward (not a `finally`, since a thrown parse error here should
    // propagate as-is; there's no further use of `this.builder` on that
    // path before the whole parse aborts) avoids silently emitting
    // whatever parses next (in this same expression, or, via
    // ExpressionEngine's builder pool, a LATER, unrelated line) into a
    // stale, already-.build()'d body builder.
    const bodyBuilder = new BytecodeBuilder(this.pluginFunctionIndex);
    this.parseExpression(BindingPower.Lowest, bodyBuilder);
    this.setBuilder(builder);

    const bodyProgram = bodyBuilder.build();
    if (bodyProgram.hasAsync) {
      // v1 scope decision: a function body calling an async plugin
      // (weather, stocks, currency, ...) isn't supported yet, propagating
      // a 'pending' result up through a reentrant executeBytecode() call
      // would need the OUTER expression's own bytecode position/stack
      // state to also be resumable later, which this first pass doesn't
      // implement. Rejecting at DEFINITION time (not call time) gives the
      // clearest possible error, matching this codebase's "never silently
      // pretend to support something it doesn't" convention (e.g.
      // addBusinessDays()'s own disclosed holiday-exclusion scope-down).
      throw ErrorFactory.parsing({
        code: "FUNCTION_BODY_MUST_BE_SYNCHRONOUS",
        message: `"${nameToken.value}(...)"'s body calls an async operation (weather, stocks, currency, ...) — user-defined function bodies must be synchronous`,
        context: { name: nameToken.value },
        span: this.spanOf(nameToken),
      });
    }

    const bodyIdx = builder.emitUserFunctionBody(nameToken.value, params, bodyProgram);
    builder.emitOpcode(OpCode.DEFINE_USER_FUNCTION);
    builder.emitIndex(bodyIdx);

    // A definition line has no single input value to echo back the way an
    // assignment does, push a plain confirmation string, matching this
    // codebase's "never silently produce a misleading numeric 0" principle.
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(`${nameToken.value}(${params.join(", ")}) defined`);
  }

  private parseUserFunctionCall(nameToken: Token, builder: BytecodeBuilder): void {
    this.consume(TokenTypes.LPAREN);
    let argCount = 0;
    if (this.peek()?.type !== TokenTypes.RPAREN) {
      this.parseExpression(BindingPower.Lowest, builder);
      argCount++;
      while (this.match(TokenTypes.COMMA)) {
        this.parseExpression(BindingPower.Lowest, builder);
        argCount++;
      }
    }
    this.consume(TokenTypes.RPAREN);

    builder.emitOpcode(OpCode.CALL_USER_FUNCTION);
    builder.emitString(nameToken.value);
    builder.emitByte(argCount);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Token stream navigation (identical API to Parser)
  // ═══════════════════════════════════════════════════════════════════════════════

  /** The source span of `token`: where an editor underlines the error. */
  private spanOf(token: Token): SourceSpan {
    return { start: token.offset, end: token.sourceEnd ?? token.offset + token.text.length, line: token.line, col: token.col };
  }

  /** An empty span just after the last token: where a line that stops short is pointed at. */
  private spanAtEnd(): SourceSpan {
    const last = this.tokens[this.tokens.length - 1];
    if (!last) return { start: 0, end: 0 };
    const end = last.sourceEnd ?? last.offset + last.text.length;
    return { start: end, end, line: last.line, col: last.col + (end - last.offset) };
  }

  consume(expectedType?: string): Token {
    const token = this.tokens[this.current];
    if (!token) {
      throw ErrorFactory.parsing({ code: "UNEXPECTED_END_OF_INPUT", message: "Unexpected end of input", span: this.spanAtEnd() });
    }
    if (expectedType !== undefined) {
      const expectedId = tokenTypeId(expectedType);
      if (token.typeId !== expectedId) {
        throw ErrorFactory.parsing({
          code: "UNEXPECTED_TOKEN_TYPE",
          message: `Expected token type "${expectedType}" but got "${token.type}" ("${token.value}")`,
          context: { expectedType, actualType: token.type, actualValue: token.value },
          span: this.spanOf(token),
        });
      }
    }
    this.current++;
    return token;
  }

  match(expectedType: string): boolean {
    const token = this.peek();
    if (token && token.typeId === tokenTypeId(expectedType)) {
      this.advance();
      return true;
    }
    return false;
  }

  peek(): Token | undefined {
    return this.tokens[this.current];
  }

  /**
   * Read-only lookahead `offset` tokens past the current position, without
   * consuming anything, `peekAt(0)` is equivalent to {@link peek}.
   * `this.tokens` is a plain in-memory array (not a stream), so this is a
   * simple, safe index read; no rewind/checkpoint mechanism is needed since
   * nothing is consumed.
   */
  peekAt(offset: number): Token | undefined {
    return this.tokens[this.current + offset];
  }

  previous(): Token | undefined {
    return this.current > 0 ? this.tokens[this.current - 1] : undefined;
  }

  private advance(): void {
    this.current++;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Builder access, set before parse, read by inline prefix handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  /** Set the builder to use for the current parse. Called by ExpressionEngine. */
  setBuilder(builder: BytecodeBuilder): void {
    this.builder = builder;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Diagnostics
  // ═══════════════════════════════════════════════════════════════════════════════

  private fireParseletMatched(
    parselet: { category: string },
    token: Token,
    isPrefix: boolean,
    bindingPower?: number
  ): void {
    const pipeline = this.diagnosticPipeline!;
    const event: DiagnosticEvent & { type: "parselet_matched" } = {
      type: DiagnosticEventType.ParseletMatched,
      elapsedNs: 0,
      expression: this.currentExpression,
      tokenType: token.type,
      tokenValue: token.value,
      parseletCategory: parselet.category,
      parseletType: parselet.constructor?.name ?? "unknown",
      isPrefix,
      bindingPower,
      tokenOffset: token.offset || 0,
    };
    pipeline.fireParseletMatched(event);
  }
}
