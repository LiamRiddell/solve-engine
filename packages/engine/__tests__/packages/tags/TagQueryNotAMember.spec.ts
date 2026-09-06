/**
 * A `#tag` after `total of` names the group; it does not join it.
 *
 * Two aggregate lines over one tag used to make each other unreadable. Each
 * walked every line whose text carried the tag, found the other still being
 * evaluated, and reported it: `total of #a` said "Line 4 has not been evaluated
 * yet" and `average of #a` said "Line 3 has an error". Delete either and the
 * other answered, which is what made it a defect rather than a limit.
 *
 * The querying line's own text was already skipped, by line number. This says
 * the same thing about the other queries, and what is pinned here is the pair
 * of edges around it: a line can query one tag and join another, and a line
 * that genuinely has not been evaluated is still reported rather than quietly
 * dropped.
 */
import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluate a document and return every line's display. */
const lines = (source: string[]): string[] => {
	const engine = newTrackedEngine();
	const doc = new DocumentModel();
	doc.setDocument(source.join("\n"));
	new ThreeTierEvaluator(doc, engine).evaluate({ startLine: 1, endLine: source.length });
	try {
		return source.map((_, i) => {
			const result = doc.getLineAt(i + 1)!.result;
			return result === undefined ? "(none)" : formatValue(result).replace(/^=\s*/, "");
		});
	} finally {
		engine.clear();
	}
};

describe("one tag can answer any number of questions", () => {
	test("a total and an average together", () => {
		expect(lines(["10 #a", "20 #a", "total of #a", "average of #a"])).toEqual([
			"10", "20", "30", "15",
		]);
	});

	test("all four aggregates at once", () => {
		expect(lines(["10 #a", "20 #a", "count of #a", "sum of #a", "average of #a"])).toEqual([
			"10", "20", "2", "30", "15",
		]);
	});

	test("and each still answers alone, as it always did", () => {
		expect(lines(["10 #a", "20 #a", "total of #a"])).toEqual(["10", "20", "30"]);
	});

	test("on money as much as on plain numbers", () => {
		expect(lines(["$4.99 #shop", "$12.50 #shop", "total of #shop", "count of #shop"])).toEqual([
			"$4.99", "$12.50", "$17.49", "2",
		]);
	});
});

describe("a line can query one tag and join another", () => {
	test("the query does not make it a member of the tag it asks about", () => {
		// Line 4 asks about #a. Line 5 asks about #b and neither joins.
		expect(lines(["10 #a #b", "20 #a", "5 #b", "total of #a", "total of #b"])).toEqual([
			"10", "20", "5", "30", "15",
		]);
	});
});

describe("what is still reported rather than skipped", () => {
	test("a line that genuinely has not been evaluated", () => {
		// An aggregate above its own members is a forward reference, and the
		// engine reads a document downwards. That is a real "not yet" and it
		// still says so, which is what separates this fix from swallowing every
		// pending line.
		const result = lines(["total of #a", "10 #a"]);
		expect(result[0]).toContain("not been evaluated yet");
	});
});
