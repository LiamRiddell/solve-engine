import { PrefixParselet, InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * Soulver's documented investment grammar.
 *
 * `CompoundInterestParselet` already covers the maths, but only through this
 * package's own `compound interest on X over Y years at Z%` phrasing, and its
 * doc comment said so: the documented spellings are `$1,000 after 3 years at
 * 7%` and `$1,000 for 3 years at 7% compounding monthly`, with no leading verb
 * at all. Those are the forms anyone reading Soulver's documentation will type,
 * and none of them parsed. This file adds them, alongside the return-on-
 * investment and present-value phrases from the same page.
 *
 * The older `over` spelling still works. Nothing that parsed before stops.
 */

/** How many times a year each documented interval compounds. */
const PERIODS_PER_YEAR: Record<string, number> = {
	annually: 1,
	yearly: 1,
	// Semi-annual is not on Soulver's page, but it is the one interval a
	// reader of the other four would expect to exist, and leaving it out makes
	// the set look arbitrary rather than deliberate.
	"semi-annually": 2,
	quarterly: 4,
	monthly: 12,
	fortnightly: 26,
	weekly: 52,
	daily: 365,
};

/**
 * Consumes an optional `compounding <interval>` tail.
 *
 * @param parser - The parser positioned after the rate.
 * @returns Periods per year, or 1 when no interval was given, which is the
 * annual compounding the bare form already meant.
 */
export function readCompoundingInterval(parser: Parser): number {
	if (!parser.match("COMPOUNDING")) return 1;
	const token = parser.peek();
	const name = (token?.text ?? token?.value ?? "").toLowerCase();
	const periods = PERIODS_PER_YEAR[name];
	if (periods === undefined) {
		// Naming the accepted set beats "unexpected token": the whole point of
		// this phrase is that it is written in words, so a typo is the likely
		// failure and the fix should be visible in the message.
		throw ErrorFactory.parsing(
			"UNKNOWN_COMPOUNDING_INTERVAL",
			`compounding ${name || "?"}: expected one of ${Object.keys(PERIODS_PER_YEAR).join(", ")}`,
		);
	}
	parser.consume();
	return periods;
}

/**
 * `<principal> after <years> years at <rate>%` and the `for ... compounding
 * <interval>` variant, as an infix on the pivot word.
 *
 * Infix rather than prefix because the principal comes first and there is no
 * leading keyword to trigger on, which is the same structural reason
 * `PercentageChangeParselet` hangs off `to` rather than off the number.
 *
 * Binding power is `Conditional`, below arithmetic, so the principal is a whole
 * expression: `$500 + $500 after 3 years at 7%` compounds the thousand rather
 * than only the second five hundred.
 */
export class InvestmentGrowthParselet implements InfixParselet {
	readonly category = "Finance";
	readonly bindingPower = BindingPower.Conditional;

	/**
	 * @param annualIndex - Builtin for the annual case, so the common form
	 * keeps using the same code path (and the same rounding) it always did.
	 * @param intervalIndex - Builtin taking an explicit periods-per-year.
	 */
	constructor(
		private readonly annualIndex: number,
		private readonly intervalIndex: number,
	) {}

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		// The principal is already on the stack: this is an infix.
		parser.parseExpression(BindingPower.Conditional, builder); // years
		if (!parser.match("RATE_AT")) parser.consume("AT");
		parser.parseExpression(BindingPower.Conditional, builder); // rate
		const periods = readCompoundingInterval(parser);

		// [principal, years, rate] -> [principal, rate, years], matching the
		// builtins' (principal, rate, years) order. Same SWAP as
		// CompoundInterestParselet, for the same reason.
		builder.emitOpcode(OpCode.SWAP);

		if (periods === 1) {
			builder.emitOpcode(OpCode.CALL_BUILTIN);
			builder.emitIndex(this.annualIndex);
			builder.emitIndex(3);
			return;
		}
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(periods);
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(this.intervalIndex);
		builder.emitIndex(4);
	}
}

/**
 * `present value of <amount> after <years> years at <rate>%`.
 *
 * What a sum promised in the future is worth today, the inverse of compound
 * growth. Triggered on the fused `PRESENT_VALUE_OF` phrase rather than a bare
 * "present"/"value" keyword, for the reason this package fuses every other
 * trigger: both are ordinary words someone might use as a variable name.
 */
export class PresentValueParselet implements PrefixParselet {
	readonly category = "Finance";

	constructor(private readonly builtinIndex: number) {}

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Conditional, builder); // future value
		// `after` is the documented pivot; `over` and `in` are accepted because
		// this reads as English and all three are natural here.
		if (!parser.match("AFTER") && !parser.match("OVER") && !parser.match("IN")) {
			parser.consume("AFTER");
		}
		parser.parseExpression(BindingPower.Conditional, builder); // years
		if (!parser.match("RATE_AT")) parser.consume("AT");
		parser.parseExpression(BindingPower.Conditional, builder); // rate

		builder.emitOpcode(OpCode.SWAP);
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(this.builtinIndex);
		builder.emitIndex(3);
	}
}

/**
 * `<invested> invested <returned> returned`, the return on the investment.
 *
 * `$500 invested $1,500 returned` is 2x, not 3x: ROI measures the profit
 * against the cost, so doubling your money is a 1x return and tripling it is
 * 2x. Worth stating because "3x" is what the money multiple would be, and the
 * two get confused; `$1,500 / $500` gives that instead.
 *
 * Infix on `invested`, so the amount invested is the left operand.
 */
export class ReturnOnInvestmentParselet implements InfixParselet {
	readonly category = "Finance";
	readonly bindingPower = BindingPower.Conditional;

	constructor(private readonly builtinIndex: number) {}

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Conditional, builder); // returned
		parser.consume("RETURNED");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(this.builtinIndex);
		builder.emitIndex(2);
	}
}

/**
 * `annual return on <invested> invested <returned> returned after <years> years`.
 *
 * The compound annual growth rate: the constant yearly rate that turns the one
 * into the other. Returned as a percentage, so it renders "13.99%".
 */
export class AnnualReturnParselet implements PrefixParselet {
	readonly category = "Finance";

	constructor(private readonly builtinIndex: number) {}

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Conditional, builder); // invested
		parser.consume("INVESTED");
		parser.parseExpression(BindingPower.Conditional, builder); // returned
		parser.consume("RETURNED");
		if (!parser.match("AFTER") && !parser.match("OVER") && !parser.match("IN")) {
			parser.consume("AFTER");
		}
		parser.parseExpression(BindingPower.Conditional, builder); // years

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(this.builtinIndex);
		builder.emitIndex(3);
	}
}
