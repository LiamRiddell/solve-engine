import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * A line that is only `sum` or `total` (#742). The word is pushed as the
 * handler's one argument, so `columnTotal` can read a variable of that name
 * when the note defines one, and total the block above when it does not. See
 * ColumnTotalNormalizerRule.ts for where the token is made.
 */
export class ColumnTotalParselet implements PrefixParselet {
  readonly category = "Lines";

  parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(token.value);
    builder.emitPluginCall("columnTotal", 1);
  }
}
