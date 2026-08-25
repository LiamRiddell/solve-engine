import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * `total of #tag` / `sum of #tag` / `average of #tag` / `count of #tag`. The tag
 * name rides on the fused trigger token (TagAggregateNormalizerRule folds the
 * trigger and the TAG together into one token whose value is the name), so the
 * parselet pushes it as the single string argument and calls the plugin
 * handler, which resolves the whole document from the line context. The same
 * shape as ColumnAggregateParselet.
 */
export class TagAggregateParselet implements PrefixParselet {
  readonly category = "Tags";

  constructor(private readonly pluginFnName: string) {}

  parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(token.value);
    builder.emitPluginCall(this.pluginFnName, 1);
  }
}
