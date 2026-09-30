import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SegmentTree } from "@solve-js/engine/SegmentTree";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #763: `DocumentModel` keeps line order in an order-statistic treap
 * (`SegmentTree`), and its in-order walk was a recursive generator with a
 * `yield*` at every node, so each id was handed up through one generator
 * frame per level of the tree. `buildOrderCaches` walks it after every
 * structural edit. On this spec's machine the walk took 7.97 ms at 20,000
 * lines, and `buildOrderCaches` 12.94 ms of an 18.08 ms insertion.
 *
 * The walk is now iterative, with an explicit stack: `forEach(visit)`, which
 * `buildOrderCaches` calls, `toArray()`, and the iterator built on the same
 * loop. The tree itself (the priorities, `spliceAt`, `getRange`) is unchanged.
 */

afterEach(() => {
	jest.restoreAllMocks();
});

/** A deterministic generator, so a failing sequence can be replayed. */
function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * A tree after a long run of random splices, and the plain array the same
 * splices produce: the reference order every walk has to reproduce.
 */
function spliced(seed: number, initial: number, steps: number): { tree: SegmentTree; expected: number[] } {
	const random = seeded(seed);
	const tree = new SegmentTree();
	const expected = Array.from({ length: initial }, (_, i) => i + 1);
	tree.replaceAll([...expected]);
	let nextId = initial + 1;
	for (let step = 0; step < steps; step++) {
		const at = Math.floor(random() * (expected.length + 1));
		const deleteCount = Math.floor(random() * 3);
		const inserted = Array.from({ length: Math.floor(random() * 3) }, () => nextId++);
		const removed = tree.spliceAt(at, deleteCount, inserted);
		expect(removed).toEqual(expected.splice(at, deleteCount, ...inserted));
	}
	return { tree, expected };
}

const walked = (tree: SegmentTree): number[] => {
	const ids: number[] = [];
	tree.forEach((id) => ids.push(id));
	return ids;
};

// ── The walk, against the reference ──────────────────────────────────────

describe("the iterative walk visits the same ids in the same order", () => {
	test.each([1, 2, 3, 763])("after a long run of random splices (seed %p)", (seed) => {
		const { tree, expected } = spliced(seed, 500, 2_000);
		expect(walked(tree)).toEqual(expected);
		expect(tree.toArray()).toEqual(expected);
		expect([...tree]).toEqual(expected);
		// getRange is the tree's own recursive walk, untouched by this change.
		expect(tree.getRange(0, tree.length - 1)).toEqual(expected);
		for (let i = 0; i < expected.length; i += 37) expect(tree.getAt(i)).toBe(expected[i]);
	});

	test("forEach passes each id's position", () => {
		const { tree, expected } = spliced(9, 50, 100);
		const positions: number[] = [];
		tree.forEach((id, index) => {
			expect(expected[index]).toBe(id);
			positions.push(index);
		});
		expect(positions).toEqual(expected.map((_, i) => i));
	});

	test("a tree built flat, and one built one insert at a time", () => {
		const flat = new SegmentTree();
		flat.replaceAll([5, 4, 3, 2, 1]);
		expect(flat.toArray()).toEqual([5, 4, 3, 2, 1]);
		const single = new SegmentTree();
		for (let i = 0; i < 200; i++) single.insertAt(i, i + 1);
		expect(single.toArray()).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
		for (let i = 0; i < 100; i++) single.deleteAt(0);
		expect([...single]).toEqual(Array.from({ length: 100 }, (_, i) => i + 101));
	});
});

describe("boundaries", () => {
	test("an empty tree visits nothing", () => {
		const tree = new SegmentTree();
		const visit = jest.fn();
		tree.forEach(visit);
		expect(visit).not.toHaveBeenCalled();
		expect(tree.toArray()).toEqual([]);
		expect([...tree]).toEqual([]);
	});

	test("a tree cleared, and one replaced with nothing", () => {
		const tree = new SegmentTree();
		tree.replaceAll([1, 2, 3]);
		tree.clear();
		expect(tree.toArray()).toEqual([]);
		tree.replaceAll([]);
		expect([...tree]).toEqual([]);
	});

	test("a single line", () => {
		const tree = new SegmentTree();
		tree.insertAt(0, 42);
		expect(walked(tree)).toEqual([42]);
		expect([...tree]).toEqual([42]);
	});

	test("the id zero and ids past 2^31 are ids like any other", () => {
		const tree = new SegmentTree();
		tree.replaceAll([0, 2 ** 31, 2 ** 53 - 1]);
		expect(tree.toArray()).toEqual([0, 2 ** 31, 2 ** 53 - 1]);
	});

	test("a walk can stop early through the iterator, and a new one starts from the top", () => {
		const tree = new SegmentTree();
		tree.replaceAll([1, 2, 3, 4]);
		const first: number[] = [];
		for (const id of tree) {
			first.push(id);
			if (id === 2) break;
		}
		expect(first).toEqual([1, 2]);
		expect([...tree]).toEqual([1, 2, 3, 4]);
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: 200,000 lines walk without exhausting the stack or the time budget", () => {
		const tree = new SegmentTree();
		tree.replaceAll(Array.from({ length: 200_000 }, (_, i) => i + 1));
		for (let i = 0; i < 5_000; i++) tree.insertAt((i * 7919) % tree.length, 200_001 + i);
		const started = performance.now();
		let count = 0;
		tree.forEach(() => count++);
		expect(count).toBe(205_000);
		expect([...tree].length).toBe(205_000);
		expect(performance.now() - started).toBeLessThan(5_000);
	});

	test("security: a visitor that throws stops the walk and leaves the tree whole", () => {
		const tree = new SegmentTree();
		tree.replaceAll([1, 2, 3, 4, 5]);
		const seen: number[] = [];
		expect(() =>
			tree.forEach((id) => {
				seen.push(id);
				if (id === 3) throw new RangeError("visitor");
			}),
		).toThrow("visitor");
		expect(seen).toEqual([1, 2, 3]);
		expect(tree.toArray()).toEqual([1, 2, 3, 4, 5]);
	});

	test("security: a document of prototype words keeps its order", () => {
		expectPrototypeUntouched(() => {
			const doc = new DocumentModel();
			doc.setDocument(PROTOTYPE_WORDS.join("\n"));
			doc.applyChanges([{ startLine: 2, deleteCount: 1, insertLines: ["__proto__ = 1", "constructor"] }]);
			const expected = [PROTOTYPE_WORDS[0], "__proto__ = 1", "constructor", ...PROTOTYPE_WORDS.slice(2)];
			expect(doc.getAllLines().map((s) => s.text)).toEqual(expected);
			expect([...doc].map((s) => s.text)).toEqual(expected);
			expected.forEach((text, i) => expect(doc.getLineAt(i + 1)!.text).toBe(text));
		});
	});
});

// ── DocumentModel: the caches are built from one iterative walk ──────────

describe("buildOrderCaches", () => {
	test("walks the tree once with forEach, and never through the generator", () => {
		const doc = new DocumentModel();
		doc.setDocument(Array.from({ length: 1_000 }, (_, i) => `line ${i}`).join("\n"));
		const iterate = jest.spyOn(SegmentTree.prototype, Symbol.iterator);
		const forEach = jest.spyOn(SegmentTree.prototype, "forEach");
		doc.insertLines(3, ["new"]);
		expect(doc.getLineAt(3)!.text).toBe("new");
		expect(doc.getLinePosition(doc.getLineAt(500)!.lineId)).toBe(500);
		expect(forEach).toHaveBeenCalledTimes(1);
		expect(iterate).not.toHaveBeenCalled();
	});

	test("positions and lines agree with a plain array after random structural edits", () => {
		const random = seeded(7630);
		const doc = new DocumentModel();
		const model = Array.from({ length: 200 }, (_, i) => `l${i}`);
		doc.setDocument(model.join("\n"));
		let fresh = 0;
		for (let step = 0; step < 300; step++) {
			const start = 1 + Math.floor(random() * model.length);
			const deleteCount = Math.min(Math.floor(random() * 3), model.length - start + 1);
			const insertLines = Array.from({ length: Math.floor(random() * 3) }, () => `n${fresh++}`);
			doc.applyChanges([{ startLine: start, deleteCount, insertLines }]);
			model.splice(start - 1, deleteCount, ...insertLines);
			if (model.length === 0) {
				doc.insertLines(1, ["seed"]);
				model.push("seed");
			}
			if (step % 25 === 0) {
				expect(doc.getAllLines().map((s) => s.text)).toEqual(model);
				for (let n = 1; n <= model.length; n += 7) {
					const state = doc.getLineAt(n)!;
					expect(state.text).toBe(model[n - 1]);
					expect(doc.getLinePosition(state.lineId)).toBe(n);
				}
			}
		}
		expect([...doc].map((s) => s.text)).toEqual(model);
		expect(doc.getLineAt(0)).toBeUndefined();
		expect(doc.getLineAt(model.length + 1)).toBeUndefined();
		expect(doc.getLinePosition(-1)).toBe(-1);
	});

	test("realistic: an insertion above a long document, then the evaluator's answers", () => {
		const lines: string[] = [];
		for (let i = 0; lines.length < 2_000; i++) lines.push(`:v${i} = ${i + 1}`, `v${i} * 2`);
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluateAll();
			evaluator.applyTransaction([{ startLine: 3, deleteCount: 0, insertLines: ["1 + 1"] }]);
			const answers = evaluator.evaluate({ startLine: 1, endLine: 40 }).lines;
			expect(formatValue(answers[2].result!)).toBe("= 2");
			expect(formatValue(answers[4].result!)).toBe("= 4");
			expect(doc.getLineAt(1501)!.text).toBe("v749 * 2");
		} finally {
			evaluator.terminateWorker();
		}
	});
});
