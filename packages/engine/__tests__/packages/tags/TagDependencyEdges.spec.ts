/**
 * A category tag is an edge in the dependency graph, like a variable name.
 *
 * The graph indexed variables, globals and data sources, but not tags, so an
 * edit to a tagged line told the incremental engine nothing about the totals
 * over it. They still came out right, because the evaluator makes a full
 * top-down pass and reads stored results, which is the same reason they cost a
 * walk every time.
 *
 * Registering them puts a tag on the same footing: `10 #food` writes the key
 * and `total of #food` reads it, so `getAffectedLines` names the aggregates an
 * edit to a member dirties, and `getProducers` names a group's members.
 *
 * The trap this pins is not the registering, it is that a line registers from
 * five places across the engine and the evaluator, and a line registered twice
 * with different edge sets keeps only the later one. Tag edges were being
 * written and then wiped inside the same pass. Every site routes through
 * `withTagEdges` now, and these assert the edges as they stand at the end of a
 * pass, which is what a second registration would have destroyed.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { edgeKey } from "@solve-js/vm/DependencyGraph";

const FOOD = edgeKey("tag", "food");

/** A document run through the incremental pass, with its graph. */
function evaluated(lines: string[]) {
	const engine = createEngine();
	evaluateDocument(engine, lines.join("\n"));
	return engine.getDag();
}

/** A graph's line set for a key, ascending, so a test reads as document order. */
function sorted(lines: ReadonlySet<number> | undefined): number[] {
	return [...(lines ?? [])].sort((a, b) => a - b);
}

describe("tag edges survive a whole pass", () => {
	test("a tagged line produces its group and an aggregate consumes it", () => {
		const dag = evaluated(["10 #food", "20 #food", "5 #travel", "total of #food", "average of #food"]);

		expect(sorted(dag.getProducers(FOOD))).toEqual([1, 2]);
		expect(sorted(dag.getConsumers(FOOD))).toEqual([4, 5]);
		expect(sorted(dag.getProducers(edgeKey("tag", "travel")))).toEqual([3]);
	});

	test("editing a member names the aggregates over its group", () => {
		const dag = evaluated(["10 #food", "20 #food", "total of #food", "1 + 1"]);

		// What the incremental engine asks after an edit to line 1.
		expect(sorted(dag.getAffectedLines(FOOD))).toEqual([3]);
	});

	test("a tag written in another case is the same key", () => {
		// `lineCarriesTag` reads a tag case-insensitively, so `#Food` and
		// `total of #food` are one group and have to be one key.
		const dag = evaluated(["10 #Food", "total of #food"]);

		expect(sorted(dag.getProducers(FOOD))).toEqual([1]);
		expect(sorted(dag.getConsumers(FOOD))).toEqual([2]);
	});

	test("an aggregate is a reader of its group, not a member of it", () => {
		// The reading #382 settled: asking about a group does not join it. The
		// edge kinds have to agree with it or the aggregate would depend on
		// itself.
		const dag = evaluated(["10 #food", "total of #food"]);

		expect(sorted(dag.getProducers(FOOD))).toEqual([1]);
		expect(sorted(dag.getConsumers(FOOD))).not.toContain(1);
		expect(sorted(dag.getProducers(FOOD))).not.toContain(2);
	});

	test("a heading is not a producer of its own name", () => {
		const dag = evaluated(["# food", "10 #food", "total of #food"]);

		expect(sorted(dag.getProducers(FOOD))).toEqual([2]);
	});

	test("a line that asks about one group and joins another registers both", () => {
		const dag = evaluated(["10 #food", "total of #food #reviewed", "3 #reviewed"]);

		expect(sorted(dag.getConsumers(FOOD))).toEqual([2]);
		expect(sorted(dag.getProducers(edgeKey("tag", "reviewed")))).toEqual([2, 3]);
	});

	test("a tag key cannot collide with a variable of the same name", () => {
		// The namespaced key space is what lets one graph hold both: `food = 5`
		// and `10 #food` are different keys, so an edit to one does not dirty
		// the readers of the other.
		const dag = evaluated([":food = 5", "10 #food", "food + 1", "total of #food"]);

		expect(sorted(dag.getProducers(FOOD))).toEqual([2]);
		expect(sorted(dag.getConsumers(FOOD))).toEqual([4]);
		expect(sorted(dag.getAffectedLines("food"))).toEqual([3]);
	});
});
