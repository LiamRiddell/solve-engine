import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { ExpandParselet } from "./parselets/ExpandParselet";
import { FactorParselet } from "./parselets/FactorParselet";
import { SolveParselet } from "./parselets/SolveParselet";
import { DerParselet } from "./parselets/DerParselet";
import { IntegralParselet } from "./parselets/IntegralParselet";
import { TaylorParselet } from "./parselets/TaylorParselet";
import { JacobianParselet } from "./parselets/JacobianParselet";
import { ImaginaryParselet } from "./parselets/ImaginaryParselet";
import { ConjParselet } from "./parselets/ConjParselet";
import { ReParselet } from "./parselets/ReParselet";
import { ImParselet } from "./parselets/ImParselet";
import { CancelParselet } from "./parselets/CancelParselet";
import { imaginaryLiteralNormalizerRule } from "./normalizer/ImaginaryLiteralNormalizerRule";
import { symbolicCallNormalizerRule } from "./normalizer/SymbolicCallNormalizerRule";
import {
	SYMBOLIC_BUILTIN_EXPAND,
	SYMBOLIC_BUILTIN_FACTOR,
	SYMBOLIC_BUILTIN_SOLVE,
	SYMBOLIC_BUILTIN_DER,
	SYMBOLIC_BUILTIN_INTEGRAL,
	SYMBOLIC_BUILTIN_TAYLOR,
	SYMBOLIC_BUILTIN_JACOBIAN,
	SYMBOLIC_BUILTIN_CONJ,
	SYMBOLIC_BUILTIN_RE,
	SYMBOLIC_BUILTIN_IM,
	SYMBOLIC_BUILTIN_CANCEL,
} from "./SymbolicBuiltinIndex";

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
	{
		word: "der",
		tokenType: "DER_FN",
		builtinIndex: SYMBOLIC_BUILTIN_DER,
		example: "der(x^3, x)",
		expected: "3x^2",
		docPage: "calculus.md",
	},
	{
		word: "integral",
		tokenType: "INTEGRAL_FN",
		builtinIndex: SYMBOLIC_BUILTIN_INTEGRAL,
		example: "integral(x^2, x)",
		expected: "1/3x^3",
		docPage: "calculus.md",
	},
	{
		word: "taylor",
		tokenType: "TAYLOR_FN",
		builtinIndex: SYMBOLIC_BUILTIN_TAYLOR,
		example: "taylor(exp(x), x=0, 3)",
		expected: "1/6x^3+0.5x^2+x+1",
		docPage: "calculus.md",
	},
	{
		word: "jacobian",
		tokenType: "JACOBIAN_FN",
		builtinIndex: SYMBOLIC_BUILTIN_JACOBIAN,
		example: "jacobian(x*y, x+y)",
		expected: "= [y, x; 1, 1]",
		docPage: "calculus.md",
	},
	{
		word: "conj",
		tokenType: "CONJ_FN",
		builtinIndex: SYMBOLIC_BUILTIN_CONJ,
		example: "conj(2+3i)",
		expected: "2-3i",
		docPage: "complex.md",
	},
	{
		word: "re",
		tokenType: "RE_FN",
		builtinIndex: SYMBOLIC_BUILTIN_RE,
		example: "re(2+3i)",
		expected: "= 2",
		docPage: "complex.md",
	},
	{
		word: "im",
		tokenType: "IM_FN",
		builtinIndex: SYMBOLIC_BUILTIN_IM,
		example: "im(2+3i)",
		expected: "= 3",
		docPage: "complex.md",
	},
	{
		word: "cancel",
		tokenType: "CANCEL_FN",
		builtinIndex: SYMBOLIC_BUILTIN_CANCEL,
		example: "cancel((x^2-1)/(x-1))",
		expected: "x+1",
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
	normalizerRules: [symbolicCallNormalizerRule(), imaginaryLiteralNormalizerRule()],
	prefixParselets: [
		{ tokenType: "EXPAND_FN", parselet: new ExpandParselet() },
		{ tokenType: "FACTOR_FN", parselet: new FactorParselet() },
		{ tokenType: "SOLVE_FN", parselet: new SolveParselet() },
		{ tokenType: "DER_FN", parselet: new DerParselet() },
		{ tokenType: "INTEGRAL_FN", parselet: new IntegralParselet() },
		{ tokenType: "TAYLOR_FN", parselet: new TaylorParselet() },
		{ tokenType: "JACOBIAN_FN", parselet: new JacobianParselet() },
		{ tokenType: "IMAGINARY", parselet: new ImaginaryParselet() },
		{ tokenType: "CONJ_FN", parselet: new ConjParselet() },
		{ tokenType: "RE_FN", parselet: new ReParselet() },
		{ tokenType: "IM_FN", parselet: new ImParselet() },
		{ tokenType: "CANCEL_FN", parselet: new CancelParselet() },
	],
	tokenCategories: {
		EXPAND_FN: "keyword",
		FACTOR_FN: "keyword",
		SOLVE_FN: "keyword",
		DER_FN: "keyword",
		INTEGRAL_FN: "keyword",
		TAYLOR_FN: "keyword",
		JACOBIAN_FN: "keyword",
		IMAGINARY: "number",
		CONJ_FN: "keyword",
		RE_FN: "keyword",
		IM_FN: "keyword",
		CANCEL_FN: "keyword",
	},
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
