import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { stripQuotes } from "@solve-js/utilities/Strings";

/**
 * The package-local name of this example's plugin function. A parselet emits a
 * call to it by this name (`builder.emitPluginCall(REVERSE_FN, ...)`) — never a
 * hardcoded index — and the engine assigns and resolves the numeric CALL_PLUGIN
 * index when the package registers. See `IEnginePackage.pluginFunctions`.
 */
export const REVERSE_FN = "reverse";

/**
 * Prefix parselet for the `reverse` keyword — the whole example in one
 * parselet. Supports the single function-call form `reverse("text")`:
 * consumes `(`, a quoted string, and `)`, then emits bytecode that pushes
 * the unquoted string and calls this package's plugin function with it.
 */
export class ReverseKeywordParselet implements PrefixParselet {
  readonly category = "Basic Example";

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    parser.consume("LPAREN");
    const stringToken = parser.consume(); // the STRING token
    parser.consume("RPAREN");

    const text = stripQuotes(stringToken.value);

    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(text);
    builder.emitPluginCall(REVERSE_FN, 1); // argCount = 1 (the text string)
  }
}
