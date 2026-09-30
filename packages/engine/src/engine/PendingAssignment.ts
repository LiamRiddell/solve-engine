/**
 * The two pieces that let an assignment whose value is still being fetched
 * hand that pending state to the lines that read it.
 *
 * A live value (a share price, an exchange rate) is pending on its first
 * evaluation: the resolver preflight starts the fetch and the line answers
 * pending without the VM ever running it. An assignment line that answers this
 * way never runs its `STORE_VAR` either, so the name it assigns stayed
 * undefined and every line reading it was refused as an undefined variable,
 * when the honest answer is that it is waiting too. {@link namesStoredBy} names
 * what such a line would have stored, so the engine can hold the pending value
 * there.
 *
 * A bare assignment (`x = stock(AAPL)`, no colon) is handled by the symbolic
 * grammar, which evaluates its right-hand side directly and never runs the
 * preflight, so its fetch never started, and the resolver answered that it was
 * read before its fetch ({@link readBeforeItsFetch}). {@link asColonAssignment}
 * restates such a line as the colon form (`:x = stock(AAPL)`), which the
 * ordinary path compiles, preflights and re-runs when the value lands. Every
 * other bare assignment stays on the symbolic path, so a right-hand side that
 * only might fetch (a constant, a conversion `in` a zone) is stored as before.
 *
 * The boundary: the answers that say so are the one `createQueryResolver`
 * gives (`<NAMESPACE>_NOT_PREFLIGHTED`, see `resolvers/QueryResolverErrorCodes.ts`),
 * the historical rate's, a currency conversion's, and a pending value. A hand-written resolver whose
 * plugin answers an empty cache some other way keeps that answer for a bare
 * assignment; the colon form (`:x = ...`) preflights whatever the resolver.
 */

import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { OpCode } from "@solve-js/parser/OpCode";
import { nextInstruction } from "@solve-js/parser/OperandWidth";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { ValueType, type Value } from "@solve-js/vm/Value";

/**
 * Whether a right-hand side's answer says it read a live value before its fetch
 * was started: a pending value, an error whose code is the resolvers'
 * `<NAMESPACE>_NOT_PREFLIGHTED` (the historical rate's
 * `HISTORICAL_RATE_NOT_PREFLIGHTED` included), or a currency conversion with no
 * rate in the cache (`CURRENCY_RATE_UNAVAILABLE`). On the symbolic path, which
 * never preflights, an empty cache is all the last one can mean; a fetch that
 * truly failed answers the same through the ordinary path, which then says so.
 *
 * @param value - What the right-hand side answered.
 * @returns True when the line needs the preflight the symbolic path skips.
 */
export function readBeforeItsFetch(value: Value): boolean {
	if (value.type === ValueType.Pending) return true;
	if (value.type !== ValueType.Error || typeof value.errorCode !== "string") return false;
	return value.errorCode.endsWith("_NOT_PREFLIGHTED") || value.errorCode === "CURRENCY_RATE_UNAVAILABLE";
}

/**
 * The variable names a program assigns with `STORE_VAR`, in the order it
 * assigns them, each once.
 *
 * Walks the stream instruction by instruction (never mistaking an operand
 * byte for an opcode) and skips an index outside the string pool, so a
 * malformed program yields fewer names rather than `undefined`.
 *
 * @param program - A compiled line.
 * @returns The names, empty for a program that assigns none.
 */
export function namesStoredBy(program: BytecodeProgram): string[] {
	const { opcodes, strings } = program;
	const names: string[] = [];
	for (let i = 0; i < opcodes.length; i = nextInstruction(opcodes, i)) {
		if (opcodes[i] !== OpCode.STORE_VAR || i + 1 >= opcodes.length) continue;
		const index = opcodes[i + 1];
		if (!Object.prototype.hasOwnProperty.call(strings, index)) continue;
		const name = strings[index];
		if (typeof name === "string" && !names.includes(name)) names.push(name);
	}
	return names;
}

/**
 * A bare single-name assignment (`x = <expression>`) restated as the colon
 * form (`:x = <expression>`), or `null` for any other line.
 *
 * Only the plain shape is restated: a single-word name (a multi-word name is
 * registered by the symbolic grammar itself), the `=` straight after it, and
 * something after the `=` that is not itself another `=`.
 *
 * @param tokens - The line's normalised tokens.
 * @returns The tokens with a colon before the name, or `null`.
 */
export function asColonAssignment(tokens: readonly Token[]): Token[] | null {
	if (tokens.length < 3) return null;
	const [name, equals] = tokens;
	if (name.type !== "IDENT" && name.type !== "UNIT") return null;
	if (/\s/.test(name.value) || name.value === "") return null;
	if (equals.type !== "EQUALS") return null;
	if (tokens.slice(2).some((t) => t.type === "EQUALS")) return null;
	const colon: Token = { ...name, type: "COLON", typeId: tokenTypeId("COLON"), value: ":", text: ":", sourceEnd: undefined };
	return [colon, ...tokens];
}
