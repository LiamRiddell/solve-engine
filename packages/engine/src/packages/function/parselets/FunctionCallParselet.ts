import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * Exported so `packages/mapreduce/`'s parselets can resolve a bare
 * function-name argument (`map(cos, ...)`) to its builtin index AT PARSE
 * TIME, the same map this file's own `FunctionCallParselet` uses for
 * ordinary `sqrt(x)`-style calls. A name NOT found here is deferred to
 * runtime as a possible user-defined-function reference instead (resolved
 * dynamically via `vm.getUserFunction()`, mirroring `CALL_USER_FUNCTION`'s
 * own forward-reference philosophy). See `MapParselet`/`ReduceParselet`.
 */
export const builtinNameToIndex: Record<string, number> = {
  sqrt: 0, abs: 1, sin: 2, cos: 3, tan: 4, log: 5,
  ceil: 6, floor: 7, round: 8, min: 9, max: 10,
  // ln is log: this engine's `log` is Math.log, the natural logarithm, and
  // `ln` is the more usual spelling for it. Same index, not a second function.
  ln: 5,
  asin: 11, acos: 12, atan: 13, atan2: 14,
  // Long-form trig-function-inverse aliases (Numi/older-calculator naming
  // convention) -- same indices as their short forms above, not a separate
  // implementation.
  arcsin: 11, arccos: 12, arctan: 13,
  sinh: 15, cosh: 16, tanh: 17,
  asinh: 18, acosh: 19, atanh: 20,
  cbrt: 21, clz32: 22, expm1: 23, exp: 24,
  fround: 25, hypot: 26, imul: 27,
  log10: 28, log1p: 29, log2: 30,
  pow: 31, random: 32, sign: 33, trunc: 34,
  degtorad: 35, radtodeg: 36,
  // 37 is "roll" (dice), emitted directly by the Dice package, not routed
  // through this name map.
  gcd: 38, lcm: 39, permutation: 40, combination: 41,
  // 42-46 (average/median/total/count/proportion) are emitted directly by
  // the MathPhrases package's own phrase parselets, not routed through
  // this name map either.
  // 47 (clamp) is emitted via the CLAMP keyword's dedicated parselet.
  hex: 48, bin: 49, int: 50,
  // Finance (packages/finance/) function-call forms. See VMBuiltins.ts
  // indices 51-59 for the implementations. The phrase-grammar forms
  // ("compound interest on ...", "monthly repayment on ...", "tax on ...")
  // are hand-written parselets in packages/finance/parselets/, not routed
  // through this name map. See FinancePackage.ts.
  compoundinterest: 51, interestearned: 52,
  compoundinterestrate: 53, compoundinterestyears: 54,
  loanrepayment: 55, loaninterest: 56, monthlypayment: 57,
  taxadd: 58, taxremove: 59,
  // Inflation-adjusted value (packages/finance/) -- see VMBuiltins.ts
  // index 60. The present-year-relative phrase forms and the flat-rate
  // future-value projection are pluginFunctions instead, not reachable
  // via this map -- see InflationPluginFunctions.ts.
  inflationadjust: 60,
  // root(n, x) -- the n-th root of x. cbrt(x) above already covers n=3
  // specifically; this is the general form (Numi: `root n (x)`).
  root: 61,
  // fact(n) / factorial(n) -- both names accepted, same implementation.
  fact: 62, factorial: 62,
  // Matrix (packages/matrix/) -- transpose/det/inv/dot. Also reachable via
  // operator syntax (`^T`, `^-1` -- PrecedenceParser.ts's CARET special-
  // casing emits these SAME indices) and `|a|` (abs()'s Matrix branch,
  // index 1 above) -- see VMBuiltins.ts's own comment on indices 63-66.
  transpose: 63, det: 64, inv: 65, dot: 66,
};

/**
 * Functions whose bare prefix form takes a base or degree before the value.
 *
 * `root 2 (8)` and `log 2 (10)` read as "the 2nd root of 8" and "the log base 2
 * of 10", so the parenthesised group after the first argument is a second
 * argument rather than a multiplication.
 *
 * Restricted to these two on purpose. `6 (3)` is 18 in this grammar, so a
 * parenthesised group following a value normally multiplies, and treating it as
 * an argument everywhere would turn `sqrt 16 (3)` into a two-argument `sqrt`
 * instead of `4 * 3`.
 */
const PREFIX_TWO_ARG_FUNCTIONS: ReadonlySet<string> = new Set(["root", "log"]);

/**
 * A named function call, with or without parentheses.
 *
 * `sqrt(16)` and `sqrt 16` are the same call. The bare form is what a person
 * writes on paper and what every calculator notepad in this category accepts,
 * and it costs nothing here because the name is already a reserved `FUNC`
 * token: there is no variable it could be confused with.
 *
 * The argument of a bare call is parsed at prefix binding power, which is what
 * makes `sqrt 16 + 9` seven rather than five. The function binds to the value
 * next to it and nothing further.
 *
 * Resolves the name to a builtin index at parse time rather than dispatching on
 * a string at run time, which is also why the name-to-index map is exported:
 * map and reduce need the same resolution for a bare function argument.
 */
export class FunctionCallParselet implements PrefixParselet {
	readonly category = "Function";
	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    const fnName = token.value.toLowerCase();
    const fnIdx = builtinNameToIndex[fnName];
    if (fnIdx === undefined) {
      throw ErrorFactory.execution(
        'UNKNOWN_FUNCTION',
        `Unknown function: ${fnName}`,
        { functionName: fnName }
      );
    }

    const argCount = parser.peek()?.type === "LPAREN"
      ? this.parseParenthesised(parser, builder)
      : this.parseBare(parser, builder, fnName);

    builder.emitOpcode(OpCode.CALL_BUILTIN);
    builder.emitIndex(fnIdx);
    builder.emitIndex(argCount);
  }

  /** `fn(a, b)`. Arguments are comma-separated and the list may be empty. */
  private parseParenthesised(parser: Parser, builder: BytecodeBuilder): number {
    parser.consume("LPAREN");

    let argCount = 0;
    if (parser.peek()?.type !== "RPAREN") {
      parser.parseExpression(BindingPower.Lowest, builder);
      argCount++;
      while (parser.match("COMMA")) {
        parser.parseExpression(BindingPower.Lowest, builder);
        argCount++;
      }
    }

    parser.consume("RPAREN");
    return argCount;
  }

  /**
   * `fn x`, and `fn n (x)` for the two functions that take a base.
   *
   * Parsed at {@link BindingPower.Prefix} so the call takes the value beside it
   * and stops: `sqrt 16 + 9` is seven, and `sin 45deg` still absorbs the unit,
   * because a unit suffix binds tighter than a prefix.
   */
  private parseBare(parser: Parser, builder: BytecodeBuilder, fnName: string): number {
    parser.parseExpression(BindingPower.Prefix, builder);

    if (PREFIX_TWO_ARG_FUNCTIONS.has(fnName) && this.atImplicitGroup(parser)) {
      // Step over the STAR the normalizer inserted, then take the group.
      parser.consume("STAR");
      parser.consume("LPAREN");
      parser.parseExpression(BindingPower.Lowest, builder);
      parser.consume("RPAREN");
      return 2;
    }
    return 1;
  }

  /**
   * Whether what follows is a parenthesised group written directly against the
   * previous value, as the `(8)` in `root 2 (8)`.
   *
   * By the time a parselet sees them there is no bare `(` there: the implicit
   * multiplication rule has already inserted a STAR, so `2 (8)` and `2 * (8)`
   * arrive as the same three tokens. They are told apart by position. The
   * inserted STAR is given the offset of the token it precedes, so it sits
   * exactly where the `(` does, while a typed `*` occupies a column of its own.
   *
   * That distinction is the whole point: `log 2 (10)` is a logarithm to base 2,
   * and `log 2 * (10)` is a natural log multiplied by ten, and a user who typed
   * the second should not silently get the first.
   */
  private atImplicitGroup(parser: Parser): boolean {
    const star = parser.peek();
    if (star?.type !== "STAR") return false;

    const group = parser.peekAt(1);
    if (group?.type !== "LPAREN") return false;

    return star.offset === group.offset;
  }
}
