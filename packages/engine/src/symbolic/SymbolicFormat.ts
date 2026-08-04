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
 * Formats a factor, wrapping a nested sum in parentheses, which is needed
 * whenever it appears inside a `mul`, `div`, `neg` or `pow`.
 */
function formatFactor(node: SymbolicNode): string {
	switch (node.kind) {
		case "const":
			return formatRational(node.value);
		case "var":
			return node.name;
		case "add":
		case "sub":
			return `(${formatSymbolic(node)})`;
		case "neg":
			return `-${formatFactor(node.operand)}`;
		case "call":
			return `${node.name}(${node.args.map(formatSymbolic).join(", ")})`;
		case "pow": {
			const base = isAtomic(node.base) ? formatFactor(node.base) : `(${formatSymbolic(node.base)})`;
			// An exponent that is itself compound needs brackets, since `x^n+1`
			// would otherwise read as `(x^n)+1`.
			const exponent = isAtomic(node.exponent) ? formatFactor(node.exponent) : `(${formatSymbolic(node.exponent)})`;
			return `${base}^${exponent}`;
		}
		case "mul": {
			const coeffVar = tryExtractCoeffVar(node);
			if (coeffVar) return formatCoefficient(coeffVar.coeff, coeffVar.name);
			const coeffPow = tryExtractCoeffPow(node);
			if (coeffPow) return formatCoefficient(coeffPow.coeff, formatFactor(coeffPow.power));
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
				const inner = formatFactor(node.right);
				if (!/^[\d.]/.test(inner)) return formatCoefficient(node.left.value, inner);
			}
			return `${formatFactor(node.left)}*${formatFactor(node.right)}`;
		}
		case "div":
			return `${formatFactor(node.left)}/${formatFactor(node.right)}`;
	}
}

/**
 * Collects a possibly-unsimplified `add`/`sub`/`neg` chain into signed display
 * terms. Mirrors the simplifier's own `flattenSum` traversal, but tolerant:
 * a `mul`/`div`/`pow`/`call` subtree becomes one opaque signed term via
 * {@link formatFactor} rather than aborting the whole walk.
 */
function collectDisplayTerms(node: SymbolicNode, negated: boolean, out: { negated: boolean; text: string }[]): void {
	switch (node.kind) {
		case "add":
			collectDisplayTerms(node.left, negated, out);
			collectDisplayTerms(node.right, negated, out);
			return;
		case "sub":
			collectDisplayTerms(node.left, negated, out);
			collectDisplayTerms(node.right, !negated, out);
			return;
		case "neg":
			collectDisplayTerms(node.operand, !negated, out);
			return;
		case "const": {
			// An embedded zero term contributes nothing to the display.
			if (node.value.n === 0n) return;
			const isNegative = node.value.n < 0n;
			const magnitude = isNegative ? { n: -node.value.n, d: node.value.d } : node.value;
			out.push({ negated: isNegative !== negated, text: formatRational(magnitude) });
			return;
		}
		default:
			out.push({ negated, text: formatFactor(node) });
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
	const terms: { negated: boolean; text: string }[] = [];
	collectDisplayTerms(node, false, terms);
	if (terms.length === 0) return "0";

	let out = "";
	terms.forEach((term, index) => {
		if (index === 0) out += term.negated ? `-${term.text}` : term.text;
		else out += term.negated ? `-${term.text}` : `+${term.text}`;
	});
	return out;
}
