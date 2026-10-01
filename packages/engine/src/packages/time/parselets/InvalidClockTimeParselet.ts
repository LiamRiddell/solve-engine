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
 * with the parser's wording about the colon, or with the refusal the rule set
 * on the token (`RANGE_BEFORE_ANOTHER_ARGUMENT` for `sum(100:200, 50)`).
 */
export class InvalidClockTimeParselet implements PrefixParselet {
	readonly category = "Time";

	parse(_parser: Parser, token: Token, _builder: BytecodeBuilder): void {
		// The refusal the rule set on the token, which names a range written
		// before a later argument as a range (see rangeBeforeLaterArgument).
		const fault = token.fault ?? { code: "INVALID_TIME_LITERAL", message: invalidTimeMessage(String(token.value)) };
		throw ErrorFactory.parsing(fault.code, fault.message, { tokenType: token.type, tokenValue: token.value });
	}
}
