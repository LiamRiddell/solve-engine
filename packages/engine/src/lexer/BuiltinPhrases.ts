/**
 * The engine's own multi-word phrases and the token each one fuses into.
 *
 * One table, read by two consumers: the lexer's token lookup
 * (`lexer/tokenRegistration.ts`) and the normalizer's phrase trie
 * (`engine/ExpressionEngine.ts`, via `normalizer/BuiltinNormalizerRules.ts`).
 * It used to be two hand-copied tables, and they drifted: the lexer's copy
 * never learned "divided by". A phrase added here reaches both.
 *
 * @module BuiltinPhrases
 */

/** Built-in phrase → token type. See the module doc. */
export const BUILTIN_PHRASES: Record<string, string> = {
	"to the power of": "CARET",
	"power of": "CARET",
	"increase by": "INCREASE_BY",
	"decrease by": "DECREASE_BY",
	"times by": "TIMES_BY",
	"multiply by": "MULTIPLY_BY",
	"divide by": "DIVIDE_BY",
	// The past-tense spellings, which is how the operation is usually written
	// out: "3 multiplied by 4". Same tokens, so no new parselets.
	"multiplied by": "MULTIPLY_BY",
	"divided by": "DIVIDE_BY",
};
