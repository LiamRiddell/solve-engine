/**
 * The dependency graph indexes edges, and a kind is only a prefix.
 *
 * It began as variable tracking and grew a second, parallel mechanism for data
 * sources: `dataSourceDependencies` and `dataSourceConsumers` were a copy of the
 * `lineReads` and `consumers` pair with a hand-built string key. Two mechanisms
 * doing one job is the sign the first was not general enough, and category tags
 * would have been a third copy.
 *
 * So there is one key space, namespaced by kind, and one pair of indexes over
 * it. What was missing from that pair is the reverse direction: `consumers`
 * answers "who reads this", and nothing answered "who writes it" — which is
 * exactly what a tag aggregate needs, and why it walked the whole document
 * rather than asking.
 */
import { describe, expect, test } from "@jest/globals";
import { DependencyGraph, edgeKey, dataSourceEdgeKey } from "@solve-js/vm/DependencyGraph";

describe("one key space, namespaced by kind", () => {
	test("kinds cannot collide with one another", () => {
		const keys = new Set([
			edgeKey("variable", "food"),
			edgeKey("global", "food"),
			edgeKey("tag", "food"),
			edgeKey("datasource", "food"),
		]);
		expect(keys.size).toBe(4);
	});

	test("a variable's key is the bare name, which is what every existing caller passes", () => {
		expect(edgeKey("variable", "x")).toBe("x");
	});

	test("the global prefix is the one that predates the table, and is preserved", () => {
		expect(edgeKey("global", "hello")).toBe("global:hello");
	});
});

describe("both directions are indexed", () => {
	test("consumers answers who reads, producers answers who writes", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, [], [edgeKey("tag", "food")]);
		dag.registerLine(2, [], [edgeKey("tag", "food")]);
		dag.registerLine(3, [edgeKey("tag", "food")], []);

		expect(Array.from(dag.getProducers(edgeKey("tag", "food"))).sort()).toEqual([1, 2]);
		expect(Array.from(dag.getConsumers(edgeKey("tag", "food")))).toEqual([3]);
	});

	test("re-registering a line drops the groups it has left", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, [], [edgeKey("tag", "food")]);
		expect(dag.getProducers(edgeKey("tag", "food")).has(1)).toBe(true);

		// The line was edited and the tag removed.
		dag.registerLine(1, [], []);
		expect(dag.getProducers(edgeKey("tag", "food")).has(1)).toBe(false);
		expect(dag.getWrites(1).size).toBe(0);
	});

	test("removing a line removes it from the groups it was in", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, [], [edgeKey("tag", "food")]);
		dag.removeLine(1);
		expect(dag.getProducers(edgeKey("tag", "food")).size).toBe(0);
	});

	test("an unknown key produces nothing rather than throwing", () => {
		expect(new DependencyGraph().getProducers(edgeKey("tag", "nothing")).size).toBe(0);
	});
});

describe("data sources go through the same indexes", () => {
	test("a data-source edge is a read like any other", () => {
		const dag = new DependencyGraph();
		dag.registerLineDataSourceDependency(4, "currency", ["USD", "EUR"]);
		expect(Array.from(dag.getAffectedLinesByDataSource("currency", ["USD", "EUR"]))).toEqual([4]);
		expect(Array.from(dag.getConsumers(dataSourceEdgeKey("currency", ["USD", "EUR"])))).toEqual([4]);
	});

	test("and a different query key is a different edge", () => {
		const dag = new DependencyGraph();
		dag.registerLineDataSourceDependency(4, "currency", ["USD", "EUR"]);
		expect(dag.getAffectedLinesByDataSource("currency", ["GBP", "EUR"]).size).toBe(0);
	});

	test("re-registering the line does not drop it", () => {
		// The reason data-source reads are pinned: they are discovered while the
		// line runs, after the registration that recovers edges from its text,
		// so a later registration must not treat them as edges that went away.
		const dag = new DependencyGraph();
		dag.registerLine(4, ["x"], []);
		dag.registerLineDataSourceDependency(4, "currency", ["USD", "EUR"]);
		dag.registerLine(4, ["x", "y"], []);
		expect(Array.from(dag.getAffectedLinesByDataSource("currency", ["USD", "EUR"]))).toEqual([4]);
	});

	test("but removing the line does", () => {
		const dag = new DependencyGraph();
		dag.registerLineDataSourceDependency(4, "currency", ["USD", "EUR"]);
		dag.removeLine(4);
		expect(dag.getAffectedLinesByDataSource("currency", ["USD", "EUR"]).size).toBe(0);
	});

	test("the diagnostic snapshot still shows them under their own heading", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, ["x"], ["y"]);
		dag.registerLineDataSourceDependency(1, "currency", ["USD"]);
		const snapshot = dag.getSnapshot();
		expect(snapshot.dataSourceDeps[1]).toEqual(['currency:["USD"]']);
		expect(snapshot.dataSourceConsumers['currency:["USD"]']).toEqual([1]);
		// And the new direction is exposed alongside the old one.
		expect(snapshot.producers["y"]).toEqual([1]);
		expect(snapshot.consumers["x"]).toEqual([1]);
	});
});

describe("variable propagation is unchanged", () => {
	test("an edit reaches transitive consumers", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, [], ["x"]);
		dag.registerLine(2, ["x"], ["y"]);
		dag.registerLine(3, ["y"], []);
		expect(Array.from(dag.getAffectedLines("x")).sort()).toEqual([2, 3]);
	});

	test("and a tag edit reaches the aggregates over it, through the same walk", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, [], [edgeKey("tag", "food")]);
		dag.registerLine(2, [edgeKey("tag", "food")], ["total"]);
		dag.registerLine(3, ["total"], []);
		expect(Array.from(dag.getAffectedLines(edgeKey("tag", "food"))).sort()).toEqual([2, 3]);
	});
});
