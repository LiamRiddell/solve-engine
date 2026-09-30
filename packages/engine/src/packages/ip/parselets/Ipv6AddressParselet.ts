import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * Emits a fused `IPV6_ADDRESS` token (`fe80::1`) as a call to `ipv6Address`,
 * which answers the refusal that names IPv6. It parses as a value, so the line
 * around it parses too and the label fallback never reads the address as a
 * label and a number.
 */
export class Ipv6AddressParselet implements PrefixParselet {
	readonly category = "IP";

	parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(token.value);
		builder.emitPluginCall("ipv6Address", 1);
	}
}
