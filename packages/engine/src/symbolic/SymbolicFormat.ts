/**
 * Rendering a {@link SymbolicNode} as display text.
 *
 * The conventions here match how the expressions are written rather than how
 * the tree is shaped: a coefficient juxtaposes its variable with no operator
 * (`2b`, not `2*b`), sums join with the correct sign (`2b+6` and `x-3`, never
 * `2b+-6`), and parentheses appear only where precedence genuinely needs them.
 *
 * This module does not simplify. Call `simplifySymbolic()` first for a
 * canonical, minimal rendering.
 */

import type { SymbolicNode } from "@solve-js/symbolic/SymbolicNode";
import { type Rational, formatRational } from "@solve-js/symbolic/Rational";
import { formatComplex } from "@solve-js/symbolic/Complex";

/** Extracts `{coeff, name}` from a `const*var` or `var*const` shape, or `null` when `node` is not one. */
function tryExtractCoeffVar(node: SymbolicNode & { kind: "mul" }): { coeff: Rational; name: string } | null {
	if (node.left.kind === "const" && node.right.kind === "var") return { coeff: node.left.value, name: node.right.name };
	if (node.right.kind === "const" && node.left.kind === "var") return { coeff: node.right.value, name: node.left.name };
	return null;
}

/** Extracts `{coeff, power}` from a `const*pow` or `pow*const` shape, so `2x^2` renders without an asterisk. */
function tryExtractCoeffPow(node: SymbolicNode & { kind: "mul" }): { coeff: Rational; power: SymbolicNode } | null {
	if (node.left.kind === "const" && node.right.kind === "pow") return { coeff: node.left.value, power: node.right };
	if (node.right.kind === "const" && node.left.kind === "pow") return { coeff: node.right.value, power: node.left };
	return null;
}

/** Whether a node renders as a single indivisible token, so an exponent can follow it without parentheses. */
function isAtomic(node: SymbolicNode): boolean {
	if (node.kind === "var" || node.kind === "call") return true;
	// A negative constant needs brackets under an exponent: `-2^2` parses as
	// `-(2^2)`, which is a different value from `(-2)^2`.
	return node.kind === "const" && node.value.n >= 0n;
}

/** Renders `coeff` immediately followed by `text`, collapsing the 1 and -1 cases the way a person writes them. */
function formatCoefficient(coeff: Rational, text: string): string {
	if (coeff.n === 1n && coeff.d === 1n) return text;
	if (coeff.n === -1n && coeff.d === 1n) return `-${text}`;
	return `${formatRational(coeff)}${text}`;
}

/**
 * How deep the printer will walk before eliding the rest.
 *
 * This walk and {@link collectDisplayTerms} call each other down the tree with
 * nothing counting the levels, so the native stack was the only bound on
 * either, and it is reached at about 1,170 levels (measured, three frames per
 * level). `SYMBOLIC_MAX_NODES` admits ten thousand nodes, and for a chain size
 * and depth are the same number, so there was a wide band of trees the engine
 * called legal and could not print. What came out of that band was a raw
 * `RangeError` reading "Maximum call stack size exceeded", from `formatValue()`
 * of all places, which is the one call a host makes to render an answer it has
 * already been given and therefore the one it is least likely to have wrapped
 * in a `try`.
 *
 * About half the measured limit rather than the quarter that would be
 * comfortable, because an expression five hundred levels deep must still print
 * in full (pinned in `__tests__/hardening/DenialOfServiceRecursionDepth.spec.ts`)
 * and a printer that elides what it can render is its own kind of wrong answer.
 * {@link formatSymbolic} therefore also catches the overflow itself, so the
 * margin being wrong somewhere with less stack to spare degrades the display
 * rather than escaping as a RangeError.
 *
 * Eliding rather than throwing, because the caller asked to display a value and
 * an ellipsis is a display. It is also honest in a way silent truncation would
 * not be: the marker says the text is not the whole tree.
 */
const MAX_FORMAT_DEPTH = 600;

/** What stands in for the part of a tree too deep to print. */
const ELIDED = "...";

/**
 * Formats a factor, wrapping a nested sum in parentheses, which is needed
 * whenever it appears inside a `mul`, `div`, `neg` or `pow`.
 */
function formatFactor(node: SymbolicNode, depth: number): string {
	if (depth >= MAX_FORMAT_DEPTH) return ELIDED;
	switch (node.kind) {
		case "const":
			return formatRational(node.value);
		case "complex":
			// Only a value with BOTH parts is a sum, and only a sum needs brackets
			// inside a product: `(2+3i)*x` but `sqrt(2)*i`. Bracketing every
			// complex would make the common imaginary-only case read as `(i)`.
			return node.value.re.n !== 0n && node.value.im.n !== 0n
				? `(${formatComplex(node.value)})`
				: formatComplex(node.value);
		case "var":
			return node.name;
		case "add":
		case "sub":
			// Not `depth + 1`: this hands the SAME node to the sum printer, and
			// the counter has to measure tree levels rather than call frames, or
			// a five-hundred-level expression would be elided at two hundred and
			// fifty. Every other recursion below descends into a child, and
			// those do count.
			return `(${formatSum(node, depth)})`;
		case "neg":
			return `-${formatFactor(node.operand, depth + 1)}`;
		case "call":
			// Written as an arrow rather than passing `formatSum` to `map`
			// directly: `map` calls its callback with the index as a second
			// argument, which would arrive here as the depth.
			return `${node.name}(${node.args.map(arg => formatSum(arg, depth + 1)).join(", ")})`;
		case "pow": {
			const base = isAtomic(node.base) ? formatFactor(node.base, depth + 1) : `(${formatSum(node.base, depth + 1)})`;
			// An exponent that is itself compound needs brackets, since `x^n+1`
			// would otherwise read as `(x^n)+1`.
			const exponent = isAtomic(node.exponent) ? formatFactor(node.exponent, depth + 1) : `(${formatSum(node.exponent, depth + 1)})`;
			return `${base}^${exponent}`;
		}
		case "mul": {
			const coeffVar = tryExtractCoeffVar(node);
			if (coeffVar) return formatCoefficient(coeffVar.coeff, coeffVar.name);
			const coeffPow = tryExtractCoeffPow(node);
			if (coeffPow) return formatCoefficient(coeffPow.coeff, formatFactor(coeffPow.power, depth + 1));
			// A coefficient on a longer monomial juxtaposes too, so `2*x*y`
			// renders `2x*y`, consistent with `2b` and `2x^2` above. Only the
			// leading coefficient collapses; the `*` between distinct variables
			// stays, matching how the rest of the engine writes products.
			//
			// The digit guard is not cosmetic. Juxtaposing onto text that itself
			// starts with a digit produces a different number: `3*(2*x)` would
			// render as `32x`, which reads as thirty-two x. Such a shape should
			// have been folded to `6x` by the simplifier, so this is a safety net
			// rather than the normal path, but a formatter must never be able to
			// print one value as another.
			if (node.left.kind === "const" && node.right.kind === "mul") {
				const inner = formatFactor(node.right, depth + 1);
				if (!/^[\d.]/.test(inner)) return formatCoefficient(node.left.value, inner);
			}
			return `${formatFactor(node.left, depth + 1)}*${formatFactor(node.right, depth + 1)}`;
		}
		case "div": {
			// A denominator that is itself a product or a quotient must be
			// bracketed. Without this, `1/(2*sqrt(x))` prints as `1/2*sqrt(x)`,
			// which reads back as `(1/2)*sqrt(x)`, a different number: at x=9 the
			// tree is 1/6 and the text says 1.5. `a/(b/c)` had the same problem,
			// printing `a/b/c`, which regroups left-to-right into `(a/b)/c`.
			// A sum or difference is already bracketed by formatFactor itself, and
			// a power binds tighter than division so `1/x^2` needs nothing.
			const denominator = formatFactor(node.right, depth + 1);
			const needsBrackets = node.right.kind === "mul" || node.right.kind === "div";
			return `${formatFactor(node.left, depth + 1)}/${needsBrackets ? `(${denominator})` : denominator}`;
		}
	}
}

/**
 * Collects a possibly-unsimplified `add`/`sub`/`neg` chain into signed display
 * terms. Mirrors the simplifier's own `flattenSum` traversal, but tolerant:
 * a `mul`/`div`/`pow`/`call` subtree becomes one opaque signed term via
 * {@link formatFactor} rather than aborting the whole walk.
 */
function collectDisplayTerms(node: SymbolicNode, negated: boolean, out: { negated: boolean; text: string }[], depth: number): void {
	if (depth >= MAX_FORMAT_DEPTH) {
		out.push({ negated, text: ELIDED });
		return;
	}
	switch (node.kind) {
		case "add":
			collectDisplayTerms(node.left, negated, out, depth + 1);
			collectDisplayTerms(node.right, negated, out, depth + 1);
			return;
		case "sub":
			collectDisplayTerms(node.left, negated, out, depth + 1);
			collectDisplayTerms(node.right, !negated, out, depth + 1);
			return;
		case "neg":
			collectDisplayTerms(node.operand, !negated, out, depth + 1);
			return;
		case "const": {
			// An embedded zero term contributes nothing to the display.
			if (node.value.n === 0n) return;
			const isNegative = node.value.n < 0n;
			const magnitude = isNegative ? { n: -node.value.n, d: node.value.d } : node.value;
			out.push({ negated: isNegative !== negated, text: formatRational(magnitude) });
			return;
		}
		case "complex": {
			// Split into two display terms so a complex at the top level joins the
			// surrounding sum naturally: `2+3i` and `-1-2i` rather than a single
			// bracketed blob. The bracketing in formatFactor is for when a complex
			// sits inside a product, where it genuinely needs it.
			const { re, im } = node.value;
			if (re.n !== 0n) {
				const negativeReal = re.n < 0n;
				out.push({ negated: negativeReal !== negated, text: formatRational(negativeReal ? { n: -re.n, d: re.d } : re) });
			}
			if (im.n !== 0n) {
				const negativeImaginary = im.n < 0n;
				const magnitude = negativeImaginary ? { n: -im.n, d: im.d } : im;
				const text = magnitude.n === 1n && magnitude.d === 1n ? "i" : `${formatRational(magnitude)}i`;
				out.push({ negated: negativeImaginary !== negated, text });
			}
			return;
		}
		default: {
			// Same node, so same depth. See formatFactor's add/sub case.
			const text = formatFactor(node, depth);
			// A product or quotient whose leading coefficient is negative renders
			// with the minus already inside it, and joining that to a sum with `+`
			// gives `0.5*log(x-1)+-0.5*log(x+1)`. Lifting the sign out turns it back
			// into the subtraction it is. Only these two kinds: for a `pow` a leading
			// minus belongs to the base rather than to the whole factor, so `-2^2`
			// must not become a subtracted `2^2`.
			const liftsSign = (node.kind === "mul" || node.kind === "div") && text.startsWith("-");
			if (liftsSign) out.push({ negated: !negated, text: text.slice(1) });
			else out.push({ negated, text });
		}
	}
}

/**
 * Renders a symbolic expression as display text.
 *
 * @param node - The tree to render.
 * @returns The display string. An expression whose terms all cancel renders as
 * `"0"` rather than as an empty string.
 */
export function formatSymbolic(node: SymbolicNode): string {
	try {
		return formatSum(node, 0);
	} catch (thrown) {
		// The depth guard above is what normally stops this, and this is the
		// backstop for it being set half a stack away from the native limit: a
		// caller that has already spent stack of its own can run out inside a
		// tree the guard would have allowed. A stack overflow is a RangeError
		// rather than an EngineError, so a host cannot tell it from a bug in its
		// own code, and it arrives through `formatValue()`, which is a request
		// to display an answer and has no business throwing. Nothing else is
		// swallowed: any other error is the caller's to see.
		if (thrown instanceof RangeError) return ELIDED;
		throw thrown;
	}
}

/**
 * The body of {@link formatSymbolic}, carrying how deep the walk already is.
 *
 * Split out so the public entry point keeps its one-argument signature: it is
 * exported, and a second parameter on it would be filled in by anything that
 * passes it to `Array.prototype.map`.
 */
function formatSum(node: SymbolicNode, depth: number): string {
	const terms: { negated: boolean; text: string }[] = [];
	collectDisplayTerms(node, false, terms, depth);
	if (terms.length === 0) return "0";

	let out = "";
	terms.forEach((term, index) => {
		if (index === 0) out += term.negated ? `-${term.text}` : term.text;
		else out += term.negated ? `-${term.text}` : `+${term.text}`;
	});
	return out;
}
