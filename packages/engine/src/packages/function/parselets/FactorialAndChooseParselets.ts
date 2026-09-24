import type { InfixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/** The `fact` builtin index; see VMBuiltins.ts. */
const FACT_BUILTIN = 62;

/** The `combination` builtin index; see VMBuiltins.ts. */
const COMBINATION_BUILTIN = 41;

/**
 * `5!`, the factorial written the way mathematics writes it: a postfix `!` on
 * the number, the same answer as `fact(5)`.
 *
 * Postfix, binding as tightly as `%` does, so it attaches to the number beside
 * it: `2^3!` is 2 to the power 6, and `-3!` is -(3!), both as in mathematics.
 * The exclamation mark had no other meaning in the language, so claiming it
 * takes nothing away (`!=` is its own token).
 */
export class FactorialParselet implements InfixParselet {
	readonly category = "Functions";
	readonly bindingPower = BindingPower.Postfix;

	parse(_parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(FACT_BUILTIN);
		builder.emitIndex(1);
	}
}

/**
 * `10 choose 3`, the number of ways to choose 3 things from 10 when order does
 * not matter: the same answer as `combination(10, 3)`. It binds like `*`, so
 * `10 choose 3 * 2` is `(10 choose 3) * 2`.
 */
export class ChooseParselet implements InfixParselet {
	readonly category = "Functions";
	readonly bindingPower = BindingPower.Product;

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Product + 1, builder);
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(COMBINATION_BUILTIN);
		builder.emitIndex(2);
	}
}
