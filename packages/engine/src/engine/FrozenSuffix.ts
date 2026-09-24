/**
 * Recognising the `frozen` suffix on a line, and turning it into the directive
 * a compiled program carries.
 *
 * `frozen` is a line-level suffix rather than an operator: it says what to do
 * with the whole line's answer, so it has to follow everything else on the line
 * and has no meaning in the middle of one. The engine therefore reads it off
 * the end of the normalised tokens and compiles what precedes it as an ordinary
 * line, the same way inline solves and labelled lines are handled at the line
 * level. What precedes it is compiled unchanged, so a frozen conversion is the
 * same program as the unfrozen one plus a {@link FrozenDirective}.
 *
 * Two spellings:
 *
 * - `<expression> frozen`: freeze the answer the first time the line settles.
 * - `<expression> frozen on <date>`: the answer frozen on that day. With a
 *   value frozen that day stored, the line reads it; with none, and the day is
 *   not today, the line is refused rather than frozen afresh.
 *
 * The word is recognised only at the end of a line, and only when what comes
 * before it compiles on its own; otherwise the line is compiled whole, exactly
 * as before this suffix existed, so `2 * frozen` still multiplies by a variable
 * called `frozen`. See `vm/FrozenValues.ts` for what the directive does.
 */
import type { Token } from "@solve-js/lexer";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { OpCode } from "@solve-js/parser/OpCode";
import { nextInstruction } from "@solve-js/parser/OperandWidth";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { isoDayOf, type FrozenDirective } from "@solve-js/vm/FrozenValues";

/** A line split at its `frozen` suffix. */
export interface FrozenSuffix {
	/** The tokens before the suffix, which compile as the line's expression. */
	readonly operand: Token[];
	/** The store key; see {@link FrozenDirective.key}. */
	readonly key: string;
	/** The ISO day of a `frozen on <date>` suffix. */
	readonly on?: string;
}

/**
 * Whether a token is the bare word `word`, in any case. The length test comes
 * first so that the identifiers of an ordinary line, which this is asked about
 * on every compile, are turned away without a lower-cased copy.
 */
function isWord(token: Token | undefined, word: string): boolean {
	return token !== undefined && token.type === "IDENT" && token.value.length === word.length && token.value.toLowerCase() === word;
}

/**
 * How far from the end of a line `frozen on` is looked for: the suffix and a
 * date the normaliser could not fuse into one token (`on 23 Sep`) fit well
 * inside it, and an ordinary line pays for a handful of comparisons at most.
 */
const DATED_SUFFIX_WINDOW = 6;

/**
 * Whether a token is a multiplication the normaliser inserted rather than one
 * the reader typed. The implicit-multiply rule builds its `*` at the offset of
 * the token it precedes (see `normalizer/BuiltinNormalizerRules.ts`), which a
 * typed `*` never shares with its neighbour.
 */
function isImplicitStar(token: Token, next: Token | undefined): boolean {
	return token.type === "STAR" && next !== undefined && token.offset === next.offset;
}

/**
 * The key a frozen answer is stored under: the operand as written, one space
 * wherever the source had any, without the multiplications the normaliser
 * inserted.
 *
 * Built from each token's `text`, the written form, not its `value`: a date
 * literal's value is the local-midnight instant, which differs between time
 * zones, so a key built from it would not survive a snapshot restored
 * elsewhere.
 */
export function frozenKeyOf(tokens: readonly Token[]): string {
	let key = "";
	let previousEnd = -1;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (isImplicitStar(token, tokens[i + 1])) continue;
		if (key.length > 0 && token.offset > previousEnd) key += " ";
		key += token.text;
		previousEnd = token.sourceEnd ?? token.offset + token.text.length;
	}
	return key;
}

/**
 * Split a line's normalised tokens at a trailing `frozen` or `frozen on
 * <date>`, or return `null` when the line has no such suffix.
 *
 * @param tokens - The line's normalised tokens.
 * @param calendar - The engine's calendar, for reading the date as a day.
 * @throws The date literal's own error when `frozen on` names a day that does
 * not exist (`2026-02-30`), and `FROZEN_DATE_EXPECTED` when what follows
 * `frozen on` is not a date at all, rather than compiling the line as though
 * no day had been given.
 */
export function splitFrozenSuffix(tokens: readonly Token[], calendar: CalendarBackend): FrozenSuffix | null {
	let end = tokens.length;
	let on: string | undefined;

	// `frozen on` is only ever the dated suffix, so whatever follows it has to
	// be the one date it names.
	for (let i = Math.max(1, end - DATED_SUFFIX_WINDOW); i + 1 < end; i++) {
		if (!isWord(tokens[i], "frozen") || !isWord(tokens[i + 1], "on")) continue;
		const date = tokens[i + 2];
		const isDate = date !== undefined && i + 3 === end && (date.type === "DATETIME_LITERAL" || date.type === "DATETIME_LITERAL_UNREADABLE");
		if (!isDate) {
			throw ErrorFactory.parsing(
				"FROZEN_DATE_EXPECTED",
				'"frozen on" needs the day the answer was frozen, written as a date at the end of the line, as in "frozen on 2026-09-23".',
				{ tokenValue: date?.text ?? "" },
			);
		}
		if (date.fault) throw ErrorFactory.parsing(date.fault.code, date.fault.message, { tokenValue: date.text });
		on = isoDayOf(calendar, Number(date.value));
		end = i + 1;
		break;
	}

	if (end < 2 || !isWord(tokens[end - 1], "frozen")) return null;
	const word = tokens[end - 1];
	end -= 1;
	if (isImplicitStar(tokens[end - 1], word)) end -= 1;
	if (end === 0) return null;

	const operand = tokens.slice(0, end);
	return on === undefined ? { operand, key: frozenKeyOf(operand) } : { operand, key: frozenKeyOf(operand), on };
}

/**
 * The directive for a frozen line, from its compiled operand.
 *
 * A frozen line keeps one answer, so its program may define at most one plain
 * variable and only as its last step (`:rate = 1 USD in GBP frozen`); a stored
 * answer then sets that variable in place of the step it skips. A function
 * definition, a global cell, or a second definition on the line have no single
 * answer to keep, and are refused by name at compile time.
 *
 * @param program - The operand's compiled program.
 * @param suffix - The split line.
 * @throws `FROZEN_UNSUPPORTED` for a program that defines a function, writes a
 * global cell, or defines more than one variable.
 */
export function frozenDirectiveFor(program: BytecodeProgram, suffix: FrozenSuffix): FrozenDirective {
	const { opcodes, strings } = program;
	let write: string | undefined;
	for (let i = 0; i < opcodes.length; i = nextInstruction(opcodes, i)) {
		const op = opcodes[i];
		if (op === OpCode.DEFINE_USER_FUNCTION) {
			throw ErrorFactory.parsing(
				"FROZEN_UNSUPPORTED",
				"frozen keeps a line's answer, and a function definition has no answer to keep. Freeze a line that calls the function instead.",
				{ key: suffix.key },
			);
		}
		if (op === OpCode.STORE_GLOBAL_VAR) {
			throw ErrorFactory.parsing(
				"FROZEN_UNSUPPORTED",
				"A global cell (global :name = ...) cannot be frozen, because other documents read it. Freeze a local definition (:name = ... frozen) instead.",
				{ key: suffix.key },
			);
		}
		if (op === OpCode.STORE_VAR) {
			if (write !== undefined || nextInstruction(opcodes, i) !== opcodes.length) {
				throw ErrorFactory.parsing(
					"FROZEN_UNSUPPORTED",
					"frozen keeps one answer per line, and this line defines a value part-way through. Put the definition on a line of its own.",
					{ key: suffix.key },
				);
			}
			write = strings[opcodes[i + 1]];
		}
	}
	const directive: { key: string; on?: string; write?: string } = { key: suffix.key };
	if (suffix.on !== undefined) directive.on = suffix.on;
	if (write !== undefined) directive.write = write;
	return directive;
}
