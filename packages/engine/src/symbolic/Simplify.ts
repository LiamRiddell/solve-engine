/**
 * Bounded, bottom-up simplification of a {@link SymbolicNode}.
 *
 * ## The invariant that governs this module
 *
 * **`simplifySymbolic` never expands and never factors.** `expandSymbolic()`,
 * `factorSymbolic()` and `toPolynomial()` are separate, explicitly-invoked
 * entry points and are never reachable from here.
 *
 * Concretely, and as enforced by the property test in
 * `__tests__/symbolic/Simplify.spec.ts`:
 *
 * 1. **No distribution.** `(x+1)*(x+2)` and `2*(x+y+1)` come back exactly as
 *    written. This is what "never expands" means, and it is enforced at the
 *    source: {@link collectSum} converts to polynomial form with distribution
 *    disabled, so a product only converts when both sides are single terms.
 *    That is precisely what collecting `2b + 3b` into `5b` needs, and nothing
 *    beyond it.
 * 2. **Idempotent.** Simplifying a result again changes nothing.
 * 3. **Bounded size.** Node count never grows by more than one, and the single
 *    permitted node has one cause: an all-negative sum has no positive term to
 *    lead with, so canonical order needs a `neg` where the input had a negative
 *    constant. It cannot compound, because the result is idempotent.
 *
 * These rules are load-bearing. `vm/VMConversion.ts`'s `binaryOp()` calls this
 * once per symbolic arithmetic operation, so a rule that genuinely grew the
 * tree would compound across a long chain. And rule 1 keeps `pow` safe:
 * `simplify(x^2)` stays `x^2` rather than becoming `x*x`, so a polynomial keeps
 * the compact shape the rest of the system reads.
 *
 * ## What it does
 *
 * - Constant folding over exact rationals, including `pow` with an integer
 *   exponent and a small set of functions with exact rational images.
 * - Additive and multiplicative identities (`x+0`, `x*1`, `x*0`, `x/1`, `--x`,
 *   `x^1`, `x^0`).
 * - Flatten-and-collect of like terms across a top-level sum: a chain of
 *   `+`/`-`/unary `-` over bare constants and bare variable names, so
 *   `1+2+b+3+b` becomes `2b+6`. A `mul`/`div` node is not flattened through.
 * - One narrow exception to that last point: `div` cancels a single common
 *   factor when the denominator is structurally identical to one whole factor
 *   of a top-level product (`sx*tx/sx` becomes `tx`). This exists for
 *   triangular-matrix symbolic inverses and is not a general polynomial
 *   division capability.
 *
 * Function folding is deliberately conservative. `sqrt(4)` folds to `2`
 * because four is a perfect square; **`sqrt(2)` does not fold**, because it has
 * no rational value and inventing `1.4142135624` here is how a system that
 * advertises exact arithmetic starts lying.
 *
 * See `vm/VMConversion.ts`'s `binaryOp()` for where this plugs into the
 * ordinary arithmetic opcodes, and `SymbolicFormat.ts` for display.
 */

import {
	type SymbolicNode,
	constNode,
	varNode,
	nodesEqual,
	nodeCount,
	SYMBOLIC_MAX_NODES,
	complexNode,
} from "@solve-js/symbolic/SymbolicNode";
import {
	type Rational,
	RATIONAL_ZERO,
	RATIONAL_ONE,
	RATIONAL_MINUS_ONE,
	rationalAdd,
	rationalSub,
	rationalMul,
	rationalDiv,
	rationalNeg,
	rationalPow,
	isRationalZero,
	isRationalOne,
	isRationalMinusOne,
	isRationalInteger,
} from "@solve-js/symbolic/Rational";
import { toPolynomial, fromPolynomial } from "@solve-js/symbolic/Polynomial";
import { cancelSymbolic } from "@solve-js/symbolic/Gcd";
import {
	type Complex,
	complex,
	complexAdd,
	complexSub,
	complexMul,
	complexDiv,
	complexNeg,
	complexPow,
	complexConjugate,
	complexNormSquared,
	exactComplexSqrt,
	isComplexZero,
	COMPLEX_I,
} from "@solve-js/symbolic/Complex";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

// ── Flatten-and-collect (top-level sums only) ──────────────────────────────

interface FlatTerm {
	coeff: Rational;
	/** `null` means this term is the accumulated constant. */
	name: string | null;
}

/**
 * Recursively unrolls an `add`/`sub`/`neg` chain into a flat list of signed
 * terms. Returns `false` (callers discard `out` on a `false` return) the moment
 * it meets anything that is not a constant, a bare variable, or another
 * additive node, since collecting terms through a product is out of scope here.
 */
function flattenSum(node: SymbolicNode, negated: boolean, out: FlatTerm[]): boolean {
	switch (node.kind) {
		case "add":
			return flattenSum(node.left, negated, out) && flattenSum(node.right, negated, out);
		case "sub":
			return flattenSum(node.left, negated, out) && flattenSum(node.right, !negated, out);
		case "neg":
			return flattenSum(node.operand, !negated, out);
		case "const":
			out.push({ coeff: negated ? rationalNeg(node.value) : node.value, name: null });
			return true;
		case "var":
			out.push({ coeff: negated ? RATIONAL_MINUS_ONE : RATIONAL_ONE, name: node.name });
			return true;
		default:
			return false;
	}
}

/**
 * Collects like terms in a fully-flattenable `add`/`sub` chain, so
 * `1+2+b+3+b` becomes `2b+6`: variable terms first in first-seen order, then
 * the combined constant last, with a zero-coefficient term dropped entirely to
 * match the `x+0 -> x` identity. Returns `node` unchanged when it is not fully
 * flattenable, which is what keeps a rational-function shape such as
 * `vx/sx-tx` intact.
 */
function collectTerms(node: SymbolicNode): SymbolicNode {
	const flat: FlatTerm[] = [];
	if (!flattenSum(node, false, flat)) return node;

	const order: string[] = [];
	const coeffByName = new Map<string, Rational>();
	let constant = RATIONAL_ZERO;
	for (const term of flat) {
		if (term.name === null) {
			constant = rationalAdd(constant, term.coeff);
			continue;
		}
		const existing = coeffByName.get(term.name);
		if (existing === undefined) {
			order.push(term.name);
			coeffByName.set(term.name, term.coeff);
		} else {
			coeffByName.set(term.name, rationalAdd(existing, term.coeff));
		}
	}

	const termNodes: SymbolicNode[] = [];
	for (const name of order) {
		const coeff = coeffByName.get(name)!;
		if (isRationalZero(coeff)) continue;
		if (isRationalOne(coeff)) termNodes.push(varNode(name));
		else if (isRationalMinusOne(coeff)) termNodes.push({ kind: "neg", operand: varNode(name) });
		else termNodes.push({ kind: "mul", left: constNode(coeff), right: varNode(name) });
	}

	if (termNodes.length === 0) return constNode(constant);

	let result = termNodes[0];
	for (let i = 1; i < termNodes.length; i++) {
		result = { kind: "add", left: result, right: termNodes[i] };
	}
	if (!isRationalZero(constant)) {
		result = { kind: "add", left: result, right: constNode(constant) };
	}
	return result;
}

/**
 * Collects a sum, preferring the canonical polynomial form and falling back to
 * the tree-level {@link collectTerms} when the expression is not a polynomial.
 *
 * The two-step shape is what lets like terms combine through a product
 * (`2b + 3b` becomes `5b`, which the tree walk alone cannot do, since it stops
 * at the first `mul`) without disturbing anything the polynomial form cannot
 * represent. `vx/sx - tx` is a rational function, so `toPolynomial` reports
 * `null` and the original handling runs untouched. That fallback is what keeps
 * symbolic matrix inverses rendering as they always have.
 *
 * Only `add` and `sub` route through here. The `mul` and `div` cases keep their
 * own rules verbatim, including the reciprocal canonicalization and the
 * single-common-factor cancellation, because the polynomial form can express
 * neither.
 *
 * This does not violate the module's no-growth invariant: a polynomial is a
 * collected sum, so the round trip only ever merges terms.
 */
function collectSum(node: SymbolicNode): SymbolicNode {
	// Distribution disabled: collecting like terms must never multiply out a
	// product of sums, which would be expansion by another name.
	const polynomial = toPolynomial(node, false);
	if (polynomial !== null) return fromPolynomial(polynomial);
	return collectTerms(node);
}

// ── Exact function folding ──────────────────────────────────────────────────

/** Greatest integer not exceeding `r`. Bigint division truncates toward zero, so a negative non-integer needs one more step down. */
function rationalFloor(r: Rational): bigint {
	const truncated = r.n / r.d;
	return r.n < 0n && truncated * r.d !== r.n ? truncated - 1n : truncated;
}

/** Exact integer square root, or `null` when `value` is not a perfect square. This is what keeps `sqrt(2)` unfolded. */
function exactSqrt(value: bigint): bigint | null {
	if (value < 0n) return null;
	if (value < 2n) return value;
	let previous = value;
	let current = (value + 1n) / 2n;
	while (current < previous) {
		previous = current;
		current = (previous + value / previous) / 2n;
	}
	return previous * previous === value ? previous : null;
}

/** Largest factorial this will fold. Beyond this the exact result is enormous and the caller almost certainly wants the numeric builtin instead. */
const MAX_FOLDED_FACTORIAL = 500n;

/**
 * Folds a function application whose arguments are all constant, but **only**
 * when the exact result is rational.
 *
 * Returning `null` leaves the call symbolic, which is always the safe answer.
 * Adding a function here that has an irrational result for some rational input
 * would make the simplifier produce a confidently wrong value.
 */
function foldCall(name: string, args: readonly Rational[]): Rational | null {
	const first = args[0];
	switch (name) {
		case "abs":
			return args.length === 1 ? (first.n < 0n ? rationalNeg(first) : first) : null;
		case "sign":
			if (args.length !== 1) return null;
			return first.n === 0n ? RATIONAL_ZERO : { n: first.n < 0n ? -1n : 1n, d: 1n };
		case "floor":
			return args.length === 1 ? { n: rationalFloor(first), d: 1n } : null;
		case "ceil":
			return args.length === 1 ? { n: -rationalFloor(rationalNeg(first)), d: 1n } : null;
		case "trunc":
			return args.length === 1 ? { n: first.n / first.d, d: 1n } : null;
		case "round":
			// Matches Math.round: halfway cases go toward positive infinity.
			return args.length === 1 ? { n: rationalFloor(rationalAdd(first, { n: 1n, d: 2n })), d: 1n } : null;
		case "sqrt": {
			if (args.length !== 1 || first.n < 0n) return null;
			const rootN = exactSqrt(first.n);
			const rootD = exactSqrt(first.d);
			return rootN === null || rootD === null ? null : { n: rootN, d: rootD };
		}
		// Exact values at the points where these functions are rational. Every
		// entry is exact, not rounded, which is what lets a Taylor series about
		// the origin come out with exact coefficients. Deliberately narrow:
		// `sin(1)` and `log(2)` are irrational and must stay symbolic.
		case "sin":
		case "tan":
		case "asin":
		case "atan":
		case "sinh":
		case "tanh":
			return args.length === 1 && isRationalZero(first) ? RATIONAL_ZERO : null;
		case "cos":
		case "exp":
		case "cosh":
			return args.length === 1 && isRationalZero(first) ? RATIONAL_ONE : null;
		case "log":
			return args.length === 1 && isRationalOne(first) ? RATIONAL_ZERO : null;
		case "acos":
			// acos(1) = 0 is the only rational value; acos(0) is pi/2, which is not.
			return args.length === 1 && isRationalOne(first) ? RATIONAL_ZERO : null;
		case "fact": {
			if (args.length !== 1 || !isRationalInteger(first) || first.n < 0n || first.n > MAX_FOLDED_FACTORIAL) return null;
			let total = 1n;
			for (let i = 2n; i <= first.n; i++) total *= i;
			return { n: total, d: 1n };
		}
		default:
			return null;
	}
}

// ── simplify ────────────────────────────────────────────────────────────────

/**
 * Simplifies a symbolic expression bottom-up under this module's stated
 * invariant.
 *
 * Always terminates and is idempotent in structural terms, so it is safe to
 * call repeatedly (once per `binaryOp()`, for instance) without accumulating
 * tree depth across a long chain of operations.
 *
 * @param node - The tree to simplify.
 * @returns The simplified tree, which is never larger than the input.
 * @throws {EngineError} `SYMBOLIC_NODE_LIMIT_EXCEEDED` when the input exceeds
 * {@link SYMBOLIC_MAX_NODES}.
 */
export function simplifySymbolic(node: SymbolicNode): SymbolicNode {
	// The limit is passed through so the walk stops as soon as it is exceeded.
	// Without it a tree far past the ceiling would be counted in full before
	// being rejected, which is the opposite of what a guard is for.
	if (nodeCount(node, SYMBOLIC_MAX_NODES) > SYMBOLIC_MAX_NODES) {
		throw ErrorFactory.execution(
			"SYMBOLIC_NODE_LIMIT_EXCEEDED",
			`This symbolic expression is too large to simplify (over ${SYMBOLIC_MAX_NODES} terms).`,
			{ limit: SYMBOLIC_MAX_NODES },
		);
	}
	return simplifyNode(node);
}

/**
 * Reads a numeric atom as a complex value, so the arithmetic cases can treat a
 * real constant and a complex one uniformly.
 *
 * Returns `null` for anything that is not a literal number, which is what keeps
 * the real fast paths below from being disturbed.
 */
function asComplex(node: SymbolicNode): Complex | null {
	if (node.kind === "complex") return node.value;
	if (node.kind === "const") return complex(node.value);
	return null;
}

/**
 * Folds an arithmetic node whose operands are both literal numbers and at least
 * one of which is complex.
 *
 * Returns `null` when the node is not that shape, leaving every real-only path
 * exactly as it was: a pair of rational constants never reaches this, so
 * ordinary arithmetic pays nothing for complex support.
 */
function foldComplexBinary(kind: "add" | "sub" | "mul" | "div", left: SymbolicNode, right: SymbolicNode): SymbolicNode | null {
	if (left.kind !== "complex" && right.kind !== "complex") return null;
	const a = asComplex(left);
	const b = asComplex(right);
	if (a === null || b === null) return null;
	switch (kind) {
		case "add": return complexNode(complexAdd(a, b));
		case "sub": return complexNode(complexSub(a, b));
		case "mul": return complexNode(complexMul(a, b));
		case "div": return isComplexZero(b) ? null : complexNode(complexDiv(a, b));
	}
}

/**
 * Folds a function whose exact answer is complex.
 *
 * The only entries are the ones whose real-domain versions have a genuine hole:
 * `sqrt` and `abs` of a negative, and the accessors that take a complex value
 * apart. `sqrt(-4)` is exactly `2i`, which the real-only table above had to
 * decline. Anything whose complex value is irrational, `sqrt(i)` for instance,
 * still comes back `null` and stays symbolic.
 *
 * @returns The folded node, or `null` to leave the call alone.
 */
function foldComplexCall(name: string, args: readonly SymbolicNode[]): SymbolicNode | null {
	if (args.length !== 1) return null;
	const value = asComplex(args[0]);
	if (value === null) return null;

	switch (name) {
		case "sqrt": {
			const root = exactComplexSqrt(value);
			if (root !== null) return complexNode(root);
			// A negative real whose magnitude has no rational root is still worth
			// rewriting: `sqrt(-2)` is `sqrt(2)*i`, which pulls the imaginary unit
			// out where the rest of the system can work with it, instead of
			// leaving a square root of a negative number sitting in the tree.
			if (isRationalZero(value.im) && value.re.n < 0n) {
				return {
					kind: "mul",
					left: { kind: "call", name: "sqrt", args: [constNode(rationalNeg(value.re))] },
					right: complexNode(COMPLEX_I),
				};
			}
			return null;
		}
		case "conj":
			return complexNode(complexConjugate(value));
		case "re":
			return constNode(value.re);
		case "im":
			return constNode(value.im);
		case "abs": {
			// |z| is the square root of a rational, so it is only exact when that
			// root is. The real-only table already handles a real argument.
			if (isRationalZero(value.im)) return null;
			const modulus = exactComplexSqrt(complex(complexNormSquared(value)));
			return modulus === null || !isRationalZero(modulus.im) ? null : constNode(modulus.re);
		}
		default:
			return null;
	}
}

/** Recursive worker for {@link simplifySymbolic}, past the one-time size guard. */
function simplifyNode(node: SymbolicNode): SymbolicNode {
	switch (node.kind) {
		case "const":
		case "complex":
		case "var":
			return node;

		case "neg": {
			const operand = simplifyNode(node.operand);
			if (operand.kind === "const") return constNode(rationalNeg(operand.value));
			if (operand.kind === "complex") return complexNode(complexNeg(operand.value));
			if (operand.kind === "neg") return operand.operand;
			return { kind: "neg", operand };
		}

		case "add": {
			const left = simplifyNode(node.left);
			const right = simplifyNode(node.right);
			if (left.kind === "const" && right.kind === "const") return constNode(rationalAdd(left.value, right.value));
			const foldedAdd = foldComplexBinary("add", left, right);
			if (foldedAdd !== null) return foldedAdd;
			if (left.kind === "const" && isRationalZero(left.value)) return right;
			if (right.kind === "const" && isRationalZero(right.value)) return left;
			return collectSum({ kind: "add", left, right });
		}

		case "sub": {
			const left = simplifyNode(node.left);
			const right = simplifyNode(node.right);
			if (left.kind === "const" && right.kind === "const") return constNode(rationalSub(left.value, right.value));
			const foldedSub = foldComplexBinary("sub", left, right);
			if (foldedSub !== null) return foldedSub;
			if (right.kind === "const" && isRationalZero(right.value)) return left;
			if (left.kind === "const" && isRationalZero(left.value)) return simplifyNode({ kind: "neg", operand: right });
			return collectSum({ kind: "sub", left, right });
		}

		case "mul": {
			const left = simplifyNode(node.left);
			const right = simplifyNode(node.right);
			if (left.kind === "const" && right.kind === "const") return constNode(rationalMul(left.value, right.value));
			const foldedMul = foldComplexBinary("mul", left, right);
			if (foldedMul !== null) return foldedMul;
			if ((left.kind === "const" && isRationalZero(left.value)) || (right.kind === "const" && isRationalZero(right.value))) {
				return constNode(RATIONAL_ZERO);
			}
			if (left.kind === "const" && isRationalOne(left.value)) return right;
			if (right.kind === "const" && isRationalOne(right.value)) return left;
			if (left.kind === "const" && isRationalMinusOne(left.value)) return simplifyNode({ kind: "neg", operand: right });
			if (right.kind === "const" && isRationalMinusOne(right.value)) return simplifyNode({ kind: "neg", operand: left });
			// Gather adjacent constant factors: c1*(c2*rest) -> (c1*c2)*rest, and
			// the mirrored shape. Differentiation builds exactly these, so without
			// this the second derivative of x^3 stays as 3*(2*x) rather than 6x.
			// This removes a node rather than adding one, so the module's
			// no-growth invariant still holds.
			if (left.kind === "const" && right.kind === "mul" && right.left.kind === "const") {
				return simplifyNode({ kind: "mul", left: constNode(rationalMul(left.value, right.left.value)), right: right.right });
			}
			if (right.kind === "const" && left.kind === "mul" && left.left.kind === "const") {
				return simplifyNode({ kind: "mul", left: constNode(rationalMul(right.value, left.left.value)), right: left.right });
			}
			// Canonicalize a reciprocal factor into division: (1/a)*b -> b/a,
			// a*(1/b) -> a/b. A narrow display-canonicalization rule, needed
			// because matrix multiply builds cells as mul(entry, entry) in
			// encounter order, so a symbolic inverse's `1/sx` entry times a `vx`
			// cell produces `(1/sx)*vx` rather than the spec's own `vx/sx`,
			// mathematically identical but a different tree shape. Not a general
			// reciprocal-detection rule: it fires only when a factor is literally
			// `1/x`, never an arbitrary fraction.
			if (left.kind === "div" && left.left.kind === "const" && isRationalOne(left.left.value)) {
				return simplifyNode({ kind: "div", left: right, right: left.right });
			}
			if (right.kind === "div" && right.left.kind === "const" && isRationalOne(right.left.value)) {
				return simplifyNode({ kind: "div", left, right: right.right });
			}
			return { kind: "mul", left, right };
		}

		case "div": {
			const left = simplifyNode(node.left);
			const right = simplifyNode(node.right);
			// A constant denominator of zero is left unfolded rather than folded
			// or thrown. The previous double-based simplifier folded `1/0` to
			// `Infinity`; a Rational has no such value, and throwing from inside
			// a bottom-up walk would fail the whole line over a subexpression the
			// user may never see. Leaving `1/0` intact reports the situation
			// honestly and lets the caller decide.
			if (left.kind === "const" && right.kind === "const" && !isRationalZero(right.value)) {
				return constNode(rationalDiv(left.value, right.value));
			}
			const foldedDiv = foldComplexBinary("div", left, right);
			if (foldedDiv !== null) return foldedDiv;
			if (right.kind === "const" && isRationalOne(right.value)) return left;
			if (left.kind === "const" && isRationalZero(left.value)) return constNode(RATIONAL_ZERO);
			// Cancel a single common factor: (a*b)/a -> b, (a*b)/b -> a. A narrow,
			// disclosed exception to "never collects through mul/div", needed for
			// the symbolic triangular-matrix-inverse case (`sx*tx/sx -> tx`). It
			// fires only when the denominator is structurally identical to one
			// whole factor of a top-level product, never a partial or nested match.
			if (left.kind === "mul") {
				if (nodesEqual(left.left, right)) return left.right;
				if (nodesEqual(left.right, right)) return left.left;
			}
			// Cancel a genuine common polynomial factor, so `(x^2-1)/(x-1)` reduces
			// to `x+1`. This is contraction rather than expansion: the result is
			// always smaller, so the no-growth invariant holds. A rational function
			// in more than one variable, `vx/sx`, has no univariate gcd and comes
			// back untouched.
			const cancelled = cancelSymbolic({ kind: "div", left, right });
			if (cancelled.kind !== "div" || cancelled.left !== left || cancelled.right !== right) {
				return simplifyNode(cancelled);
			}
			// The same cancellation through a leading minus: -(a*b)/a -> -b.
			// Without this the rule is asymmetric, and a quadratic's two surd
			// roots render differently from each other: `sqrt(2)` for the one
			// that cancelled and `-2*sqrt(2)/2` for the one that did not.
			if (left.kind === "neg" && left.operand.kind === "mul") {
				const product = left.operand;
				if (nodesEqual(product.left, right)) return simplifyNode({ kind: "neg", operand: product.right });
				if (nodesEqual(product.right, right)) return simplifyNode({ kind: "neg", operand: product.left });
			}
			return { kind: "div", left, right };
		}

		case "pow": {
			const base = simplifyNode(node.base);
			const exponent = simplifyNode(node.exponent);

			if (exponent.kind === "const") {
				if (isRationalZero(exponent.value)) return constNode(RATIONAL_ONE);
				if (isRationalOne(exponent.value)) return base;
				if (base.kind === "const" && isRationalInteger(exponent.value)) {
					return constNode(rationalPow(base.value, exponent.value.n));
				}
				if (base.kind === "complex" && isRationalInteger(exponent.value)) {
					return complexNode(complexPow(base.value, exponent.value.n));
				}
			}
			if (base.kind === "const" && isRationalOne(base.value)) return constNode(RATIONAL_ONE);
			// 0^x is zero only for a positive exponent. 0^0 is one (handled
			// above) and 0^-1 is a division by zero, so neither may reach here.
			if (base.kind === "const" && isRationalZero(base.value) && exponent.kind === "const" && exponent.value.n > 0n) {
				return constNode(RATIONAL_ZERO);
			}
			// (a^b)^c -> a^(b*c) is unsound in general (it loses a branch for a
			// negative base with fractional exponents), so it is allowed only
			// when both exponents are integers, where it always holds.
			if (
				base.kind === "pow" &&
				base.exponent.kind === "const" &&
				exponent.kind === "const" &&
				isRationalInteger(base.exponent.value) &&
				isRationalInteger(exponent.value)
			) {
				return simplifyNode({
					kind: "pow",
					base: base.base,
					exponent: constNode(rationalMul(base.exponent.value, exponent.value)),
				});
			}
			return { kind: "pow", base, exponent };
		}

		case "call": {
			const args = node.args.map(simplifyNode);
			if (args.every(arg => arg.kind === "const")) {
				const folded = foldCall(node.name, args.map(arg => (arg as { kind: "const"; value: Rational }).value));
				if (folded !== null) return constNode(folded);
			}
			const complexFolded = foldComplexCall(node.name, args);
			if (complexFolded !== null) return complexFolded;
			return { kind: "call", name: node.name, args };
		}
	}
}
