import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";

/**
 * `total by tag` / `sum by tag`. The three words arrive fused into one token
 * (`tagBreakdownNormalizerRule`), and there is no argument: the plugin handler
 * finds every tag in the document from the line context. The same shape as
 * `total above`.
 */
export class TagBreakdownParselet implements PrefixParselet {
  readonly category = "Tags";

  parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    builder.emitPluginCall("tagBreakdown", 0);
  }
}
