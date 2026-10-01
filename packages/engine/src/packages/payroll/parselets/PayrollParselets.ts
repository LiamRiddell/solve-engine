import { PrefixParselet, InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { OpCode } from "@solve-js/parser/OpCode";
import { emitBuiltinPluginCall } from "@solve-js/packages/SynchronousPluginFunctions";

/**
 * Consumes the `PAYROLL_CASE` clauses after a take-home form (`in Scotland`,
 * `with plan 2 student loan`, `with 5% pension`, see
 * `PayrollCaseNormalizerRule`) and emits the call: with one argument when
 * there are none, so a plain line compiles as it always did, and with the
 * clauses joined as a second argument when there are.
 */
function emitWithCase(parser: Parser, builder: BytecodeBuilder, fn: string): void {
	const clauses: string[] = [];
	while (parser.peek()?.type === "PAYROLL_CASE") clauses.push(parser.consume().value ?? "");
	if (clauses.length === 0) {
		emitBuiltinPluginCall(builder, fn, 1);
		return;
	}
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(clauses.join("|"));
	emitBuiltinPluginCall(builder, fn, 2);
}

/**
 * The prefix payroll forms, `take home on <salary>` and `hourly for <salary>`.
 * Parses the whole amount after the phrase (a figure, or an arithmetic
 * expression that produces one) and calls the named plugin, with any case
 * clauses written after the amount.
 */
export class PayrollPrefixParselet implements PrefixParselet {
	readonly category = "Payroll";
	constructor(private readonly fn: string) {}

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Lowest, builder);
		emitWithCase(parser, builder, this.fn);
	}
}

/**
 * How tightly the postfix payroll forms hold the amount before them: one step
 * above a comparison, below a sum.
 *
 * Below `Sum`, so the whole preceding sum is the salary: `50000 + 2000 after
 * tax` is `(50000 + 2000)` taken after tax. Above `Conditional`, so a
 * comparison is not: `£50,000 after tax > £30,000` compares the take-home with
 * £30,000, and inside `check`, which reads each side at the comparison's own
 * power, the phrase used to stop the left side short and the check refused the
 * line for having no comparison. At the comparison's own power the right side
 * of `x == £50,000 after tax` stopped short the same way, and the phrase took
 * the whole comparison as its salary.
 */
export const PAYROLL_POSTFIX_BINDING_POWER = BindingPower.Conditional + 1;

/**
 * The postfix payroll forms, `<salary> after tax` and `<salary> per month after
 * tax`. The salary is the left side, already parsed; this consumes no operand
 * of its own, it just applies the named plugin to what came before, with any
 * case clauses written after the phrase.
 *
 * The binding power, {@link PAYROLL_POSTFIX_BINDING_POWER}, sits below `Sum`
 * and above a comparison, so the preceding sum is the salary (`50000 + 2000
 * after tax` is `(50000 + 2000)` taken after tax) and a comparison beside it
 * is not.
 */
export class PayrollPostfixParselet implements InfixParselet {
	readonly category = "Payroll";
	readonly bindingPower = PAYROLL_POSTFIX_BINDING_POWER;
	constructor(private readonly fn: string) {}

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		emitWithCase(parser, builder, this.fn);
	}
}

/**
 * `<amount> after 20% tax`: take-home at a rate the line states.
 *
 * The rate rides on the fused token (see `AfterRateNormalizerRule`), so this
 * pushes it beside the amount already on the stack and calls the plugin with
 * both. Same binding power as the banded form, so the preceding sum is
 * the amount and a comparison beside it is not.
 */
export class PayrollRateParselet implements InfixParselet {
	readonly category = "Payroll";
	readonly bindingPower = PAYROLL_POSTFIX_BINDING_POWER;
	constructor(private readonly fn: string) {}

	parse(_parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(Number(token.value));
		emitBuiltinPluginCall(builder, this.fn, 2);
	}
}
