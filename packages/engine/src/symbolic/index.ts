/**
 * The symbolic algebra (computer algebra) core.
 *
 * Pure mathematics over {@link SymbolicNode}: exact rational arithmetic, tree
 * simplification, and display. This module deliberately imports nothing from
 * `lexer/`, `parser/`, `vm/` or `engine/`, so it can be reasoned about and
 * tested in isolation.
 *
 * The layering is worth stating, because it is why this lives here rather than
 * in `packages/`. `vm/Value.ts` embeds a `SymbolicNode` in its own value union
 * and its `MatrixEntry` type, so the node type is core VM data. A language
 * package may import from `parser/`, never the other way around, so putting
 * this type inside `packages/` would invert the dependency graph for one of the
 * engine's most central types.
 *
 * The grammar surface that exposes these operations to a user (`expand(`,
 * `factor(`, `solve(`, and the calculus verbs) lives separately in
 * `packages/symbolic/`, which depends on this module.
 */

export {
	type Rational,
	RATIONAL_ZERO,
	RATIONAL_ONE,
	RATIONAL_MINUS_ONE,
	RATIONAL_MAX_BITS,
	rational,
	rationalFromNumber,
	rationalToNumber,
	rationalAdd,
	rationalSub,
	rationalMul,
	rationalDiv,
	rationalNeg,
	rationalPow,
	rationalCompare,
	isRationalZero,
	isRationalOne,
	isRationalMinusOne,
	isRationalInteger,
	formatRational,
} from "@solve-js/symbolic/Rational";

export {
	type SymbolicNode,
	SYMBOLIC_MAX_NODES,
	constNode,
	varNode,
	powNode,
	callNode,
	symbolicKey,
	nodesEqual,
	nodeCount,
	freeVariables,
} from "@solve-js/symbolic/SymbolicNode";

export { simplifySymbolic } from "@solve-js/symbolic/Simplify";

export { formatSymbolic } from "@solve-js/symbolic/SymbolicFormat";
