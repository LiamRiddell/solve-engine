import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * Vector literals, both bracketed and the bare tuple form.
 *
 * The dimension passed to the constructor pins the expected component count so
 * a two-dimensional literal cannot silently parse as three; zero means accept
 * whatever the literal contains.
 */
export class VectorParselet implements PrefixParselet {
	readonly category = "Vector";
	private dimension: number;

  constructor(dimension = 0) {
    this.dimension = dimension;
  }

  parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    parser.consume("LPAREN");
    let count = 0;
    if (parser.peek()?.type !== "RPAREN") {
      parser.parseExpression(0, builder);
      count++;
      while (parser.match("COMMA")) {
        parser.parseExpression(0, builder);
        count++;
      }
    }
    parser.consume("RPAREN");
    // Legacy vector-constructor sugar, kept working as a 1xN row-vector
    // Matrix (Calca has no equivalent syntax; this codebase's own existing
    // tests exercise vec2/vec3/vec4, so it stays as sugar rather than being
    // removed. See MatrixOps.ts/the bracket-literal matrix syntax for the
    // primary construction path going forward).
    builder.emitOpcode(OpCode.MAT_NEW);
    builder.emitIndex(1);
    builder.emitIndex(this.dimension > 0 ? this.dimension : count);
  }
}
