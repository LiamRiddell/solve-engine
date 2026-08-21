import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * `sum of column "cost" in table above` and its siblings (`total`/`average`/
 * `mean`/`min`/`max`/`count`/`median` of column ...).
 *
 * The leading verb-and-noun is phrase-fused by `TablesPackage.ts` into one
 * trigger token (`... of column`), so by the time this runs only the column
 * name and an optional address remain. The grammar is:
 *
 *   <trigger> STRING [ in [the] ] [ table ] [ above ]
 *
 * The address words are consumed and discarded: the only table a column can be
 * read from in this slice is the nearest one above, so `above`, `table above`,
 * `in table above` and a bare `"name"` all resolve the same way. Consumption
 * stops at the first token that is not an address word, so
 * `sum of column "cost" above + 100` still adds 100 to the total.
 *
 * Hand-written rather than built on `definePhrasePattern` for the same reason
 * as the math-phrase parselets: once the verb is fused into the trigger, the
 * next slot is a value (the string), not a keyword, which that builder cannot
 * express.
 */
export class ColumnAggregateParselet implements PrefixParselet {
  readonly category = "Tables";

  constructor(private readonly pluginFnIndex: number) {}

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    const next = parser.peek();
    if (!next || next.type !== "STRING") {
      throw ErrorFactory.parsing(
        "TABLE_COLUMN_NAME_EXPECTED",
        `Expected a quoted column name after "... of column" but got ${next ? `"${next.value}"` : "end of input"}`,
      );
    }
    const nameToken = parser.consume("STRING");

    // Discard an optional address: "in", "the", "table", "above", in any of
    // the orders those words are naturally written. IN is the locale keyword
    // token for "in"; the rest lex as plain identifiers.
    while (true) {
      const t = parser.peek();
      if (!t) break;
      if (t.type === "IN") {
        parser.consume();
        continue;
      }
      if (t.type === "IDENT" && ADDRESS_WORDS.has(t.value.toLowerCase())) {
        parser.consume();
        continue;
      }
      break;
    }

    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(nameToken.value);
    builder.emitOpcode(OpCode.CALL_PLUGIN);
    builder.emitIndex(this.pluginFnIndex);
    builder.emitIndex(1);
  }
}

/** Trailing words that only address the table and carry no other meaning here. */
const ADDRESS_WORDS = new Set(["the", "table", "above"]);
