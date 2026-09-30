import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { readOverrides } from "./WhatIfParselet";
import { SCENARIO_DECLARE_FN_NAME, SCENARIO_READ_FN_NAME } from "../ScenarioPluginFunctions";

/**
 * `scenario <name> with <name> = <value> [and <name> = <value> ...]`, a named
 * set of inputs kept in the note (#744). The words `scenario <name> with` are
 * one `SCENARIO_DECLARATION` token carrying the name (see
 * `scenarioDeclarationNormalizerRule`); the overrides are read exactly as a
 * what-if reads them, so the same names, joins and limits apply.
 *
 * Emits the scenario's name, then each override as a name and a value, for the
 * declaration plugin, which checks the values and answers a summary of them.
 */
export class ScenarioDeclarationParselet implements PrefixParselet {
	readonly category = "WhatIf";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(token.value);
		const count = readOverrides(parser, builder, `scenario ${token.value} with growth = 8%`, "A scenario");
		builder.emitPluginCall(SCENARIO_DECLARE_FN_NAME, 1 + count * 2);
	}
}

/**
 * `line N under <name>`: line N's answer with the named scenario's inputs in
 * force (#744). The whole phrase is one `SCENARIO_READ` token carrying `N|name`
 * (see `scenarioReadNormalizerRule`); a deleted target (`line deleted`)
 * compiles to -1, as a what-if's does.
 */
export class ScenarioReadParselet implements PrefixParselet {
	readonly category = "WhatIf";

	parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const bar = token.value.indexOf("|");
		const line = token.value.slice(0, bar);
		const name = token.value.slice(bar + 1);
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(line === "deleted" ? -1 : parseInt(line, 10));
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(name);
		builder.emitPluginCall(SCENARIO_READ_FN_NAME, 2);
	}
}
