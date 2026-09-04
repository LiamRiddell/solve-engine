import { BindingPower } from "@solve-js/parser/BindingPower";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { Token } from "@solve-js/lexer/Token";
import type { InfixParselet, PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";

/**
 * The three web forms, read straight from the tokens the normalizer left.
 *
 * Each shape is fixed, so these read their parts by hand rather than through
 * `parseExpression`: there is no sub-expression to work out inside
 * `1920x1080 as ratio`, only parts to check. Reading them by hand is also what
 * lets each part that is missing name itself in the error.
 *
 * @module DimensionsParselets
 */

/** The span of a token, for an error that points at it. */
function spanOf(token: Token | undefined): { start: number; end: number; line: number; col: number } | undefined {
	if (token === undefined) return undefined;
	return { start: token.offset, end: token.offset + (token.text ?? "").length, line: token.line, col: token.col };
}

/** Push a number literal: the opcode, then its constant-pool slot. */
function pushNumber(builder: BytecodeBuilder, n: number): void {
	builder.emitOpcode(OpCode.PUSH_NUMBER);
	builder.emitNumber(n);
}

/** Push a string literal, the same way. */
function pushString(builder: BytecodeBuilder, s: string): void {
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(s);
}

/** The width and height a `DIMENSIONS` token carries. */
function sidesOf(token: Token): { width: number; height: number } {
	const [width, height] = (token.value ?? "").split("x");
	return { width: Number(width), height: Number(height) };
}

/**
 * `1920x1080 as ratio`: the pair reduced to its lowest whole-number terms.
 *
 * The `as ratio` is not optional. The normalizer only fuses a pair when this
 * follows it or `resize` precedes it, so a `DIMENSIONS` token reaching here
 * with nothing after it is a shape the rule allowed and this must not guess at.
 */
export class DimensionsParselet implements PrefixParselet {
	readonly category = "Web";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const preposition = parser.peek();
		const asked = (parser.peekAt(1)?.value ?? "").toLowerCase();
		if ((preposition?.type !== "AS" && preposition?.type !== "IN") || asked !== "ratio") {
			throw ErrorFactory.parsing({
				code: "DIMENSIONS_EXPECTED_FORM",
				message: `"${token.value}" is a width and a height: ask for its shape with "as ratio", or resize it with "resize ${token.value} to 1200 wide"`,
				span: spanOf(preposition),
			});
		}
		parser.consume();
		parser.consume();

		const { width, height } = sidesOf(token);
		pushNumber(builder, width);
		pushNumber(builder, height);
		builder.emitPluginCall("aspectRatio", 2);
	}
}

/** The words that name which side a resize is given, and the side each names. */
const SIDES: Record<string, "width" | "height"> = {
	wide: "width",
	width: "width",
	across: "width",
	tall: "height",
	high: "height",
	height: "height",
};

/**
 * `resize 4000x3000 to 1200 wide`: the pair at a new size, keeping its shape.
 *
 * One side is given and the other follows from it, so the line says which side
 * the number is: `1200 wide` and `900 tall` are the same resize written two
 * ways, and neither is guessed from the number alone.
 */
export class ResizeParselet implements PrefixParselet {
	readonly category = "Web";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const dimensions = parser.peek();
		if (dimensions?.type !== "DIMENSIONS") {
			throw ErrorFactory.parsing({
				code: "RESIZE_EXPECTED_SHAPE",
				message: 'a resize starts with a width and a height, as in "resize 4000x3000 to 1200 wide"',
				span: spanOf(dimensions),
			});
		}
		parser.consume();

		const to = parser.peek();
		if (to?.type !== "TO" && to?.type !== "AS" && to?.type !== "IN") {
			throw ErrorFactory.parsing({
				code: "RESIZE_EXPECTED_SHAPE",
				message: `"${token.value}" expects "to" and then a size, as in "resize 4000x3000 to 1200 wide"`,
				span: spanOf(to),
			});
		}
		parser.consume();

		const target = parser.peek();
		if (target?.type !== "NUMBER") {
			throw ErrorFactory.parsing({
				code: "RESIZE_EXPECTED_SHAPE",
				message: 'a resize needs the size to resize to, as in "resize 4000x3000 to 1200 wide"',
				span: spanOf(target),
			});
		}
		parser.consume();

		// `1200 wide` looks like a number times a variable to the implicit-multiply
		// rule, which has already put a `*` between them by the time this runs. In
		// this shape the word is the side, so step over the operator it inserted.
		if (parser.peek()?.type === "STAR" && SIDES[(parser.peekAt(1)?.value ?? "").toLowerCase()] !== undefined) {
			parser.consume();
		}
		const named = parser.peek();
		const side = named === undefined ? undefined : SIDES[(named.value ?? "").toLowerCase()];
		if (side === undefined) {
			throw ErrorFactory.parsing({
				code: "RESIZE_EXPECTED_SHAPE",
				message: `a resize says which side the size is, "wide" or "tall", as in "resize ${dimensions.value} to ${target.value} wide"`,
				span: spanOf(named),
			});
		}
		parser.consume();

		const { width, height } = sidesOf(dimensions);
		pushNumber(builder, width);
		pushNumber(builder, height);
		pushNumber(builder, Number(target.value));
		pushString(builder, side);
		builder.emitPluginCall("resizeDimensions", 4);
	}
}

/**
 * `1.5rem at 16px base`: the size on the left, measured against a stated root
 * font size rather than the browser default of 16px.
 *
 * It binds like a suffix, tighter than arithmetic, so `2rem + 8px at 20px base`
 * reads the base against the `8px` it sits beside and not the sum.
 */
export class RootFontSizeParselet implements InfixParselet {
	readonly category = "Web";
	readonly bindingPower = BindingPower.Postfix;

	parse(_parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		pushNumber(builder, Number(token.value));
		builder.emitPluginCall("atRootFontSize", 2);
	}
}
