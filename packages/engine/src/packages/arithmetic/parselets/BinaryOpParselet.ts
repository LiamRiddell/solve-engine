import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * Infix operator, parameterised by binding power, opcode and associativity.
 *
 * One class covers every arithmetic operator rather than a class each: the only
 * thing that varies is precedence, which opcode to emit, and whether a chain of
 * the operator groups to the left or the right, all constructor arguments.
 */
export class BinaryOpParselet implements InfixParselet {
	readonly category = "Arithmetic";
	readonly bindingPower: number;
	private readonly rightBindingPower: number;
	constructor(
    bp: number,
    private readonly opcode: OpCode,
    rightAssociative = false
  ) {
    this.bindingPower = bp;
    // The parser's infix loop breaks on `bp <= minBp`, so parsing the right
    // operand at this operator's OWN power stops at the next occurrence of it
    // and the chain groups left. One below keeps consuming, which groups
    // right. `^` is the only right-associative operator here.
    this.rightBindingPower = rightAssociative ? bp - 1 : bp;
  }

  parse(parser: Parser, left: Token, token: Token, builder: BytecodeBuilder): void {
    parser.parseExpression(this.rightBindingPower, builder);
    builder.emitOpcode(this.opcode);
  }
}
