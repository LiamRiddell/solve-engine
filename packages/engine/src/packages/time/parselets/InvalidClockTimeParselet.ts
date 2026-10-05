import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { invalidTimeMessage } from "../normalizer/InvalidClockTimeNormalizerRule";

/**
 * A colon pair inside a bracket that no time rule could read, fused by
 * `invalidClockTimeNormalizerRule`: refused while the line is parsed, with
 * `INVALID_TIME_LITERAL`, so `(24:00)` answers as `24:00` does rather than
 * with the parser's wording about the colon.
 */
export class InvalidClockTimeParselet implements PrefixParselet {
	readonly category = "Time";

	parse(_parser: Parser, token: Token, _builder: BytecodeBuilder): void {
		throw ErrorFactory.parsing("INVALID_TIME_LITERAL", invalidTimeMessage(String(token.value)), { tokenType: token.type, tokenValue: token.value });
	}
}
