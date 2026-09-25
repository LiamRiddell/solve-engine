import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * The call a fused `AGGREGATE_CALL` compiles to (see
 * `AggregateCallNormalizerRule`): `sum(1, 2, 3)` is `total of 1, 2, 3`.
 *
 * `stdev(...)` is the population form, as `stdev of` and `standard deviation
 * of` are in this engine. A spreadsheet's `STDEV` is the sample form, which is
 * written here as `sample stdev of`.
 */
export class AggregateCallParselet implements PrefixParselet {
	readonly category = "MathPhrases";

	constructor(private readonly builtins: Readonly<Record<string, number>>) {}

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const name = String(token.value);
		const builtin = this.builtins[name];
		parser.consume("LPAREN");
		let argCount = 0;
		if (parser.peek()?.type !== "RPAREN") {
			parser.parseExpression(BindingPower.Lowest, builder);
			argCount++;
			while (parser.match("COMMA")) {
				parser.parseExpression(BindingPower.Lowest, builder);
				argCount++;
			}
		}
		parser.consume("RPAREN");
		if (argCount === 0) {
			throw ErrorFactory.parsing(
				"AGGREGATE_CALL_EMPTY",
				`"${name}()" has no values to work on: list them inside the brackets, as in ${name}(1, 2, 3).`,
			);
		}
		// A function of the reader's own under one of these names would never be
		// called, since the call is the aggregate; said here, rather than
		// defining it and quietly answering the built-in.
		if (parser.peek()?.type === "EQUALS") {
			throw ErrorFactory.parsing(
				"AGGREGATE_NAME_RESERVED",
				`"${name}(...)" is the built-in ${name === "stdev" ? "standard deviation" : name === "mean" ? "average" : name}, so a function of your own needs another name.`,
			);
		}
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(builtin);
		builder.emitIndex(argCount);
	}
}
