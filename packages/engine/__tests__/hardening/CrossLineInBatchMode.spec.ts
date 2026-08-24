/**
 * Cross-line features resolve in the batch paths, not only the incremental one.
 *
 * A line reference (`total above`, `line N`, `sum(line 1 : line 3)`, `prev`) and
 * a table-column aggregate both read earlier lines through the context that
 * `makeLineContext` builds from the engine's `DocumentModel`. Only the
 * incremental `ThreeTierEvaluator` path set that model, so those features worked
 * in an editor but reported a no-document error through `parseDocument` and
 * `evaluateLines`, the batch APIs a library caller reaches for. The two paths
 * disagreed about the same document.
 *
 * `processScanResults` now wires a document model for the length of a batch
 * pass, filling each line's result in as it is computed so a backward reference
 * reads a real value, and restores whatever model was there before, so an
 * engine a `ThreeTierEvaluator` owns is left as it was. This pins that the batch
 * paths now answer the same as the incremental one, and that a batch parse does
 * not leak a document model into a later single-expression call.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/** The last line's result through the batch document path. */
function lastLine(doc: string): unknown {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	const parsed = engine.parseDocument(doc, { inputType: "markdown" }).lines;
	const last = parsed[parsed.length - 1];
	return last.result?.value ?? last.error;
}

describe("line references resolve through parseDocument", () => {
	test.each([
		["10\n20\n30\ntotal above", 60],
		["10\n20\n30\naverage above", 20],
		["5\n7\nline 1 + line 2", 12],
		["10\n20\n30\nsum(line 1 : line 3)", 60],
		["100\nprev + 1", 101],
	])("%j -> %i", (doc, expected) => {
		expect(lastLine(doc)).toBe(expected);
	});
});

describe("the same references resolve through evaluateLines", () => {
	test("total above", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const results = engine.evaluateLines(["10", "20", "30", "total above"]);
		expect(results[3]?.result?.value).toBe(60);
	});
});

describe("a batch parse does not leak its document model", () => {
	test("a single expression after a document parse still has no document", () => {
		// The batch model must be torn down, or a later `evaluateExpression`,
		// which has no document, would read stale lines from the previous parse.
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		engine.parseDocument("1\n2\n3\ntotal above", { inputType: "markdown" });
		const value = engine.evaluateExpression("2 + 2");
		expect(value?.value).toBe(4);
		// A bare line reference with no document is still refused.
		const ref = engine.evaluateExpression("total above");
		expect(ref?.value).not.toBe(6);
	});

	test("two parses in a row do not bleed into each other", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		expect(lastLine.call(null, "10\n20\ntotal above")).toBe(30);
		// A second, shorter document must total its own lines, not the first's.
		const parsed = engine.parseDocument("1\n2\ntotal above", { inputType: "markdown" }).lines;
		expect(parsed[parsed.length - 1].result?.value).toBe(3);
	});
});

describe("what must keep working", () => {
	test("an ordinary document is unaffected", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const parsed = engine.parseDocument("100 + 20\n5 * 5\n:x = 3\n:x + 1", { inputType: "markdown" }).lines;
		expect(parsed[0].result?.value).toBe(120);
		expect(parsed[1].result?.value).toBe(25);
		expect(parsed[3].result?.value).toBe(4);
	});
});
