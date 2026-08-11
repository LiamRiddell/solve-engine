/**
 * The grammar's vocabulary, read from the engine rather than typed out.
 *
 * A generator built from a hand-written word list starts out incomplete and
 * gets worse with every feature added, and nothing fails when it does: the
 * fuzzer keeps passing, having quietly stopped testing whole packages. That is
 * the failure mode this module exists to prevent. Every word, unit, function
 * name, phrase and operator below is pulled at run time from the same data the
 * engine itself uses:
 *
 * - words and their token types from the locale's `keywordMap`
 * - units from `lexer/units.ts`'s derived `knownUnits`
 * - phrases from the normaliser's `BUILTIN_PHRASES` and from each package's own
 *   `phrases` declaration
 * - operators and extra units from each package's `lexerVocabulary`
 * - builtin function indices from `vm/VMBuiltins.ts`, with their arity probed
 *   through `builtinArityError()` rather than copied
 * - the set of token types that actually have a parselet, from a live engine's
 *   `getParseletRegistry()`
 *
 * Adding a package therefore widens what the fuzzer generates on the next run,
 * with no edit here.
 *
 * @module Vocabulary
 */

import { enLocale } from "@solve-js/constants/locales/en";
import { knownUnits } from "@solve-js/lexer/units";
import { BUILTIN_PHRASES } from "@solve-js/normalizer";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { builtinFunctions } from "@solve-js/vm/VMBuiltins";
import { builtinArityError } from "@solve-js/vm/VMBuiltinArity";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/** One builtin the VM can call, with the argument counts it will accept. */
export interface BuiltinSignature {
	/** The operand `CALL_BUILTIN` carries. */
	index: number;
	/** Smallest accepted argument count. */
	minArgs: number;
	/** Largest accepted argument count, or `Infinity` for a variadic one. */
	maxArgs: number;
}

/** Everything the expression generator draws from. */
export interface Vocabulary {
	/** Every word the lexer knows, grouped by the token type it produces. */
	wordsByTokenType: ReadonlyMap<string, readonly string[]>;
	/** Function-call names, the words whose token type is FUNC. */
	functionNames: readonly string[];
	/** Unit spellings the lexer will turn into a UNIT token. */
	units: readonly string[];
	/** The subset of units that are currency codes or currency words, which take a different grammar. */
	currencyUnits: readonly string[];
	/** Multi-word phrases the normaliser fuses, from the built-in table and every package. */
	phrases: readonly string[];
	/** Multi-character operators any package registered, plus the built-in ones. */
	operators: readonly string[];
	/** Every token type that has a prefix parselet on a real engine. */
	prefixTokenTypes: readonly string[];
	/** Every token type that has an infix parselet on a real engine. */
	infixTokenTypes: readonly string[];
	/** Callable builtins with their probed arity. */
	builtins: readonly BuiltinSignature[];
	/** Plugin function indices any built-in package registered, for `CALL_PLUGIN` operands. */
	pluginFunctionIndices: readonly number[];
}

/**
 * The largest argument count worth probing before calling a builtin variadic.
 *
 * The arity table's variadic entries use `Infinity`, so any finite probe that
 * still succeeds proves nothing on its own. Eight is past every fixed arity in
 * the table with room to spare, so a builtin that accepts eight accepts any
 * number.
 */
const VARIADIC_PROBE = 8;

/**
 * Work out a builtin's accepted argument counts by asking the engine.
 *
 * `vm/VMBuiltinArity.ts` keeps the table private and exposes only the check, so
 * this probes the check rather than duplicating the table. A copied table would
 * be one more thing to keep in sync, and the whole point of this module is to
 * have none of those.
 *
 * @param index - The builtin's index.
 * @returns Its accepted range, or `null` when no argument count is accepted
 * (which would mean the table and the function table disagree).
 */
function probeArity(index: number): BuiltinSignature | null {
	let minArgs = -1;
	for (let count = 0; count <= VARIADIC_PROBE; count++) {
		if (!builtinArityError(index, count)) {
			minArgs = count;
			break;
		}
	}
	if (minArgs < 0) return null;

	if (!builtinArityError(index, VARIADIC_PROBE)) {
		return { index, minArgs, maxArgs: Infinity };
	}
	let maxArgs = minArgs;
	for (let count = minArgs + 1; count <= VARIADIC_PROBE; count++) {
		if (builtinArityError(index, count)) break;
		maxArgs = count;
	}
	return { index, minArgs, maxArgs };
}

/**
 * The currency spellings, told apart from ordinary units by shape.
 *
 * `lexer/units.ts` keeps currencies in the same set as units on purpose (both
 * become UNIT tokens), but they behave differently downstream: a currency
 * routes through an async exchange-rate resolver and a unit does not. The
 * generator wants to reach both deliberately, so they are split here by the one
 * property that distinguishes them without a second hand-written list: an ISO
 * 4217 code is three upper-case letters.
 */
function isCurrencyCode(spelling: string): boolean {
	return /^[A-Z]{3,4}$/.test(spelling);
}

/** Built-in multi-character operators, which have no declaration to read. */
const BUILTIN_OPERATORS: readonly string[] = ["==", "!=", ">=", "<=", "<<", ">>", ">>>", "&&", "||"];

/**
 * Build the vocabulary from a live engine and the modules it is made of.
 *
 * @param engine - A constructed engine, consulted for its parselet registry.
 * Passing one that was built with a filtered package list narrows the
 * vocabulary to match, which is what makes this usable for testing a subset.
 * @returns Everything the expression generator needs.
 */
export function buildVocabulary(engine: ExpressionEngine): Vocabulary {
	const wordsByTokenType = new Map<string, string[]>();
	const addWord = (tokenType: string, word: string): void => {
		const existing = wordsByTokenType.get(tokenType);
		if (existing) existing.push(word);
		else wordsByTokenType.set(tokenType, [word]);
	};

	for (const [word, tokenType] of Object.entries(enLocale.keywordMap)) addWord(tokenType, word);

	const phrases = new Set<string>(Object.keys(BUILTIN_PHRASES));
	const operators = new Set<string>(BUILTIN_OPERATORS);
	const extraUnits = new Set<string>();
	const pluginFunctionIndices = new Set<number>();

	for (const pkg of BUILTIN_PACKAGES) {
		for (const [phrase, tokenType] of Object.entries(pkg.phrases ?? {})) {
			phrases.add(phrase);
			addWord(tokenType, phrase);
		}
		for (const [word, tokenType] of Object.entries(pkg.lexerVocabulary?.keywords ?? {})) addWord(tokenType, word);
		for (const chars of Object.keys(pkg.lexerVocabulary?.operators ?? {})) operators.add(chars);
		for (const unit of pkg.lexerVocabulary?.units ?? []) extraUnits.add(unit);
		for (const fn of pkg.pluginFunctions ?? []) pluginFunctionIndices.add(fn.index);
	}

	const units = [...knownUnits, ...extraUnits];
	const registry = engine.getParseletRegistry();

	const builtins: BuiltinSignature[] = [];
	for (const key of Object.keys(builtinFunctions)) {
		const signature = probeArity(Number(key));
		if (signature) builtins.push(signature);
	}

	return {
		wordsByTokenType,
		functionNames: wordsByTokenType.get("FUNC") ?? [],
		units,
		currencyUnits: units.filter(isCurrencyCode),
		phrases: [...phrases],
		operators: [...operators],
		prefixTokenTypes: registry.prefix.map((entry) => entry.tokenType),
		infixTokenTypes: registry.infix.map((entry) => entry.tokenType),
		builtins,
		pluginFunctionIndices: [...pluginFunctionIndices],
	};
}

/**
 * Words of a given token type, or an empty list when the engine has none.
 *
 * A convenience so the generator's productions can name a token type without
 * each one guarding against a package having been filtered out.
 *
 * @param vocabulary - The built vocabulary.
 * @param tokenType - The token type to look up.
 * @returns The words, possibly empty.
 */
export function wordsOf(vocabulary: Vocabulary, tokenType: string): readonly string[] {
	return vocabulary.wordsByTokenType.get(tokenType) ?? [];
}
