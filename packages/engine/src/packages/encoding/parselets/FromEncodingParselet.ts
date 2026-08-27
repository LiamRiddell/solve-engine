import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `<value> from <encoding>`, the decoding half of the text encodings (issue
 * #188): `"aGVsbG8=" from base64` reads the base64 back to `hello`. It mirrors
 * `<value> as <encoding>` (the encoding half), so a value can be turned into a
 * form on one line and read back on the next.
 *
 * It is bound to the fused `FROM_ENCODING` token, which the package's `phrases`
 * mint only for `from base64` / `from url` / `from hex bytes`. The bare `from`
 * token is left completely alone, so the `plot ... from ... to ...` and
 * `clamp ... from ... to ...` forms, which consume a bare `from` positionally,
 * are undisturbed: their `from` is never followed by an encoding name, so it
 * never fuses.
 */
export class FromEncodingParselet implements InfixParselet {
	readonly category = "Encoding";
	readonly bindingPower = BindingPower.Conditional;

	parse(_parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		// The fused token carries the whole phrase, e.g. "from base64"; the name
		// is what follows "from".
		const name = (token.value ?? "").replace(/^from\s+/i, "").toLowerCase();
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(name);
		builder.emitPluginCall("fromEncoding", 2);
	}
}
