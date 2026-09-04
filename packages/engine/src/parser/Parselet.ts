import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { Token } from "@solve-js/lexer/Token";
import { Parser } from "@solve-js/parser/Parser";

/**
 * Handles a token appearing where a value is expected.
 *
 * A literal, a prefix operator such as unary minus, or a function name. The
 * parser calls this when the token opens an expression rather than continuing
 * one.
 */
export interface PrefixParselet {
	/** Diagnostic category for this parselet (e.g. "Arithmetic", "Function", "Variable") */
	readonly category: string;
	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void;
}

/**
 * Handles a token appearing after a value.
 *
 * A binary operator, or anything else that continues an expression already in
 * progress. Its binding power decides how tightly it binds against neighbours.
 */
export interface InfixParselet {
	/** Diagnostic category for this parselet (e.g. "Arithmetic", "UoM") */
	readonly category: string;
	/** Binding power (precedence), property access avoids vtable dispatch in hot loop */
	readonly bindingPower: number;
	/**
	 * Whether the operator groups from the right (`2 ^ 3 ^ 2` is `2 ^ (3 ^ 2)`).
	 * Absent means left, which is what every operator but exponentiation
	 * wants. Read by {@link parseRightOperand}, and reported by
	 * `ParseletRegistry.getAllInfix` so a precedence table built from the
	 * registry says what the parser does.
	 */
	readonly rightAssociative?: boolean;
	parse(parser: Parser, left: Token, token: Token, builder: BytecodeBuilder): void;
}

/**
 * Parse the right operand of `parselet` at the power its associativity needs.
 *
 * The parser's infix loop stops when the next operator's power is not above
 * the minimum it was given. Parsing the right operand at the operator's own
 * power therefore stops at the next occurrence of it, and a chain groups
 * left; one below keeps consuming, and it groups right. A parselet that calls
 * this in place of `parser.parseExpression(this.bindingPower, builder)` gets
 * both behaviours from the one declaration.
 */
export function parseRightOperand(parselet: InfixParselet, parser: Parser, builder: BytecodeBuilder): void {
	parser.parseExpression(parselet.rightAssociative === true ? parselet.bindingPower - 1 : parselet.bindingPower, builder);
}
