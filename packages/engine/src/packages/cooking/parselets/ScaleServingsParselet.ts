import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";

/** The words a reader puts between the two counts, none of which the arithmetic needs. */
const SERVING_WORDS = new Set(["servings", "serving", "serves", "people", "portions", "portion"]);

/**
 * `scale <from> servings to <to>`: the factor that turns one into the other.
 *
 * The noun is consumed rather than read, because it is the reader saying what
 * the two numbers count, not a unit the engine needs. A recipe writes whichever
 * of them reads better, and they all mean the same arithmetic.
 */
export class ScaleServingsParselet implements PrefixParselet {
	readonly category = "Cooking";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Prefix, builder);
		// The normaliser has already put an implicit multiply between the count
		// and the noun, the way it does for `2(x + 1)`, so the operator is skipped
		// along with the word it joins. Both are the reader naming what the number
		// counts, and neither is arithmetic.
		const afterCount = parser.peek();
		const nounAt = afterCount?.type === "STAR" ? 1 : 0;
		const noun = nounAt === 1 ? parser.peekAt?.(1) ?? null : afterCount;
		if (noun && SERVING_WORDS.has((noun.value ?? "").toLowerCase())) {
			if (nounAt === 1) parser.consume();
			parser.consume();
		}
		parser.consume("TO");
		parser.parseExpression(BindingPower.Prefix, builder);
		builder.emitPluginCall("recipeScalingFactor", 2);
	}
}
