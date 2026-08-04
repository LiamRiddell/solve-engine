import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { ExpandParselet } from "./parselets/ExpandParselet";
import { FactorParselet } from "./parselets/FactorParselet";
import { SolveParselet } from "./parselets/SolveParselet";
import { symbolicCallNormalizerRule } from "./normalizer/SymbolicCallNormalizerRule";
import { SYMBOLIC_BUILTIN_EXPAND, SYMBOLIC_BUILTIN_FACTOR, SYMBOLIC_BUILTIN_SOLVE } from "./SymbolicBuiltinIndex";

/**
 * One algebra verb's whole surface, in a single row.
 *
 * Everything a verb needs in order to work is listed here rather than being
 * spread across the normalizer, the parselet registry, the builtin table and
 * the docs, so `__tests__/engine/SymbolicSurfaceParity.spec.ts` can check the
 * pieces actually agree. Shipping a verb whose index has no implementation, or
 * whose parselet is registered under a token type the normalizer never mints,
 * then becomes a failing test rather than a silent dead feature.
 */
export interface SymbolicFunctionSurface {
	/** The bare word a user types. */
	readonly word: string;
	/** The token type the normalizer fuses it into when it is followed by `(`. */
	readonly tokenType: string;
	/** The `CALL_BUILTIN` index its parselet emits. */
	readonly builtinIndex: number;
	/** A working example, executed by the parity spec through every public entry point. */
	readonly example: string;
	/** That example's expected formatted result. */
	readonly expected: string;
	/** The documentation page under `docs/src/content/docs/syntax/` that must show it. */
	readonly docPage: string;
}

/** Every algebra verb this package registers. */
export const SYMBOLIC_FUNCTIONS: readonly SymbolicFunctionSurface[] = [
	{
		word: "expand",
		tokenType: "EXPAND_FN",
		builtinIndex: SYMBOLIC_BUILTIN_EXPAND,
		example: "expand((x+1)*(x+2))",
		expected: "x^2+3x+2",
		docPage: "algebra.md",
	},
	{
		word: "factor",
		tokenType: "FACTOR_FN",
		builtinIndex: SYMBOLIC_BUILTIN_FACTOR,
		example: "factor(x^2-4)",
		expected: "(x-2)*(x+2)",
		docPage: "algebra.md",
	},
	{
		word: "solve",
		tokenType: "SOLVE_FN",
		builtinIndex: SYMBOLIC_BUILTIN_SOLVE,
		example: "solve(x^2-4=0, x)",
		expected: "= [-2, 2]",
		docPage: "algebra.md",
	},
];

/**
 * Symbolic algebra verbs: multiplying out, and (in later phases) factoring,
 * solving and calculus.
 *
 * The algebra itself lives in `symbolic/`, which is pure mathematics over the
 * expression tree. This package is only the grammar surface: which words become
 * which tokens, and which parselet emits which builtin call.
 *
 * None of these words is a bare `keywordMap` entry. See
 * `normalizer/SymbolicCallNormalizerRule.ts` for why that matters.
 */
export const SYMBOLIC_PACKAGE: IEnginePackage = {
	name: "solve-symbolic",
	normalizerRules: [symbolicCallNormalizerRule()],
	prefixParselets: [
		{ tokenType: "EXPAND_FN", parselet: new ExpandParselet() },
		{ tokenType: "FACTOR_FN", parselet: new FactorParselet() },
		{ tokenType: "SOLVE_FN", parselet: new SolveParselet() },
	],
	tokenCategories: { EXPAND_FN: "keyword", FACTOR_FN: "keyword", SOLVE_FN: "keyword" },
};

/** The token types the algebra verbs fuse into, for the engine's own "is this line symbolic" check. */
const SYMBOLIC_TOKEN_TYPES: ReadonlySet<string> = new Set(SYMBOLIC_FUNCTIONS.map(fn => fn.tokenType));

/**
 * Whether a normalized token list calls an algebra verb.
 *
 * `engine/ExpressionEngine.ts` uses this to evaluate such a line in
 * symbolic-tolerant mode without requiring a trailing `=>`, since asking to
 * expand or factor something is already a statement that its unknowns are meant
 * to stay unknown.
 *
 * @param tokens - The normalized tokens for one line.
 * @returns True when any token is an algebra verb.
 */
export function containsSymbolicCall(tokens: readonly { type: string }[]): boolean {
	return tokens.some(token => SYMBOLIC_TOKEN_TYPES.has(token.type));
}
