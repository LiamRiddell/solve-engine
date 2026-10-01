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
export type InflationQueryVariant = "what-is" | "what-was";

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
 * Where a year stops: one factor, before any `*`, `/`, `+`, `-` or conversion
 * `in`. A number, a name, a bracketed expression, a call or a power
 * (`2^11`) is a year; an operator that joins factors is not part of it.
 *
 * The year used to be read at `Lowest`, to the end of the line, so `what is
 * $100 from 1990 + $5` added the money to the year and answered for 1995. Read
 * as one factor, the year is 1990 and the `+ $5` is left to the line, which
 * adds it to the answer, as `$100 in 1990 dollars + $5` and `5 km in m + 3 m`
 * add theirs. A year worked out from a sum is written in brackets: `from
 * (1990 + 5)`.
 */
const YEAR_BINDING_POWER = BindingPower.Product;

/**
 * Read the year of an inflation question: one factor at
 * {@link YEAR_BINDING_POWER}. Whether its value is a year (a plain whole
 * number) is decided when the line runs, by `inflationYear`, since a name or
 * a call has no value until then.
 *
 * @param parser - Positioned on the year.
 * @param builder - Receives the year's bytecode, one value on the stack.
 */
export function parseInflationYear(parser: Parser, builder: BytecodeBuilder): void {
  parser.parseExpression(YEAR_BINDING_POWER, builder);
}

/**
 * The refusal for an inflation question whose amount is followed by neither
 * `from` nor `in`, in the reader's words: the two shapes, and the word that
 * stands where the keyword goes. An `and` between amounts is pointed at the
 * plus sign, which the amount reads (see {@link parseInflationAmount}).
 *
 * @param next - The token after the amount, or undefined at the end of the line.
 * @param variant - Which question it is: `what was` has the one shape, `worth in`.
 * @returns The sentence the reader sees.
 */
export function fromOrInRefusal(next: Token | undefined, variant: InflationQueryVariant = "what-is"): string {
  const shapes = variant === "what-was"
    ? `an inflation question names its year straight after the amount, as in what was $300 worth in 1965`
    : `an inflation question names its year straight after the amount, as in what is $300 from 2003 or what is $300 in 1990 worth in 2010`;
  if (!next) return `${shapes}, and here the line ends after the amount`;
  const andHint = String(next.value).toLowerCase() === "and"
    ? `: to adjust a total, join the amounts with a plus sign, as in ${variant === "what-was" ? "what was $300 + $50 worth in 1965" : "what is $300 + $50 from 2003"}`
    : "";
  return `${shapes}, and here ${quoteToken(next)} comes after the amount${andHint}`;
}

/**
 * The refusal for `what is <amount> in <year>` followed by something other
 * than `worth in`: most often a sum written as the first year, which is one
 * factor (see {@link YEAR_BINDING_POWER}).
 *
 * @param next - The token after the first year, or undefined at the end of the line.
 * @returns The sentence the reader sees.
 */
export function worthInRefusal(next: Token | undefined): string {
  const shape = `an inflation question between two years reads what is <amount> in <year> worth in <year>`;
  const found = next ? `${quoteToken(next)} comes after the first year` : "the line ends after the first year";
  return `${shape}, and here ${found}: a year is one number or name, so a year worked out goes in brackets, as in (1990 + 5)`;
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
 *
 * Each year is one factor ({@link YEAR_BINDING_POWER}), so an operator after
 * the last year applies to the answer (`what is $100 from 1990 + $5` is the
 * answer plus $5), and the VM refuses a year that is not a plain whole number
 * (`inflationYear`), as it refuses an amount no index measures.
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

    // Each year is one factor (see YEAR_BINDING_POWER): what follows it is the
    // line's, so `what is $100 from 1990 + $5` adds $5 to the answer.
    if (this.variant === "what-was") {
      if (parser.peek()?.type !== "WORTH_IN") throw ErrorFactory.parsing("INFLATION_EXPECTED_FROM_OR_IN", fromOrInRefusal(parser.peek(), "what-was"));
      parser.consume("WORTH_IN");
      parseInflationYear(parser, builder); // toYear
      builder.emitPluginCall("inflationToYearFromPresent", 2);
      return;
    }

    const next = parser.peek();
    if (next?.type === "FROM") {
      parser.consume();
      parseInflationYear(parser, builder); // fromYear
      builder.emitPluginCall("inflationFromYearToPresent", 2);
      return;
    }
    if (next?.type === "IN") {
      parser.consume();
      parseInflationYear(parser, builder); // fromYear (year1)
      if (parser.peek()?.type !== "WORTH_IN") throw ErrorFactory.parsing("INFLATION_EXPECTED_FROM_OR_IN", worthInRefusal(parser.peek()));
      parser.consume("WORTH_IN");
      parseInflationYear(parser, builder); // toYear (year2)
      builder.emitOpcode(OpCode.CALL_BUILTIN);
      builder.emitIndex(INFLATION_ADJUST_BUILTIN_IDX);
      builder.emitIndex(3);
      return;
    }

    // What the reader typed, not the parser's name for it (#768).
    throw ErrorFactory.parsing("INFLATION_EXPECTED_FROM_OR_IN", fromOrInRefusal(next));
  }
}
