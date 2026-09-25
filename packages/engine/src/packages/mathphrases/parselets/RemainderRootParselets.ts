import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * `remainder of <x> divided by <y>`.
 *
 * The words have to be intercepted rather than parsed as an ordinary
 * expression: `21 divided by 5` already means 4.2, and the remainder is a
 * different operation on the same two numbers. So this consumes the
 * `divided by` itself and emits MOD instead of DIV.
 *
 * The left operand is parsed at `Product`, which is where `divided by` binds,
 * so it stops there rather than performing the division this exists to avoid.
 */
export const remainderOfParselet: PrefixParselet = {
	category: "MathPhrases",
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Product, builder); // dividend
		if (!parser.match("DIVIDE_BY") && !parser.match("SLASH")) {
			throw ErrorFactory.parsing(
				"REMAINDER_EXPECTED_DIVIDED_BY",
				'Expected "divided by" or "/", as in "remainder of 21 divided by 5"',
			);
		}
		parser.parseExpression(BindingPower.Product, builder); // divisor
		builder.emitOpcode(OpCode.MOD);
	},
};

/**
 * `root <n> of <x>`, the nth root.
 *
 * `square root of` and `cube root of` cover the two common cases as fixed
 * phrases; this is the general one, where the degree is written as a number.
 * Emitted as `x ^ (1/n)` rather than through a builtin, because that is
 * exactly what an nth root is and the exponent opcode already exists.
 */
export const nthRootParselet: PrefixParselet = {
	category: "MathPhrases",
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Product, builder); // degree
		if (!parser.match("OF")) {
			throw ErrorFactory.parsing(
				"ROOT_EXPECTED_OF",
				'Expected "of", as in "root 5 of 100"',
			);
		}
		parser.parseExpression(BindingPower.Conditional, builder); // radicand

		// stack: degree, radicand. Wanted: radicand ^ (1 / degree).
		builder.emitOpcode(OpCode.SWAP); // radicand, degree
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(1);
		builder.emitOpcode(OpCode.SWAP); // radicand, 1, degree
		builder.emitOpcode(OpCode.DIV); // radicand, 1/degree
		builder.emitOpcode(OpCode.EXP);
	},
};

/**
 * `log <x> base <n>`, the logarithm to an arbitrary base.
 *
 * `log` is already a FUNC, so `log(20)` goes through the ordinary call path
 * and this cannot. The trigger is the fused phrase `log ... base`, produced by
 * {@link logBaseNormalizerRule}, which is what keeps `log(20)` working
 * untouched.
 *
 * Computed by one builtin that takes both, so the common bases are exact:
 * `log 1000 base 10` is 3, where the change of base `ln(x) / ln(n)` it used to
 * emit came out as 2.9999999999999996 (#667).
 */
export const logBaseParselet: PrefixParselet = {
	category: "MathPhrases",
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Conditional, builder); // x
		if (!parser.match("LOG_BASE")) {
			throw ErrorFactory.parsing(
				"LOG_EXPECTED_BASE",
				'Expected "base", as in "log 20 base 4"',
			);
		}
		parser.parseExpression(BindingPower.Conditional, builder); // n
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(LOG_BASE_BUILTIN);
		builder.emitIndex(2);
	},
};

/** `log <x> base <n>` in VMBuiltins.ts. */
const LOG_BASE_BUILTIN = 114;
