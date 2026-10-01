import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { emitBuiltinPluginCall } from "@solve-js/packages/SynchronousPluginFunctions";

/**
 * Emits the value of a fused `IP_CIDR` literal token (`192.168.1.0/24`). The
 * token carries the packed `addr|prefix` payload the normalizer computed; the
 * `ipLiteral` plugin turns it back into the IP/CIDR value at run time.
 */
export class IpLiteralParselet implements PrefixParselet {
	readonly category = "IP";

	parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(token.value);
		emitBuiltinPluginCall(builder, "ipLiteral", 1);
	}
}
