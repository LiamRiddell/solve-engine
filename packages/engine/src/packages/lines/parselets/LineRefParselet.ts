import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { DELETED_LINE_REF } from "../normalizer/LineRefNormalizerRule";
import { DELETED_LINE_NUMBER } from "../LinesPluginFunctions";

/**
 * `line1` / `line 1` -- an arbitrary line's cached result by 1-based line
 * number (Notes Calculator, NumPad). Fused into a single `LINE_REF` token
 * by `LineRefNormalizerRule.ts`, carrying the parsed line number as
 * `token.value`.
 *
 * The line number is pushed via `PUSH_NUMBER`/`emitNumber()` (the
 * `Float64Array` constant pool) -- deliberately NOT `emitIndex()`, which
 * writes a single raw byte (0-255) directly into the opcode stream and
 * would silently break for any document past 255 lines.
 *
 * `line deleted` fuses into the same token with `DELETED_LINE_REF` in place
 * of a number, and compiles to the same call with `DELETED_LINE_NUMBER`, which
 * the handler answers with its named error.
 */
export class LineRefParselet implements PrefixParselet {
  readonly category = "Lines";

  parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    const lineNumber = token.value === DELETED_LINE_REF ? DELETED_LINE_NUMBER : parseInt(token.value, 10);
    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(lineNumber);
    builder.emitPluginCall("lineRef", 1);
  }
}
