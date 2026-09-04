import { InfixParselet, parseRightOperand } from "@solve-js/parser/Parselet";
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
	readonly rightAssociative: boolean;
	constructor(
    bp: number,
    private readonly opcode: OpCode,
    rightAssociative = false
  ) {
    this.bindingPower = bp;
    // `^` is the only right-associative operator here. The declaration is
    // what parseRightOperand reads, and what the registry reports.
    this.rightAssociative = rightAssociative;
  }

  parse(parser: Parser, left: Token, token: Token, builder: BytecodeBuilder): void {
    parseRightOperand(this, parser, builder);
    builder.emitOpcode(this.opcode);
  }
}
