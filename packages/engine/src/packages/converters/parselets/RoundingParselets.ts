import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * Rounding, written the way it is said.
 *
 *   5.5 rounded                    6
 *   5.5 rounded down               5
 *   37 to nearest 10               40
 *   $490 rounded to nearest hundred    $500
 *   21 rounded up to nearest 5     25
 *   1/3 to 2 dp                    0.33
 *
 * None of this parsed before. The engine could round, but only by configuring
 * the formatter, which changes how every answer is displayed rather than
 * rounding one value inside an expression. They are different things: the
 * formatter cannot express `21 rounded up to nearest 5`, and it cannot feed a
 * rounded number into the next line's arithmetic.
 *
 * All three forms are postfix operators on the value to their left, which is
 * why they are infix parselets triggered on the word rather than prefix
 * parselets. They bind at `Conditional`, below arithmetic, so the whole
 * expression to the left is what gets rounded: `1/3 to 2 dp` rounds a third,
 * not the 3.
 */

/**
 * Magnitude words usable as a rounding increment.
 *
 * `to nearest hundred` reads naturally and `to nearest 100` is the same thing.
 * Only the round magnitudes are here, because those are the only ones anyone
 * rounds to.
 */
const INCREMENT_WORDS: Record<string, number> = {
	ten: 10,
	hundred: 100,
	thousand: 1_000,
	million: 1_000_000,
	billion: 1_000_000_000,
};

/** Which way an explicit `up`/`down` sends the result. */
type Direction = "nearest" | "up" | "down";

/**
 * Emits the rounding of the value already on the stack to `increment`.
 *
 * Rounding to an increment is a division, an ordinary round, and a
 * multiplication back, so it needs no new opcode. The increment is a
 * parse-time number rather than a stack value, which is what lets it be
 * emitted twice without any stack shuffling; see {@link readIncrement} for why
 * that is not a real restriction.
 */
function emitRoundToIncrement(builder: BytecodeBuilder, increment: number, direction: Direction): void {
	builder.emitOpcode(OpCode.PUSH_NUMBER);
	builder.emitNumber(increment);
	builder.emitOpcode(OpCode.DIV);
	emitRoundDirection(builder, direction);
	builder.emitOpcode(OpCode.PUSH_NUMBER);
	builder.emitNumber(increment);
	builder.emitOpcode(OpCode.MUL);
}

/** Emits `round`/`ceil`/`floor` for the value on top of the stack. */
function emitRoundDirection(builder: BytecodeBuilder, direction: Direction): void {
	const builtin = direction === "up" ? CEIL_BUILTIN : direction === "down" ? FLOOR_BUILTIN : ROUND_BUILTIN;
	builder.emitOpcode(OpCode.CALL_BUILTIN);
	builder.emitIndex(builtin);
	builder.emitIndex(1);
}

const ROUND_BUILTIN = 8;
const CEIL_BUILTIN = 6;
const FLOOR_BUILTIN = 7;

/** Reads an optional `up`/`down` immediately after `rounded`. */
function readDirection(parser: Parser): Direction {
	const next = parser.peek();
	const word = (next?.text ?? "").toLowerCase();
	if (word === "up") {
		parser.consume();
		return "up";
	}
	if (word === "down") {
		parser.consume();
		return "down";
	}
	return "nearest";
}

/**
 * `<value> rounded`, `<value> rounded up|down`, and either of those followed
 * by `to nearest <increment>`.
 */
export class RoundedParselet implements InfixParselet {
	readonly category = "Converters";
	readonly bindingPower = BindingPower.Conditional;

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		const direction = readDirection(parser);

		// The optional "to nearest <increment>" tail. Without it, round to a
		// whole number.
		if (parser.match("TO_NEAREST")) {
			emitRoundToIncrement(builder, readIncrement(parser), direction);
			return;
		}
		emitRoundDirection(builder, direction);
	}
}

/** `<value> to nearest <increment>`, with no `rounded` in front. */
export class ToNearestParselet implements InfixParselet {
	readonly category = "Converters";
	readonly bindingPower = BindingPower.Conditional;

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		emitRoundToIncrement(builder, readIncrement(parser), "nearest");
	}
}

/**
 * Reads the rounding increment: either a number literal or a magnitude word.
 *
 * A literal rather than an expression, deliberately. Every way anyone writes
 * this names a constant, because an increment computed at run time is not a
 * thing people round to, and taking it at parse time is what allows the
 * emitted bytecode to mention it twice without shuffling the stack.
 */
function readIncrement(parser: Parser): number {
	const next = parser.peek();
	const word = (next?.text ?? "").toLowerCase();
	const magnitude = INCREMENT_WORDS[word];
	if (magnitude !== undefined) {
		parser.consume();
		return magnitude;
	}
	if (next?.type === "NUMBER") {
		parser.consume();
		const value = Number(next.value);
		if (Number.isFinite(value) && value > 0) return value;
	}
	throw ErrorFactory.parsing(
		"INVALID_ROUNDING_INCREMENT",
		`"to nearest ${next?.value ?? "?"}": expected a positive number or one of ${Object.keys(INCREMENT_WORDS).join(", ")}`,
	);
}

/**
 * `<value> to <n> dp` and its spellings, rounding to a number of decimal
 * places.
 *
 * The place count is carried on the token itself, fused by
 * `decimalPlacesNormalizerRule`, because "to" is already an infix operator
 * here (percentage change, `100 to 150`) and a second parselet on it would
 * have to guess which grammar it was in from lookahead.
 */
export class DecimalPlacesParselet implements InfixParselet {
	readonly category = "Converters";
	readonly bindingPower = BindingPower.Conditional;

	parse(_parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		const places = Number(token.value);
		if (!Number.isFinite(places) || places < 0 || places > 100) {
			throw ErrorFactory.parsing(
				"INVALID_DECIMAL_PLACES",
				`"to ${token.value} dp": expected a place count between 0 and 100`,
			);
		}
		// value * 10^p, rounded, / 10^p.
		const scale = Math.pow(10, places);
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(scale);
		builder.emitOpcode(OpCode.MUL);
		emitRoundDirection(builder, "nearest");
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(scale);
		builder.emitOpcode(OpCode.DIV);
	}
}
