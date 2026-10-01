import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { quoteToken } from "@solve-js/parser/ParseMessages";

// CALL_BUILTIN index. See VMBuiltins.ts for the inflationAdjust(amount
// fromYear, toYear) handler. Also reachable via the function-call form
// inflationAdjust(...) (FunctionCallParselet's builtinNameToIndex map).
const INFLATION_ADJUST_BUILTIN_IDX = 60;

/** Which leading phrase triggered this parselet. See FinancePackage.ts's `phrases` field. */
type InflationQueryVariant = "what-is" | "what-was";

/**
 * Whether the rest of the line actually spells an inflation query.
 *
 * "what is" is an ordinary way to open a question, and this parselet used to
 * claim every line that began with one: `what is 10% of 200` parsed the
 * amount, found "of" where it wanted a year, and threw `Expected "from
 * <year>"` at a question with nothing to do with inflation.
 *
 * Both grammars handled here are identified by a keyword further along the
 * line, so look for one before committing to them:
 *
 *   what is $X from <year>                FROM
 *   what is $X in <y1> worth in <y2>      WORTH_IN
 *   what was $X worth in <year>           WORTH_IN
 *
 * A bare IN is deliberately not enough by itself, because `what is 10% of 200
 * in euros` has one and is not an inflation query either.
 */
function hasInflationKeyword(parser: Parser): boolean {
  for (let offset = 0; ; offset++) {
    const token = parser.peekAt(offset);
    if (!token) return false;
    if (token.type === "FROM" || token.type === "WORTH_IN") return true;
  }
}

/**
 * Where the amount stops: above the conversion `in` (35), so the `in` of
 * `what is $X in <year> worth in <year>` is left for this parselet, and below
 * `*` and `/` (`Product`, 40), so `$100 * 2` is one amount. The amount used to
 * be read at `Product`, which stopped it at every `*`, the one the normaliser
 * puts inside `100 apples` included, and the reader was told it had found a
 * `"*"` they never typed.
 */
const AMOUNT_BINDING_POWER = BindingPower.Product - 1;

/**
 * The word an amount counts, when it is written `<number> <word>` straight
 * before the inflation keyword (`what is 100 apples from 1990`), or undefined.
 *
 * The normaliser reads a number beside a word as a multiplication and puts a
 * `*` between them at the word's own position, so the star a reader typed
 * (`100 * apples`, a variable) is told apart from the inserted one by where it
 * sits. A unit or a currency is not a word here: `100 kg` and `100 GBP` lex as
 * units and are judged by the index chooser.
 *
 * @param parser - Positioned on the amount.
 * @returns The counted word, or undefined.
 */
export function countedWord(parser: Parser): string | undefined {
  const number = parser.peekAt(0);
  const star = parser.peekAt(1);
  const word = parser.peekAt(2);
  const after = parser.peekAt(3);
  if (number?.type !== "NUMBER" || star?.type !== "STAR" || word?.type !== "IDENT") return undefined;
  if (star.offset !== word.offset) return undefined;
  if (after?.type !== "FROM" && after?.type !== "IN" && after?.type !== "WORTH_IN") return undefined;
  return String(word.value);
}

/**
 * Read the amount of an inflation query: one or more terms joined by `+` or
 * `-` (`$300 + $50`, `$100 * 2 - $20`), each read at
 * {@link AMOUNT_BINDING_POWER}, and their sum.
 *
 * The terms are joined here rather than by reading the amount at the
 * binding power of a sum, because a sum binds looser than the conversion
 * `in` (35), which would then swallow the `in` of `what is $X in <year> worth
 * in <year>`. Joining them by hand keeps that `in` for the query and still
 * reads the `+` the reader typed, which the query used to stop at and report
 * as the token it found. Nothing a query is written with follows its amount
 * with `+` or `-`: the year comes after `from`, `in` or `worth in`, so a sign
 * there can only belong to the amount.
 *
 * @param parser - Positioned on the amount.
 * @param builder - Receives the amount's bytecode, one value on the stack.
 */
export function parseInflationAmount(parser: Parser, builder: BytecodeBuilder): void {
  parser.parseExpression(AMOUNT_BINDING_POWER, builder);
  for (let next = parser.peek(); next?.type === "PLUS" || next?.type === "MINUS"; next = parser.peek()) {
    parser.consume();
    parser.parseExpression(AMOUNT_BINDING_POWER, builder);
    builder.emitOpcode(next.type === "PLUS" ? OpCode.ADD : OpCode.SUB);
  }
}

/**
 * `what is $X from <year>` -> X (given as that year's dollars) expressed
 * in present-day dollars; `what is $X in <year1> worth in <year2>` -> X
 * adjusted between two arbitrary (non-present) years; `what was $X worth
 * in <year>` -> X (given as present-day dollars) expressed in that year's
 * dollars.
 *
 * Fused on WHAT_IS/WHAT_WAS (see FinancePackage.ts's `phrases` field)
 * "is"/"was"/"what" are ordinary English words, not fused as bare
 * keywords, so a `:what = 5` style variable name is unaffected; only the
 * exact two-word phrases are claimed.
 *
 * NOT `definePhrasePattern`-based: the amount comes right after the fused
 * trigger, before any keyword to peek at. Same structural reason
 * `ClampParselet`/`CompoundInterestParselet` are hand-written.
 *
 * BINDING-POWER GUARD (why the amount parses at `AMOUNT_BINDING_POWER`,
 * not `Lowest`): the "what is ... in <year1> worth in <year2>" branch has
 * a bare `IN` token directly after the amount. The currency package's
 * `InParselet` is a generic infix parselet registered on `IN`
 * (bindingPower 35) that fires unconditionally as soon as it's the next
 * lookahead token inside ANY sub-expression parse, including one this
 * parselet kicks off for the amount, even when the token after `IN`
 * isn't a valid conversion target, it still consumes `IN` and silently
 * no-ops, stranding the rest of the grammar. Parsing the amount at
 * `AMOUNT_BINDING_POWER` (39) makes the Pratt loop's `bp <= minBp` check
 * block `IN` (35 <= 39) from ever being consumed there, leaving it for
 * this parselet to consume explicitly, while `*` and `/` (40) still are.
 * A top-level `+` or `-` in the amount (`what is $300 + $50 from 2003`) is
 * joined by {@link parseInflationAmount}, term by term at the same guarded
 * binding power, so the `in` stays blocked. The "what was ... worth in"
 * branch has no such collision (the next token is the fused WORTH_IN,
 * which has no infix parselet registered at all), but reads its amount the
 * same way for consistency between both variants of this class.
 */
export class InflationQueryParselet implements PrefixParselet {
  readonly category = "Finance";

  constructor(private readonly variant: InflationQueryVariant) {}

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    if (!hasInflationKeyword(parser)) {
      // Not an inflation query, "what is" was just how the question opened.
      // Read what follows as the ordinary expression it is, at `Lowest`, so
      // the amount-guard binding power below does not truncate it either.
      parser.parseExpression(BindingPower.Lowest, builder);
      return;
    }

    // `what is 100 apples from 1990`: a count of something no index measures.
    // The refusal stands in for the amount, as `100 kg`'s does, so the line
    // answers with it rather than with the word read as a missing variable.
    const counted = countedWord(parser);
    if (counted !== undefined) {
      parser.consume("NUMBER");
      parser.consume("STAR");
      parser.consume("IDENT");
      builder.emitOpcode(OpCode.PUSH_STRING);
      builder.emitString(counted);
      builder.emitPluginCall("inflationCountedAmount", 1);
    } else {
      parseInflationAmount(parser, builder);
    }

    if (this.variant === "what-was") {
      parser.consume("WORTH_IN");
      parser.parseExpression(BindingPower.Lowest, builder); // toYear
      builder.emitPluginCall("inflationToYearFromPresent", 2);
      return;
    }

    const next = parser.peek();
    if (next?.type === "FROM") {
      parser.consume();
      parser.parseExpression(BindingPower.Lowest, builder); // fromYear
      builder.emitPluginCall("inflationFromYearToPresent", 2);
      return;
    }
    if (next?.type === "IN") {
      parser.consume();
      parser.parseExpression(BindingPower.Lowest, builder); // fromYear (year1)
      parser.consume("WORTH_IN");
      parser.parseExpression(BindingPower.Lowest, builder); // toYear (year2)
      builder.emitOpcode(OpCode.CALL_BUILTIN);
      builder.emitIndex(INFLATION_ADJUST_BUILTIN_IDX);
      builder.emitIndex(3);
      return;
    }

    // What the reader typed, not the parser's name for it (#768).
    const got = next ? `found ${quoteToken(next)}` : "the line ends";
    throw ErrorFactory.parsing(
      "INFLATION_EXPECTED_FROM_OR_IN",
      `Expected "from <year>" or "in <year> worth in <year>" after "what is <amount>", but ${got}`,
    );
  }
}
