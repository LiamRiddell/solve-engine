/**
 * A document grown by editing stays a tree, not a list.
 *
 * `pseudoRandom` was `((x >> 16) ^ x) * 0x45d9f3b` twice, and zero survives
 * every step of that unchanged, so `pseudoRandom(0)` was exactly `0`. Priorities
 * were taken from `mid`, the midpoint of the range being built, and a
 * single-line insert is always `buildTreap(ids, 0, 1)`, so `mid` was always 0.
 *
 * Every inserting edit therefore minted a node with the lowest priority a node
 * can have, and `merge` compares `left.priority > right.priority`, which is
 * false at a tie, so they chained into a strictly linear spine. Depth equalled
 * the number of inserts. `nodeAt`, `split`, `merge`, `collectRange` and the
 * iterator all recurse on that depth, so every read overflowed the stack: the
 * scroll path at about 5,400 inserts, `getAllLines` at about 7,900,
 * `ThreeTierEvaluator.evaluate` at about 8,000. The `RangeError` escaped to the
 * caller, and the model stayed bricked afterwards.
 *
 * Loading the same text in one `setDocument` always built a balanced tree, which
 * is what isolated the fault to the incremental path.
 *
 * These are structural assertions, not timings: depth is a property of the tree,
 * so it can be asserted exactly rather than measured.
 */
import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * The deepest path in the document's order tree, walked iteratively so that
 * measuring a degenerate tree cannot itself overflow the stack.
 */
function orderTreeDepth(doc: DocumentModel): number {
	const root = (doc as unknown as { orderTree?: { root?: unknown } }).orderTree?.root;
	let deepest = 0;
	const pending: Array<{ node: { left?: unknown; right?: unknown }; depth: number }> =
		root === undefined || root === null ? [] : [{ node: root as never, depth: 1 }];
	while (pending.length > 0) {
		const { node, depth } = pending.pop()!;
		if (depth > deepest) deepest = depth;
		if (node.left) pending.push({ node: node.left as never, depth: depth + 1 });
		if (node.right) pending.push({ node: node.right as never, depth: depth + 1 });
	}
	return deepest;
}

/** A document grown one line at a time, inserting at `at` (or appending). */
function grownByInserting(inserts: number, at?: number): DocumentModel {
	const doc = new DocumentModel();
	doc.setDocument("1");
	for (let i = 0; i < inserts; i++) doc.insertLines(at ?? doc.lineCount + 1, ["1"]);
	return doc;
}

/**
 * Generous, because a randomised treap's depth is expected to be a constant
 * multiple of the ideal rather than the ideal itself: about 2.2x here. The
 * defect made depth equal the insert count, so 16,000 inserts were depth 16,001
 * against the 150 this allows, and any return of it fails by a hundredfold.
 */
const DEPTH_CEILING = 150;

describe("depth stays logarithmic however the document was built", () => {
	test("appending one line at a time", () => {
		expect(orderTreeDepth(grownByInserting(16_000))).toBeLessThan(DEPTH_CEILING);
	});

	test("prepending one line at a time", () => {
		expect(orderTreeDepth(grownByInserting(4_000, 1))).toBeLessThan(DEPTH_CEILING);
	});

	test("inserting into the middle one line at a time", () => {
		const doc = new DocumentModel();
		doc.setDocument("1\n2");
		for (let i = 0; i < 4_000; i++) doc.insertLines(2, ["1"]);
		expect(orderTreeDepth(doc)).toBeLessThan(DEPTH_CEILING);
	});

	test("and loading it whole, which always worked", () => {
		const doc = new DocumentModel();
		doc.setDocument(Array.from({ length: 16_001 }, () => "1").join("\n"));
		expect(orderTreeDepth(doc)).toBeLessThan(DEPTH_CEILING);
	});
});

describe("the reads that used to overflow", () => {
	test("every read path answers on a document grown to 30,000 lines", () => {
		const doc = grownByInserting(30_000);
		expect(doc.lineCount).toBe(30_001);
		// Each of these recurses on the tree depth, and each had its own
		// threshold on the degenerate tree.
		expect(() => doc.getAllLines()).not.toThrow();
		expect(() => doc.getLineAt(1)).not.toThrow();
		expect(() => doc.getLinePosition(doc.lineCount)).not.toThrow();
	});

	test("and the evaluator runs over it", () => {
		const engine = newTrackedEngine();
		const doc = grownByInserting(12_000);
		try {
			expect(() => new ThreeTierEvaluator(doc, engine).evaluate({ startLine: 1, endLine: doc.lineCount })).not.toThrow();
		} finally {
			engine.clear();
		}
	});
});

describe("the hash that made every insert identical", () => {
	test("no seed maps to the lowest priority twice over", () => {
		// The root cause in one line: a one-element build always asked for the
		// priority of the same seed, and that seed answered zero.
		const doc = new DocumentModel();
		doc.setDocument("a\nb");
		doc.insertLines(2, ["c"]);
		const root = (doc as unknown as { orderTree: { root: { priority: number } } }).orderTree.root;
		const seen = new Set<number>();
		const walk = (node: { priority: number; left?: unknown; right?: unknown } | undefined | null): void => {
			if (!node) return;
			seen.add(node.priority);
			walk(node.left as never);
			walk(node.right as never);
		};
		walk(root);
		// Three nodes, three distinct priorities: the old hash gave two of them 0.
		expect(seen.size).toBe(3);
	});
});
