import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { isWorkdayUnit } from "@solve-js/uom/UomConverter";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * `<TimeUnit> until <Datetime>` / `<TimeUnit> since <Datetime>` (wiki:
 * Datetime, "days until 25/12/23", "1 year since 1/1/22"), the signed
 * elapsed span between now and a target datetime, expressed in the given
 * unit. "until" is positive for a future target ("count down to");
 * "since" is positive for a past target ("count up from").
 *
 * The fused token this parselet handles is produced by
 * {@link untilSinceNormalizerRule}, which merges a `UNIT` token followed by
 * `UNTIL`/`SINCE` into a single prefix token. This sidesteps the fact
 * that a bare `UNIT` token in prefix position is already claimed by
 * VariablesPackage's IdentifierParselet (`:days = 5`-style variable
 * lookups); fusing at the normalizer stage means that prefix dispatch
 * never sees a bare UNIT here at all, so there's no ParseletRegistry
 * collision between the two packages.
 *
 * Reuses the VM's existing Datetime-Datetime SUB semantics (which already
 * produce a `Uom("ms")` duration. See VM.ts's SUB case) plus
 * UOM_CONVERT_IN to convert that duration into the requested unit, instead
 * of introducing new opcodes.
 */
export class UntilSinceParselet implements PrefixParselet {
	readonly category = "Date/Time";
	constructor(private readonly direction: "until" | "since") {}

  parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    const unit = token.value; // the fused UNIT token's original text, e.g. "days"

    // A span in workdays would go through the 7/5 rate shim (5 workdays are 7
    // calendar days), which knows no weekends or holidays: `workdays until 25
    // December 2026` answered 64.58 on 25 September. The count lives in the
    // `between` form, which walks the calendar, so this spelling is refused
    // with a pointer to it rather than answered with the ratio.
    if (isWorkdayUnit(unit)) {
      throw ErrorFactory.parsing(
        "WORKDAYS_UNTIL_UNSUPPORTED",
        `"${unit} ${this.direction}" is not counted on the calendar. Write "workdays between today and <date>" for the count of working days.`,
      );
    }

    if (this.direction === "until") {
      parser.parseExpression(0, builder); // target datetime
      builder.emitOpcode(OpCode.DATE_NOW); // now
    } else {
      builder.emitOpcode(OpCode.DATE_NOW); // now
      parser.parseExpression(0, builder); // target datetime
    }
    // SUB pops (r, l) and computes l - r. Pushing [target, now] for
    // "until" makes SUB compute target - now (positive for a future
    // target). Pushing [now, target] for "since" makes SUB compute
    // now - target (positive for a past target).
    builder.emitOpcode(OpCode.SUB);

    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(unit);
    builder.emitOpcode(OpCode.UOM_CONVERT_IN);
  }
}
