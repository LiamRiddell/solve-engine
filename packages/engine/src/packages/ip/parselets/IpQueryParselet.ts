import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * The `<question> of|in <subnet>` forms: `hosts in <cidr>`, `netmask of <cidr>`,
 * `broadcast of <cidr>` (issue #189). Each is triggered by a fused phrase token
 * and reads one subnet argument, then calls the plugin that answers it.
 *
 * The argument is normally a fused `IP_CIDR` literal, but `netmask of /24` (and
 * the like) is a bare prefix with no address, which the lexer leaves as a slash
 * and a number. That case is read directly here into a prefix-only value, so the
 * two spellings, a full block and a bare prefix, both reach the same handler.
 */
export class IpQueryParselet implements PrefixParselet {
	readonly category = "IP";
	constructor(private readonly pluginFn: string) {}

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		const next = parser.peek();
		const after = parser.peekAt(1);
		if (next?.type === "SLASH" && after?.type === "NUMBER") {
			// A bare `/24`: a prefix with no address.
			parser.consume(); // the slash
			parser.consume(); // the prefix number
			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(`|${after.value}`);
			builder.emitPluginCall("ipLiteral", 1);
		} else {
			parser.parseExpression(BindingPower.Prefix, builder);
		}
		builder.emitPluginCall(this.pluginFn, 1);
	}
}
