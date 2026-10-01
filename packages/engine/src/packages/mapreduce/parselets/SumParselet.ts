import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { parseCollectionExpr, emitInvoke, callHasOwnComma, parseElementFold } from "../MapReduceShared";
import { ReduceForm } from "@solve-js/vm/MatrixOps";
import { heldExpressionReadsLines } from "@solve-js/parser/HeldExpression";

/**
 * `sum(elementExpr, collection)`, parse-time sugar for
 * `reduce(acc+elementExpr, collection)`, no separate runtime
 * implementation. `elementExpr` may reference the reserved name `x` (the
 * current element), `sum(x, c)` is the trivial "sum of the raw
 * elements" case; `sum(x^2, c)` would be "sum of squares", etc.
 *
 * Built by emitting `LOAD_VAR acc` directly into a fresh builder, then
 * letting the parser continue writing `elementExpr`'s own bytecode onto
 * that SAME builder, then appending `ADD`, no bytecode-splicing API is
 * needed since `parseExpression(minBp, builder)` just keeps emitting
 * whatever comes next onto whichever builder is currently active.
 */
export class SumParselet implements PrefixParselet {
  readonly category = "MapReduce";

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    parser.consume("LPAREN");

    // `sum(1:3)`, one argument: the collection's own elements added up. The
    // range inside the brackets is already a range, not a clock time (see
    // isInsideRangeContext), so without this the one-argument form read the
    // range's start as the element expression and stopped at its colon.
    if (!callHasOwnComma(parser)) {
      parseElementFold(parser, builder, OpCode.ADD, 0, ReduceForm.sum);
      return;
    }

    const bodyBuilder = new BytecodeBuilder(builder.pluginIndexMap);
    bodyBuilder.emitOpcode(OpCode.LOAD_VAR);
    bodyBuilder.emitString("acc");
    parser.parseExpression(BindingPower.Lowest, bodyBuilder);
    parser.setBuilder(builder);
    bodyBuilder.emitOpcode(OpCode.ADD);
    const bodyProgram = bodyBuilder.build();
    const readsLines = heldExpressionReadsLines(bodyProgram, bodyBuilder, "sum");
    if (readsLines !== null) throw readsLines;
    if (bodyProgram.hasAsync) {
      throw ErrorFactory.parsing(
        "MAP_REDUCE_TRANSFORM_MUST_BE_SYNCHRONOUS",
        `sum's element expression must be synchronous (no weather/stocks/currency calls).`,
      );
    }

    parser.consume("COMMA");
    parseCollectionExpr(parser, builder);
    parser.consume("RPAREN");

    // Seed the accumulator with zero rather than letting `reduce` take the
    // collection's first element. Seeding from the first element skips the
    // element expression for that one element, so `sum(x*10, [5])` folded to
    // 5 instead of 50, and `sum(x*2, [1,2,3])` to 1+4+6 = 11 instead of 12.
    // The trivial `sum(x, c)` case is unaffected, which is why the shortfall
    // stayed invisible: with the identity expression the skipped element is
    // its own image.
    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(0);

    emitInvoke(builder, OpCode.REDUCE_INVOKE, { kind: 0, program: bodyProgram }, ["acc", "x"], ReduceForm.sum);
  }
}
