import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * `weighted average of <value> at <weight>, <value> at <weight>, ...`, the mean
 * that lets each value carry its own weight (grades by credit, a blended rate,
 * a portfolio split). Triggered on the fused `WEIGHTED_AVERAGE_OF` token.
 *
 * Each element is a `<value> at <weight>` pair. The value is a full expression;
 * the weight is a number, a percentage (`30%`), or a number with a trailing
 * label to ignore (`3 credits`), so the weight is parsed just below the level a
 * unit label would attach at and any label is then skipped. The
 * `weightedAverage` builtin normalises the weights by their own total, so they
 * need not sum to 1 or to 100%.
 *
 * ## The missing weight is an error, not a silent 1
 * A value written with no `at` clause is reported rather than filled in with a
 * weight of 1, because guessing one would quietly change the answer of a list
 * that was simply mistyped (issue #185). The pairs are emitted interleaved,
 * `[v1, w1, v2, w2, ...]`, which is the order the builtin reads.
 */
export class WeightedAverageParselet implements PrefixParselet {
	readonly category = "MathPhrases";

	constructor(private readonly builtinIndex: number) {}

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		let argCount = 0;
		do {
			// The value, up to the `at`. Parsed at Conjunction like the other
			// aggregate lists, so a compound value (`72 + 1 at 30%`) still reads.
			parser.parseExpression(BindingPower.Conjunction, builder);
			argCount++;

			// The connective. `at` lexes to RATE_AT (the word) or AT (a fused @).
			if (!parser.match("RATE_AT") && !parser.match("AT")) {
				const next = parser.peek();
				throw ErrorFactory.parsing(
					"WEIGHTED_AVERAGE_MISSING_WEIGHT",
					`weighted average: each value needs a weight, as in "72 at 30%"`,
					{ actualType: next?.type, actualValue: next?.value },
				);
			}

			// The weight, just below Product so a trailing unit label (`3 credits`)
			// is left for the skip below rather than read as `3 * credits`. A bare
			// number or a percentage is taken whole.
			parser.parseExpression(BindingPower.Product, builder);
			argCount++;
			this.skipWeightLabel(parser);
		} while (parser.match("COMMA") || parser.match("AND_CONJ"));

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(this.builtinIndex);
		builder.emitIndex(argCount);
	}

	/**
	 * Discards a trailing label on a weight (`credits` in `3 credits`), including
	 * the implicit-multiply `*` the normalizer inserts before it, up to the next
	 * comma, `and`, or the end. The weight's value is the number; the word is a
	 * unit the reader wrote for their own sake.
	 */
	private skipWeightLabel(parser: Parser): void {
		for (;;) {
			const next = parser.peek();
			if (!next) return;
			if (next.type === "STAR" || next.type === "IDENT" || next.type === "UNIT") {
				parser.consume();
				continue;
			}
			return;
		}
	}
}
