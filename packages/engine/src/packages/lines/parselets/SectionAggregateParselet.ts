import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * `total of section "Travel"` / `sum of section` / `average of section` /
 * `count of section`. The heading name rides on the fused trigger token
 * (`SectionAggregateNormalizerRule` folds the trigger, the word `section` and the
 * quoted name into one token whose value is the name), so the parselet pushes it
 * as the single string argument and calls the plugin handler, which finds the
 * heading and reads its block from the line context. The same shape as the tag
 * and table column aggregates.
 */
export class SectionAggregateParselet implements PrefixParselet {
  readonly category = "Lines";

  constructor(private readonly pluginFnName: string) {}

  parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(token.value);
    builder.emitPluginCall(this.pluginFnName, 1);
  }
}
