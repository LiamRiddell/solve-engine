import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * `plot <expr> from <a> to <b>` (wiki: `plot sin(x) from 0 to 2pi`), samples the
 * sub-expression across the range and answers with its (x, y) points.
 *
 * Built on the same machinery `map` uses: the sub-expression is compiled into
 * its own body binding the reserved name `x` (exactly as a map transform is,
 * see `MapReduceShared.ts`'s `parseTransform`), and the VM re-runs that body at
 * each sample point via the `PLOT_INVOKE` opcode. The `from … to …` bounds are
 * ordinary expressions, consumed positionally like {@link ClampParselet} does,
 * since `to` is also the unit-conversion operator.
 *
 * The source text of the sub-expression is captured for the label a reader
 * without a canvas sees; the points themselves are the metadata a host draws.
 */
export class PlotParselet implements PrefixParselet {
	readonly category = "Plot";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		// The label wants the expression as written, so capture its source before
		// the parse consumes it.
		const exprText = captureExprText(parser);

		// Compile the sub-expression into its own body binding `x`, so the VM can
		// re-run it per sample. `from` has no infix parselet, so the parse stops
		// there on its own.
		const bodyBuilder = new BytecodeBuilder(builder.pluginIndexMap);
		parser.parseExpression(BindingPower.Lowest, bodyBuilder);
		parser.setBuilder(builder);
		const program = bodyBuilder.build();
		if (program.hasAsync) {
			throw ErrorFactory.parsing(
				"PLOT_EXPR_MUST_BE_SYNCHRONOUS",
				`a plot expression must be synchronous (no weather, stocks or currency calls).`,
			);
		}

		parser.consume("FROM");
		// The bounds are parsed just above `to`'s own binding power (it is the
		// unit-conversion operator, at `Conditional`), so the lower bound stops at
		// `to` instead of reading `0 to 2pi` as a conversion. Arithmetic in a bound
		// (`2pi`, `-3`) binds tighter than that and is still taken whole.
		parser.parseExpression(BindingPower.Conditional, builder); // lower bound
		parser.consume("TO");
		parser.parseExpression(BindingPower.Conditional, builder); // upper bound

		const bodyIdx = builder.emitAnonymousBody(["x"], program);
		builder.emitOpcode(OpCode.PLOT_INVOKE);
		builder.emitIndex(bodyIdx);
		builder.emitString(exprText);
	}
}

/**
 * Reconstructs the source text of the plot's sub-expression, the run of tokens
 * up to `from`, by placing each token's own text at its source offset. This
 * rebuilds the exact spelling (`1000 * 1.05^x`) from the tokens alone, since the
 * parser holds no source string.
 */
function captureExprText(parser: Parser): string {
	const run: Token[] = [];
	for (let i = 0; ; i++) {
		const t = parser.peekAt(i);
		if (!t || t.type === "FROM") break;
		run.push(t);
	}
	if (run.length === 0) return "";
	const start = run[0].offset;
	let text = "";
	for (const tok of run) {
		const pos = tok.offset - start;
		while (text.length < pos) text += " ";
		text += tok.text ?? tok.value ?? "";
	}
	return text.trim();
}
