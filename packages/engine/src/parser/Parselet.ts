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
	parse(parser: Parser, left: Token, token: Token, builder: BytecodeBuilder): void;
}
