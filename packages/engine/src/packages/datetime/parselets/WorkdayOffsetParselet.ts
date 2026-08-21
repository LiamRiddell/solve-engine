import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `N working/business days after|from|before <date>`, e.g. "5 working days
 * after 20 Dec" or "3 business days from today", the natural-language spelling
 * of a business-day offset.
 *
 * INFIX, not prefix: the count comes first in "5 working days after ...", so by
 * the time this runs the Pratt loop has already compiled `N` as the left
 * operand. Handles the fused `WORKDAYS_AFTER`/`WORKDAYS_BEFORE` tokens the
 * package's `phrases` field produces from the full three-word phrase (see
 * `DatetimePackage.ts`). Fusing the whole phrase (rather than claiming bare
 * "working"/"business") is what lets a note say "5 working parts" or
 * `:working = 5` untouched, the same reasoning MathPhrasesPackage.ts gives for
 * "average"/"total"; the fused phrase is also why the implicit-multiply rule
 * leaves the `N` in front of it alone (its guard skips phrase-start words).
 *
 * Emits `DATE_WORKDAY_OFFSET` with a one-byte direction, which walks the same
 * `addBusinessDays()` as `<date> + N workdays` (vm/VM.ts), so the two spellings
 * and the host holiday calendar can never disagree. "after"/"from" go forward,
 * "before" back; the anchor date is parsed at `Sum`, so a bare date term binds
 * as the anchor and any trailing `+ <duration>` applies to the offset result.
 */
export class WorkdayOffsetParselet implements InfixParselet {
  readonly category = "Date/Time";
  readonly bindingPower = BindingPower.Conditional;

  /** @param direction "forward" for after/from, "backward" for before. */
  constructor(private readonly direction: "forward" | "backward") {}

  parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
    parser.parseExpression(BindingPower.Sum, builder); // the anchor date
    builder.emitOpcode(OpCode.DATE_WORKDAY_OFFSET);
    builder.emitByte(this.direction === "backward" ? 1 : 0);
  }
}
