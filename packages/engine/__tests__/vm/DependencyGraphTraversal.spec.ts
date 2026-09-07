/**
 * The dependency walk visits each edge once, and orders against every producer.
 *
 * Two faults, both invisible while every key had exactly one writer, and both
 * load-bearing the moment a key can have many — which is what a category tag is:
 * one key whose producers are the group's members.
 *
 * `getAffectedLines` pushed a key onto its queue once per line that wrote it,
 * and rescanned that key's whole consumer set on each pop. With m members and
 * n aggregates over one tag that is m x n, measured at 15.5 ms for 2,000 of
 * each, against 0.8 ms once keys are visited once.
 *
 * `getAffectedLinesInOrder` recorded one producer per key, last seen wins, so an
 * aggregate got an ordering edge to one member and none to the rest. I could not
 * construct an observably wrong order while keys had single writers, which is
 * why it survived; the edges were incomplete by construction rather than by
 * accident, and the assertions below pin the completeness rather than the luck.
 */
import { describe, expect, test } from "@jest/globals";
import { DependencyGraph, edgeKey } from "@solve-js/vm/DependencyGraph";

/** A tag group of `members` lines with `aggregates` readers over it. */
function taggedColumn(members: number, aggregates: number): DependencyGraph {
	const dag = new DependencyGraph();
	const tag = edgeKey("tag", "food");
	for (let i = 0; i < members; i++) dag.registerLine(i + 1, ["seed"], [tag]);
	for (let i = 0; i < aggregates; i++) dag.registerLine(members + 1 + i, [tag], [`agg${i}`]);
	return dag;
}

describe("the walk visits each key once", () => {
	test("a key with many producers and many consumers stays linear", () => {
		// The quadratic form took 15.5 ms here and grew four times per doubling.
		// This bound is set from a measurement of about 0.8 ms, the way #364 set
		// the benchmark suites, so it carries wide headroom and still fails the
		// shape it replaced by two orders of magnitude.
		const dag = taggedColumn(2_000, 2_000);
		const started = process.hrtime.bigint();
		const affected = dag.getAffectedLines("seed");
		const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

		expect(affected.size).toBe(4_000);
		expect(elapsedMs).toBeLessThan(200);
	});

	test("and it still reaches everything it used to", () => {
		const dag = taggedColumn(3, 2);
		// Three members, two aggregates, and the aggregates write their own
		// variables, so all five lines are downstream of the seed.
		expect(Array.from(dag.getAffectedLines("seed")).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
	});

	test("a cycle terminates rather than looping", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, ["b"], ["a"]);
		dag.registerLine(2, ["a"], ["b"]);
		expect(Array.from(dag.getAffectedLines("a")).sort((a, b) => a - b)).toEqual([1, 2]);
	});

	test("a chain is walked end to end", () => {
		const dag = new DependencyGraph();
		for (let i = 0; i < 50; i++) dag.registerLine(i + 1, i === 0 ? [] : [`v${i - 1}`], [`v${i}`]);
		expect(dag.getAffectedLines("v0").size).toBe(49);
	});
});

describe("ordering accounts for every producer of a key", () => {
	test("an aggregate is ordered after all of its members", () => {
		const tag = edgeKey("tag", "food");
		const dag = new DependencyGraph();
		dag.registerLine(1, ["seed"], ["a"]);
		dag.registerLine(2, ["a"], ["b"]);
		dag.registerLine(3, ["b"], ["c"]);
		dag.registerLine(4, ["c"], [tag]);   // a member behind a three-link chain
		dag.registerLine(5, ["seed"], [tag]); // a member with nothing in front of it
		dag.registerLine(6, [tag], []);       // the aggregate

		const order = dag.getAffectedLinesInOrder("seed");
		expect(order.indexOf(6)).toBeGreaterThan(order.indexOf(4));
		expect(order.indexOf(6)).toBeGreaterThan(order.indexOf(5));
	});

	test("with many members, the aggregate is last", () => {
		const dag = taggedColumn(20, 1);
		const order = dag.getAffectedLinesInOrder("seed");
		const aggregate = order.indexOf(21);
		for (let member = 1; member <= 20; member++) {
			expect(order.indexOf(member)).toBeLessThan(aggregate);
		}
	});

	test("a variable chain still orders producers before consumers", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, [], ["x"]);
		dag.registerLine(2, ["x"], ["y"]);
		dag.registerLine(3, ["y"], []);
		expect(dag.getAffectedLinesInOrder("x")).toEqual([2, 3]);
	});

	test("every affected line appears exactly once", () => {
		const dag = taggedColumn(10, 3);
		const order = dag.getAffectedLinesInOrder("seed");
		expect(new Set(order).size).toBe(order.length);
		expect(order.length).toBe(dag.getAffectedLines("seed").size);
	});
});

describe("a line whose edges have not moved is left alone", () => {
	test("re-registering the same edges changes nothing", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, ["x"], ["y"]);
		const writes = dag.getWrites(1);
		dag.registerLine(1, ["x"], ["y"]);

		// The same set object, not an equal one: the fast path did not rebuild it.
		expect(dag.getWrites(1)).toBe(writes);
		expect(Array.from(dag.getConsumers("x"))).toEqual([1]);
		expect(Array.from(dag.getProducers("y"))).toEqual([1]);
	});

	test("but a changed edge is still picked up", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, ["x"], ["y"]);
		dag.registerLine(1, ["z"], ["y"]);
		expect(dag.getConsumers("x").size).toBe(0);
		expect(Array.from(dag.getConsumers("z"))).toEqual([1]);
	});

	test("and so is a write that went away", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, [], ["y"]);
		dag.registerLine(1, [], []);
		expect(dag.getProducers("y").size).toBe(0);
		expect(dag.getWrites(1).size).toBe(0);
		// `dependencies` is only written alongside `writes`, so it goes with them
		// rather than describing a line that no longer defines anything.
		expect(dag.getDependencies(1).size).toBe(0);
	});

	test("a pinned data-source read does not make the edges look changed", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, ["x"], []);
		dag.registerLineDataSourceDependency(1, "currency", ["USD"]);
		const before = dag.getAffectedLinesByDataSource("currency", ["USD"]);
		dag.registerLine(1, ["x"], []);
		expect(Array.from(dag.getAffectedLinesByDataSource("currency", ["USD"]))).toEqual(Array.from(before));
		expect(Array.from(dag.getConsumers("x"))).toEqual([1]);
	});

	test("a duplicated name falls through rather than being mistaken for a change", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, ["x", "x"], []);
		dag.registerLine(1, ["x", "x"], []);
		expect(Array.from(dag.getConsumers("x"))).toEqual([1]);
	});
});

describe("a lookup that misses allocates nothing", () => {
	test("the same empty set is handed back each time", () => {
		const dag = new DependencyGraph();
		// Identity, not just emptiness: a fresh `new Set()` per miss was about
		// 176 nanoseconds of garbage, and the evaluator misses once per line
		// that writes nothing, on every pass.
		expect(dag.getWrites(1)).toBe(dag.getWrites(2));
		expect(dag.getConsumers("a")).toBe(dag.getConsumers("b"));
		expect(dag.getProducers("a")).toBe(dag.getProducers("b"));
		expect(dag.getDependencies(1)).toBe(dag.getDependencies(2));
		expect(dag.getWrites(1).size).toBe(0);
	});

	test("and a hit is still the graph's own set", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, ["x"], ["y"]);
		expect(Array.from(dag.getWrites(1))).toEqual(["y"]);
		expect(Array.from(dag.getConsumers("x"))).toEqual([1]);
	});
});
