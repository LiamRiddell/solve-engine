import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { UNIT_LABEL_BUILTIN } from "@solve-js/vm/UnitLabels";

/**
 * The name a quantity is shown under, after a unit the reader wrote as a
 * package alias or a document-defined unit (#762). The normaliser places the
 * `UNIT_LABEL` token straight after that unit, or after a conversion's target,
 * so it names the quantity the unit or the conversion produced.
 *
 * Postfix, at the unit literal's own level, so in `1 + 2 Meile` it names
 * `2 Meile` and not the sum, and after `5 km in Meile` it names the converted
 * quantity. It compiles to the unit-label builtin, which labels a quantity and
 * hands anything else (an error from a refused conversion) back unchanged.
 */
export class UnitLabelParselet implements InfixParselet {
	readonly category = "UoM";
	readonly bindingPower = BindingPower.Postfix;

	parse(_parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(token.value);
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(Number(token.text));
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(UNIT_LABEL_BUILTIN);
		builder.emitIndex(3);
	}
}
