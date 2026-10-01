import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { emitBuiltinPluginCall } from "@solve-js/packages/SynchronousPluginFunctions";

/**
 * Emits the value of a fused `IPV6_ADDRESS` token (`fe80::1`,
 * `2001:db8::/32`). The token carries the packed `<hex>|<prefix>|<zone>`
 * payload the normalizer computed; the `ipv6Literal` plugin turns it back into
 * the IPv6 value at run time, as `ipLiteral` does for a dotted quad.
 */
export class Ipv6AddressParselet implements PrefixParselet {
	readonly category = "IP";

	parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(token.value);
		emitBuiltinPluginCall(builder, "ipv6Literal", 1);
	}
}
