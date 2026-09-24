import { Parser } from "@solve-js/parser/Parser";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/** Whether the next token is the bare word `on` that opens an `on <date>` clause. A pure look. */
export function nextIsOnClause(parser: Parser): boolean {
  const next = parser.peek();
  return next?.type === "IDENT" && next.value.toLowerCase() === "on";
}

/**
 * Consume an `on <date>` clause if one is next, emitting the date's bytecode,
 * and say whether it was there.
 *
 * The timezone forms that read a wall clock need a calendar day to read it on,
 * because the gap between two zones changes with daylight saving: 3pm in
 * London is 10am in New York in September and 11am for three weeks in March.
 * Without the clause a form reads today, which is what makes its answer move
 * with the calendar; with it the answer is fixed, and a reader can ask about
 * the day the meeting is actually on.
 *
 * `on` is a bare word, not a keyword, so it is matched by its text the way
 * `age of <date> on <date>` matches it (see `AgeParselet.ts`). The date is
 * parsed at `Postfix` binding for the same reason as there: it stops the
 * parse at the `in` and the `and` that can follow, so `on 23 September 2026 in
 * Tokyo` leaves `in Tokyo` for the caller rather than handing it to the
 * unit-conversion operator. Any expression that yields a date works, `today`
 * and `next Friday` included; one that yields something else is refused by
 * the plugin function that receives it, never by guessing here.
 */
export function tryParseOnDate(parser: Parser, builder: BytecodeBuilder): boolean {
  if (!nextIsOnClause(parser)) return false;
  parser.consume();
  // An `on` with nothing after it, or with the `in` straight after, has lost
  // its date; said here rather than as the parser's complaint about the `in`.
  const next = parser.peek();
  if (next === undefined || next.type === "IN") {
    throw ErrorFactory.parsing(
      "TIME_ZONE_MISSING_DATE",
      `Expected a date after "on", as in "3pm London on 23 September 2026 in Tokyo"`,
    );
  }
  parser.parseExpression(BindingPower.Postfix, builder);
  return true;
}
