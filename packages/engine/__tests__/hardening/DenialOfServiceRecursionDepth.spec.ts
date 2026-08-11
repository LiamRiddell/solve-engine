/**
 * Recursion over a tree whose depth nobody bounded.
 *
 * The symbolic core is the best-guarded corner of the engine by count: expand
 * stops at exponent 32, factor at degree 12, solve at degree 8, derivatives and
 * Taylor series at order 16, an exact rational at 4,096 bits, and every tree at
 * `SYMBOLIC_MAX_NODES`. Every one of those bounds a tree's SIZE. None of them
 * bounds its DEPTH, and the two come apart completely for a chain, where a
 * thousand nodes is a thousand levels.
 *
 * `SymbolicNode.ts`'s `nodeCount()` already knows this. It is written
 * iteratively on purpose, and says why: a recursive walk "would overflow the
 * native call stack before a recursive walk could finish, which made the
 * SYMBOLIC_NODE_LIMIT_EXCEEDED guard unreachable in exactly the case it exists
 * for". That fix made the guard reachable. It did not make the two functions
 * the guard is protecting able to walk what the guard permits: both still
 * recurse, and both run out of native stack at a size the guard calls legal.
 *
 * A native stack overflow is a RangeError rather than an abort, so this is the
 * least fatal finding in this group, and it is here anyway for two reasons.
 * `RobustnessResourceLimits.spec.ts` already treats a "call stack" message
 * reaching a caller as a defect in the parser and asserts against it, so the
 * same message reaching a caller from the formatter is the same defect. And
 * `formatValue()` is called by the host to render an answer it has already been
 * given, which is the one place a host is least likely to have a `try` around.
 *
 * REACHABILITY. Depth is bounded on any single line by `maxNestingDepth` and
 * `maxComplexity`, so this needs a document, and a document reaches it one
 * level per line:
 *
 *   a1 = sin(x)
 *   a2 = sin(a1)
 *   ... 1,500 lines ...
 *
 * At 1,500 lines `formatValue()` on the last line throws
 * "Maximum call stack size exceeded". At 4,000 the document is a fatal OOM
 * instead, because each line retains its own copy of the chain below it and
 * the total is quadratic in the line count.
 *
 * The cases below build the chain directly rather than through 1,500 lines of
 * document, so they are instant, allocate almost nothing, and pin the depth
 * exactly instead of depending on how the document path happens to share
 * subtrees.
 */

import { describe, expect, test } from "@jest/globals";
import {
	formatSymbolic,
	nodeCount,
	simplifySymbolic,
	SYMBOLIC_MAX_NODES,
	varNode,
	type SymbolicNode,
} from "@solve-js/symbolic";

/**
 * `sin(sin(...sin(x)...))`, nested `depth` deep.
 *
 * A chain is the shape that separates depth from size: this is `depth + 1`
 * nodes and `depth + 1` levels, so a tree the size guard is happy with is as
 * deep as it is big.
 */
function chain(depth: number): SymbolicNode {
	let node: SymbolicNode = varNode("x");
	for (let level = 0; level < depth; level++) node = { kind: "call", name: "sin", args: [node] };
	return node;
}

/** What a call threw, as a string, or `"no error"`. */
function threw(run: () => unknown): string {
	try {
		run();
		return "no error";
	} catch (thrown) {
		return `${(thrown as Error).constructor.name}: ${(thrown as Error).message}`;
	}
}

describe("a tree the size guard calls legal", () => {
	test("nine thousand levels is under the node ceiling, so nothing refuses it", () => {
		// Establishes the premise the two cases below rest on. 9,001 nodes is
		// inside `SYMBOLIC_MAX_NODES` (10,000), so by the engine's own measure
		// this is an expression it has agreed to handle, and `simplifySymbolic`'s
		// SYMBOLIC_NODE_LIMIT_EXCEEDED check will not fire for it.
		const deep = chain(9000);
		expect(nodeCount(deep)).toBe(9001);
		expect(nodeCount(deep)).toBeLessThan(SYMBOLIC_MAX_NODES);
	});

	test("and a shallow one prints and simplifies exactly as it should", () => {
		// The control. Five hundred levels is well inside every stack, so the two
		// cases below are about depth and not about the chain being malformed.
		const shallow = chain(500);
		expect(formatSymbolic(shallow)).toHaveLength(2501);
		expect(threw(() => simplifySymbolic(shallow))).toBe("no error");
	});

	test("can be printed", () => {
		// BUG. `SymbolicFormat.ts`'s `collectDisplayTerms()` and `formatFactor()`
		// call each other down the tree with no depth counter, so the native
		// stack is the only limit and it is reached at about 2,000 levels, one
		// fifth of the size the node guard permits. What comes out is a raw
		// RangeError reading "Maximum call stack size exceeded", not an
		// EngineError, so a host cannot tell it apart from a bug in its own code
		// and gets no code to branch on.
		//
		// Which way this is fixed is open: an explicit depth limit that reports
		// SYMBOLIC_DEPTH_LIMIT_EXCEEDED, or an iterative printer like
		// `nodeCount()` already is. Either satisfies this test. A raw
		// "call stack" message escaping the engine does not.
		expect(threw(() => formatSymbolic(chain(9000)))).toBe("no error");
	});

	test("and simplified", () => {
		// BUG, same cause, in `Simplify.ts` this time, and worse because it is
		// the function that owns the size guard. `simplifySymbolic()` counts the
		// tree iteratively, decides 9,001 nodes is within its 10,000 ceiling, and
		// then recurses into a tree it cannot walk. The stack runs out at around
		// 4,000 levels, so there is a whole band of trees the guard admits and
		// the simplifier crashes on.
		//
		// Every symbolic operation routes through here, so this is reached by
		// anything that touches a deep expression rather than only by displaying
		// one.
		expect(threw(() => simplifySymbolic(chain(9000)))).toBe("no error");
	});
});
