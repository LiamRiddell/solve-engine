import { PrefixParselet, InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * The prefix payroll forms, `take home on <salary>` and `hourly for <salary>`.
 * Parses the whole amount after the phrase (a figure, or an arithmetic
 * expression that produces one) and calls the named plugin.
 */
export class PayrollPrefixParselet implements PrefixParselet {
	readonly category = "Payroll";
	constructor(private readonly fn: string) {}

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Lowest, builder);
		builder.emitPluginCall(this.fn, 1);
	}
}

/**
 * The postfix payroll forms, `<salary> after tax` and `<salary> per month after
 * tax`. The salary is the left side, already parsed; this consumes no operand
 * of its own, it just applies the named plugin to what came before.
 *
 * The binding power sits below `Sum`, so the whole preceding expression is the
 * salary: `50000 + 2000 after tax` is `(50000 + 2000)` taken after tax, not
 * `50000 + (2000 after tax)`.
 */
export class PayrollPostfixParselet implements InfixParselet {
	readonly category = "Payroll";
	readonly bindingPower = BindingPower.Conditional;
	constructor(private readonly fn: string) {}

	parse(_parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		builder.emitPluginCall(this.fn, 1);
	}
}

/**
 * `<amount> after 20% tax`: take-home at a rate the line states.
 *
 * The rate rides on the fused token (see `AfterRateNormalizerRule`), so this
 * pushes it beside the amount already on the stack and calls the plugin with
 * both. Same binding power as the banded form, so the whole preceding
 * expression is the amount.
 */
export class PayrollRateParselet implements InfixParselet {
	readonly category = "Payroll";
	readonly bindingPower = BindingPower.Conditional;
	constructor(private readonly fn: string) {}

	parse(_parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(Number(token.value));
		builder.emitPluginCall(this.fn, 2);
	}
}
