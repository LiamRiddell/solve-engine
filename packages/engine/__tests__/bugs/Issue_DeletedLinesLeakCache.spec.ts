import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";

/**
 * A deleted line must not keep its cached bytecode.
 *
 * The dependency graph was pruned when a line was deleted, but the LineCache
 * was not: `removeAllForLine` existed and had no callers anywhere. Entries for
 * line numbers that no longer existed accumulated until the whole cache was
 * dropped on a document switch, so a long editing session in one document grew
 * memory that nothing would reclaim.
 */
describe("deleting lines releases their cache entries", () => {
	test("the cache shrinks when lines are deleted", () => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const doc = new DocumentModel();
		const evaluator = new ThreeTierEvaluator(doc, engine);

		doc.setDocument("1 + 1\n2 + 2\n3 + 3\n4 + 4\n5 + 5");
		evaluator.evaluate({ startLine: 1, endLine: 5 });

		const populated = engine.getLineCache().size;
		expect(populated).toBeGreaterThan(0);

		// Delete the last three lines.
		evaluator.applyTransaction([{ startLine: 3, deleteCount: 3, insertLines: [] }]);

		expect(engine.getLineCache().size).toBeLessThan(populated);

		engine.clear();
	});

	test("successive deletions keep shrinking it", () => {
		// One deletion could pass by accident. This checks the cache falls again
		// on a second deletion within the same document, without setDocument in
		// between, since that resets state and would mask an accumulation.
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const doc = new DocumentModel();
		const evaluator = new ThreeTierEvaluator(doc, engine);

		doc.setDocument("1 + 1\n2 + 2\n3 + 3\n4 + 4\n5 + 5\n6 + 6");
		evaluator.evaluate({ startLine: 1, endLine: 6 });
		const full = engine.getLineCache().size;

		evaluator.applyTransaction([{ startLine: 5, deleteCount: 2, insertLines: [] }]);
		const afterFirst = engine.getLineCache().size;
		expect(afterFirst).toBeLessThan(full);

		evaluator.applyTransaction([{ startLine: 3, deleteCount: 2, insertLines: [] }]);
		expect(engine.getLineCache().size).toBeLessThan(afterFirst);

		engine.clear();
	});
});
