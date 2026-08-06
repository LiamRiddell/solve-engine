import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * The `<value> is ... what` family: asking for whichever part of a percentage
 * relationship you do not have.
 *
 *   20 is 10% of what        200     the base, given the part and the rate
 *   180 is 10% off what      200     the same, before a discount
 *   220 is 10% on what       200     the same, before a markup
 *   20 is what % of 200      10%     the rate, given the part and the base
 *   180 is what % off 200    10%     the rate, as a reduction
 *   180 is what % on 150     20%     the rate, as an increase
 *   50 is 1/5 of what        250     a fraction reads the same as a rate
 *   81 is 9 to what power    2       the odd one out, kept here because it is
 *                                    the same "solve for the missing piece"
 *                                    shape and the same trigger word
 *
 * `5% of what is 6` (the other word order) already existed as
 * `OfWhatIsParselet`. This is the order Soulver documents, and it reads more
 * naturally: you state what you know first.
 *
 * All of it hangs off a bare `is`, which is a real risk this codebase normally
 * avoids taking. It is accepted here because "is" cannot be a `:variableName`
 * (it is a verb, and the colon form rejects keywords anyway), because the
 * existing `is to` proportion phrase is fused earlier and so still wins, and
 * because every alternative below is anchored by a second keyword, so a bare
 * `is` with nothing recognisable after it fails loudly rather than silently
 * swallowing the rest of the line.
 *
 * The left operand is already on the stack when this runs, which is why
 * several branches need a SWAP: `BytecodeBuilder` is append-only, so operand
 * order has to be fixed on the stack rather than by emitting differently.
 */
export class IsWhatParselet implements InfixParselet {
	readonly category = "Percentage";
	// Below arithmetic, so the whole expression to the left is the value being
	// asked about: `10 + 10 is what % of 200` asks about 20.
	readonly bindingPower = BindingPower.Conditional;

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		if (nextWordIs(parser, "what")) {
			parser.consume();
			this.parseWhatRate(parser, builder);
			return;
		}
		this.parseWhatBase(parser, builder);
	}

	/**
	 * `<part> is what % of|off|on <base>`, solving for the rate.
	 */
	private parseWhatRate(parser: Parser, builder: BytecodeBuilder): void {
		if (!parser.match("PERCENT")) {
			throw ErrorFactory.parsing(
				"IS_WHAT_EXPECTED_PERCENT",
				'Expected "%" after "is what", as in "20 is what % of 200"',
			);
		}

		// `50 to 75 is what %` with no trailing preposition: the left operand is
		// already the change, and this only asks for it as a percentage.
		const preposition = readPreposition(parser);
		if (preposition === null) {
			builder.emitOpcode(OpCode.TO_PERCENTAGE);
			return;
		}

		parser.parseExpression(BindingPower.Conditional, builder); // base

		// Every branch starts by dividing, which avoids needing the part and the
		// base on the stack at the same time in the wrong order. `off` and `on`
		// then just measure that ratio's distance from 1, in whichever
		// direction the word implies.
		builder.emitOpcode(OpCode.DIV); // part / base
		if (preposition === "off") {
			// 180/200 is 0.9, and 0.9 is 10% off.
			builder.emitOpcode(OpCode.PUSH_NUMBER);
			builder.emitNumber(1);
			builder.emitOpcode(OpCode.SWAP);
			builder.emitOpcode(OpCode.SUB);
		} else if (preposition === "on") {
			// 180/150 is 1.2, and 1.2 is 20% on.
			builder.emitOpcode(OpCode.PUSH_NUMBER);
			builder.emitNumber(1);
			builder.emitOpcode(OpCode.SUB);
		}
		builder.emitOpcode(OpCode.TO_PERCENTAGE);
	}

	/**
	 * `<part> is <rate> of|off|on what`, solving for the base.
	 */
	private parseWhatBase(parser: Parser, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Conditional, builder); // rate

		// `81 is 9 to what power`, the logarithm. Same shape, different question.
		if (parser.match("TO")) {
			expectWord(parser, "what", '"81 is 9 to what power"');
			expectWord(parser, "power", '"81 is 9 to what power"');
			// log(value) / log(base). stack: value, base
			builder.emitOpcode(OpCode.CALL_BUILTIN);
			builder.emitIndex(LOG_BUILTIN);
			builder.emitIndex(1);
			builder.emitOpcode(OpCode.SWAP);
			builder.emitOpcode(OpCode.CALL_BUILTIN);
			builder.emitIndex(LOG_BUILTIN);
			builder.emitIndex(1);
			builder.emitOpcode(OpCode.SWAP);
			builder.emitOpcode(OpCode.DIV);
			return;
		}

		// Fused tokens, not "of" + "what": "of" is an infix operator in its own
		// right ("10% of 200"), so parsing the rate above would otherwise
		// consume it and the trailing "what" before this line ran.
		const preposition = parser.match("OF_WHAT")
			? "of"
			: parser.match("OFF_WHAT")
				? "off"
				: parser.match("ON_WHAT")
					? "on"
					: null;
		if (preposition === null) {
			throw ErrorFactory.parsing(
				"IS_WHAT_EXPECTED_PREPOSITION",
				'Expected "of what", "off what" or "on what", as in "20 is 10% of what"',
			);
		}

		// stack: part, rate
		if (preposition === "of") {
			// 20 is 10% of 200, so the base is simply the part over the rate.
			builder.emitOpcode(OpCode.DIV);
			return;
		}

		// A discounted or marked-up total: part / (1 -/+ rate). The 1 is
		// combined with the rate first, leaving the part untouched underneath,
		// so the final divide has its operands already in the right order.
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(1);
		if (preposition === "off") {
			// 1 - rate, so SUB needs the 1 on the left.
			builder.emitOpcode(OpCode.SWAP);
			builder.emitOpcode(OpCode.SUB);
		} else {
			builder.emitOpcode(OpCode.ADD);
		}
		builder.emitOpcode(OpCode.DIV);
	}
}

/** `log` in VMBuiltins.ts, the natural logarithm. */
const LOG_BUILTIN = 5;

/** Whether the next token is the given word, without consuming it. */
function nextWordIs(parser: Parser, word: string): boolean {
	return (parser.peek()?.text ?? "").toLowerCase() === word;
}

/** Consumes the expected word, or reports what the phrase should look like. */
function expectWord(parser: Parser, word: string, example: string): void {
	if (!nextWordIs(parser, word)) {
		throw ErrorFactory.parsing(
			"IS_WHAT_EXPECTED_WORD",
			`Expected "${word}" here, as in ${example}`,
		);
	}
	parser.consume();
}

/** Reads `of`, `off` or `on`, or `null` when none is present. */
function readPreposition(parser: Parser): "of" | "off" | "on" | null {
	if (parser.match("OF")) return "of";
	const word = (parser.peek()?.text ?? "").toLowerCase();
	if (word === "off" || word === "on") {
		parser.consume();
		return word;
	}
	return null;
}
