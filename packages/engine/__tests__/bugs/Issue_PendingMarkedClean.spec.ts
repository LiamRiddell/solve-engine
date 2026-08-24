import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { pendingValue } from "@solve-js/vm/Value";

/**
 * A line whose result is still waiting on a resolver must stay dirty.
 *
 * The tier evaluators treated "no exception thrown" as success. A pending value
 * does not throw, so a line awaiting external data was marked clean, and
 * nothing re-runs the resolver preflight for a clean line. The value stayed
 * pending indefinitely, with no error to explain why.
 */
describe("a pending line is not marked clean", () => {
	test("a line resolving to Pending stays dirty", () => {
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const doc = new DocumentModel();
		doc.setDocument("1 + 2");
		const evaluator = new ThreeTierEvaluator(doc, engine);

		// Force the pending path. What is under test is what the evaluator does
		// with a Pending, not how one comes to exist, and driving a real
		// unresolved resolver through the batcher would test three things at
		// once.
		const original = engine.evaluateLineDetailed.bind(engine);
		(engine as unknown as { evaluateLineDetailed: unknown }).evaluateLineDetailed = () => ({
			values: [pendingValue("plugin:230:test")],
		});

		evaluator.evaluate({ startLine: 1, endLine: 1 });
		expect(doc.dirtyCount).toBe(1);

		(engine as unknown as { evaluateLineDetailed: unknown }).evaluateLineDetailed = original;
		engine.clear();
	});

	test("an ordinary resolved line is still marked clean", () => {
		// The guard against over-correcting. If this also stayed dirty, every
		// line would re-evaluate forever and the fix would be worse than the
		// defect it replaced.
		const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
		const doc = new DocumentModel();
		doc.setDocument("1 + 2\n3 * 4");
		const evaluator = new ThreeTierEvaluator(doc, engine);

		evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(doc.dirtyCount).toBe(0);

		engine.clear();
	});
});
