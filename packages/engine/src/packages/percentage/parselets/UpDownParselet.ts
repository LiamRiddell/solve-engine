import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * Small English count words, so `three times` reads as naturally as `3 times`.
 *
 * Only the counts that plausibly precede `times` in a sentence, a repeat is a
 * literal known at parse time. A digit works too, resolved directly below.
 */
const COUNT_WORDS: Record<string, number> = {
	one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
	seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** The count in a `N times` suffix, or `null` when the token is not one. */
function resolveCount(token: Token): number | null {
	if (token.type === "NUMBER") {
		const n = Number(token.value);
		return Number.isInteger(n) && n >= 0 ? n : null;
	}
	if (token.type === "IDENT") {
		return COUNT_WORDS[token.value.toLowerCase()] ?? null;
	}
	return null;
}

/**
 * `X up N%` and `X down N%`, a successive percentage change applied to a value,
 * chainable with `then` and repeatable with `N times`.
 *
 *   120 up 10% then down 10%   118.80   (not 120: each change compounds)
 *   50 up 20%                  60
 *   80 down 15%                68
 *   100 up 10% three times     133.10
 *
 * One step is `left * (1 ± rate)`, the same arithmetic as `increase X by N%`
 * (see {@link IncreaseByParselet}), so a chain is that step applied to the
 * running total again and again. That is exactly where the intuition fails:
 * `120 up 10% then down 10%` looks like it should return to 120, and returns
 * 118.80 instead, because the 10% down is taken off the larger 132.
 *
 * `up`/`down` become this operator only immediately before a percentage (the
 * PercentUpDownNormalizerRule does the retyping), so prose keeps its words.
 */
export class UpDownParselet implements InfixParselet {
	readonly category = "Percentage";
	readonly bindingPower = BindingPower.Conditional;

	/** @param sign `1` for `up` (grow), `-1` for `down` (shrink). */
	constructor(private readonly sign: 1 | -1) {}

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		// left operand is already on the VM stack. Parse the rate ("10%" -> 0.1).
		parser.parseExpression(this.bindingPower, builder);

		// Build the factor (1 ± rate) from [left, rate], mirroring IncreaseByParselet:
		// PUSH 1 -> [left, rate, 1] -> SWAP -> [left, 1, rate] -> ADD/SUB -> [left, 1 ± rate].
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(1);
		builder.emitOpcode(OpCode.SWAP);
		builder.emitOpcode(this.sign > 0 ? OpCode.ADD : OpCode.SUB);

		// Optional `N times`: raise the factor to the Nth power, so the change
		// lands N times over. `1.1 ^ 3` for "up 10% three times".
		const repeat = this.tryConsumeRepeat(parser);
		if (repeat !== null) {
			builder.emitOpcode(OpCode.PUSH_NUMBER);
			builder.emitNumber(repeat);
			builder.emitOpcode(OpCode.EXP);
		}

		// Apply the factor to the running total.
		builder.emitOpcode(OpCode.MUL);

		// A `then` before the next step is pure connective. Drop it so the
		// parser's own precedence loop reaches the following `up`/`down` and
		// chains onto this result. Only a `then` that actually precedes a step
		// is taken, so `if C then V else W` keeps its own `then`.
		this.consumeChainThen(parser);
	}

	/**
	 * Consume a trailing `N times` (`3 times`, `three times`) if present,
	 * returning the count, or `null` when there is no repeat here. The word
	 * "times" lexes as the multiply token but keeps its source text, which is
	 * what tells it apart from a literal `*`.
	 */
	private tryConsumeRepeat(parser: Parser): number | null {
		const countTok = parser.peek();
		const timesTok = parser.peekAt(1);
		if (!countTok || !timesTok) return null;
		if (timesTok.type !== "STAR" || timesTok.value.toLowerCase() !== "times") return null;

		const count = resolveCount(countTok);
		if (count === null) return null;

		parser.consume(); // count
		parser.consume(); // times
		return count;
	}

	/** Drop a connective `then` that sits directly before the next step. */
	private consumeChainThen(parser: Parser): void {
		if (parser.peek()?.type !== "THEN") return;
		const next = parser.peekAt(1)?.type;
		if (next === "PCT_UP" || next === "PCT_DOWN") {
			parser.consume(); // then
		}
	}
}
