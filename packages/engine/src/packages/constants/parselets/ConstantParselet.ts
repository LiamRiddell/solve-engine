import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { constantEntry } from "../Constants";
import { emitBuiltinPluginCall } from "@solve-js/packages/SynchronousPluginFunctions";

/**
 * The value a constant can be written into a line as, a plain number, or null
 * when it needs the `constantValue` plugin to build it.
 *
 * A mathematical constant (`tau`, `phi`, `golden ratio`) has no unit and no
 * marking, so it is a number known when the line is read, exactly as `pi` and
 * `e` are. A physical one carries a unit, or the unit it is really in, which
 * only the plugin can attach.
 *
 * @param name - The constant's name as the table spells it.
 * @returns The number to push, or null for a constant the plugin builds (or a
 * name the table does not have).
 */
export function inlineConstantValue(name: string): number | null {
	const entry = constantEntry(name);
	if (entry === null || entry.unit !== undefined || entry.unspelledUnit !== undefined) return null;
	return entry.value;
}

/**
 * A named constant (`gravity`, `speed of light`, `tau`).
 *
 * A mathematical constant is pushed as its number, the way `pi` is, so it is a
 * plain value wherever a held expression is compiled on its own (the
 * expression of `solve`, a function body, a map transform). Those refuse a
 * plugin call that may answer from live data, and a constant read through one
 * was refused there as though it were live. A physical constant pushes its
 * name and calls the `constantValue` plugin, which returns the value with its
 * unit; the name travels as data so a single plugin serves every such
 * constant. That plugin answers from its own table and never waits, so the
 * call is emitted as synchronous: a function body or a map transform takes
 * `gravity` as it takes `pi`, and a formula that keeps no units refuses it for
 * its unit, not as live data.
 */
export function constantParselet(name: string): PrefixParselet {
	const inline = inlineConstantValue(name);
	return {
		category: "Constants",
		parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			if (inline !== null) {
				builder.emitOpcode(OpCode.PUSH_NUMBER);
				builder.emitNumber(inline);
				return;
			}
			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(name);
			emitBuiltinPluginCall(builder, "constantValue", 1);
		},
	};
}
