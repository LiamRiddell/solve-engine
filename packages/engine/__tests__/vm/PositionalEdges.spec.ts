/**
 * A line that reads another line's result depends on that position.
 *
 * The graph indexed names: variables, globals, category tags and data sources.
 * The other half of what reads across lines does not have a name to index.
 * `prev`, `line 7`, `sum(line 3 : line 9)`, the `above` aggregates and a table
 * column all reach for a **position**, and registered nothing, so nothing that
 * asks the graph what an edit or an arriving value affects could name them.
 *
 * They are recorded where they happen. Every one of those forms reads through
 * the same closure, the per-line context's `getLineResult`, so the edge is
 * taken there rather than in each form, and a form added later is covered
 * without knowing about this.
 *
 * A positional read is discovered while the line runs, exactly as a data-source
 * read is, so it is pinned the same way: the next registration of the line
 * recovers its edges from the text, where a position it reached for at run time
 * does not appear.
 *
 * On positions moving: a structural edit already clears the whole graph and the
 * next pass rebuilds it, which is the answer every other edge kind relies on.
 * Keying by position and inheriting that is deliberate; a second invalidation
 * policy for one kind would be the thing that drifts.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { DependencyGraph, dataSourceEdgeKey, edgeKey, linePositionEdgeKey } from "@solve-js/vm/DependencyGraph";

/** Evaluate a document and hand back the graph it built. */
function graphFor(lines: string[]) {
	const engine = createEngine() as unknown as ExpressionEngine;
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, engine);
	evaluator.evaluate({ startLine: 1, endLine: lines.length });
	return { dag: engine.getDag(), doc, evaluator, view: { startLine: 1, endLine: lines.length } };
}

/** The lines reading a position, ascending, so a test reads as document order. */
function readersOf(dag: DependencyGraph, lineNumber: number): number[] {
	return [...dag.getAffectedLinesByPosition(lineNumber)].sort((a, b) => a - b);
}

describe("the positions a form reads", () => {
	test("prev depends on the line immediately above it", () => {
		const { dag } = graphFor(["10", "prev + 1"]);
		expect(readersOf(dag, 1)).toEqual([2]);
		expect(readersOf(dag, 2)).toEqual([]);
	});

	test("a line reference depends on the line it names", () => {
		const { dag } = graphFor(["10", "1 + 1", "line 1 + 5"]);
		expect(readersOf(dag, 1)).toEqual([3]);
		expect(readersOf(dag, 2)).toEqual([]);
	});

	test("an above aggregate depends on every line it read", () => {
		const { dag } = graphFor(["1", "2", "3", "total above"]);
		expect(readersOf(dag, 1)).toEqual([4]);
		expect(readersOf(dag, 2)).toEqual([4]);
		expect(readersOf(dag, 3)).toEqual([4]);
	});

	test("a line range depends on the lines in it", () => {
		const { dag } = graphFor(["1", "2", "3", "4", "sum(line 2 : line 3)"]);
		expect(readersOf(dag, 2)).toEqual([5]);
		expect(readersOf(dag, 3)).toEqual([5]);
	});

	test("several forms on one document each register their own", () => {
		const { dag } = graphFor(["10", "prev + 1", "line 1 + 5", "total above", "1 + 1"]);
		expect(readersOf(dag, 1)).toEqual([2, 3, 4]);
		expect(readersOf(dag, 2)).toEqual([4]);
		expect(readersOf(dag, 3)).toEqual([4]);
		// Nothing reads the aggregate or the line below it.
		expect(readersOf(dag, 4)).toEqual([]);
		expect(readersOf(dag, 5)).toEqual([]);
	});

	test("a line that reads nothing across lines registers no position", () => {
		const { dag } = graphFor(["1 + 1", "2 + 2", "3 + 3"]);
		expect(readersOf(dag, 1)).toEqual([]);
		expect(readersOf(dag, 2)).toEqual([]);
	});
});

describe("how the edge behaves", () => {
	test("it survives the line being registered again", () => {
		// The edge is discovered at run time and does not appear in the line's
		// text, so re-registering from the text must not drop it.
		const dag = new DependencyGraph();
		dag.registerLine(4, ["x"], []);
		dag.registerLinePositionDependency(4, 2);
		dag.registerLine(4, ["y"], []);

		expect(readersOf(dag, 2)).toEqual([4]);
		expect([...dag.getConsumers("x")]).toEqual([]);
		expect([...dag.getConsumers("y")]).toEqual([4]);
	});

	test("a line reading itself records nothing", () => {
		// It would be a cycle for the ordering to break and says nothing.
		const dag = new DependencyGraph();
		dag.registerLinePositionDependency(3, 3);
		expect(readersOf(dag, 3)).toEqual([]);
	});

	test("recording the same position twice records one edge", () => {
		const dag = new DependencyGraph();
		for (let i = 0; i < 5; i++) dag.registerLinePositionDependency(9, 4);
		expect(readersOf(dag, 4)).toEqual([9]);
		expect(dag.getReads(9).size).toBe(1);
	});

	test("a run of positions and one far from it are all recorded", () => {
		// The contiguous span is only how a repeat is recognised cheaply; a
		// position outside it has to be recorded just the same.
		const dag = new DependencyGraph();
		for (const position of [5, 6, 7, 4, 3, 40]) dag.registerLinePositionDependency(9, position);
		for (const position of [3, 4, 5, 6, 7, 40]) expect(readersOf(dag, position)).toEqual([9]);
		expect(readersOf(dag, 8)).toEqual([]);
		expect(dag.getReads(9).size).toBe(6);
	});

	test("removing the line drops its positions", () => {
		const dag = new DependencyGraph();
		dag.registerLinePositionDependency(9, 4);
		dag.removeLine(9);
		expect(readersOf(dag, 4)).toEqual([]);

		// And the line can record again afterwards, with nothing left over.
		dag.registerLinePositionDependency(9, 5);
		expect(readersOf(dag, 4)).toEqual([]);
		expect(readersOf(dag, 5)).toEqual([9]);
	});

	test("clearing the graph drops them", () => {
		const dag = new DependencyGraph();
		dag.registerLinePositionDependency(9, 4);
		dag.clear();
		expect(readersOf(dag, 4)).toEqual([]);
		dag.registerLinePositionDependency(9, 4);
		expect(readersOf(dag, 4)).toEqual([9]);
	});

	test("a position key cannot collide with a variable or a tag", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, ["7"], []);
		dag.registerLine(2, [edgeKey("tag", "7")], []);
		dag.registerLinePositionDependency(3, 7);

		expect(readersOf(dag, 7)).toEqual([3]);
		expect([...dag.getConsumers("7")]).toEqual([1]);
		expect([...dag.getConsumers(edgeKey("tag", "7"))]).toEqual([2]);
		expect(linePositionEdgeKey(7)).toBe("line:7");
	});
});

describe("after the document changes", () => {
	test("an edit rebuilds the positions the aggregate reads", () => {
		const { dag, doc, evaluator, view } = graphFor(["1", "2", "total above"]);
		expect(readersOf(dag, 1)).toEqual([3]);
		expect(readersOf(dag, 2)).toEqual([3]);

		// A heading is a boundary, so the aggregate now reads only below it,
		// and the edge to the line above the heading goes with the run that
		// stopped reading it: the aggregate's text never changed, so only its
		// own run can say so.
		doc.editLine(1, "# heading");
		evaluator.evaluate(view);
		expect(readersOf(dag, 2)).toEqual([3]);
		expect(readersOf(dag, 1)).toEqual([]);
		expect(dag.positionsReadBy(3)).toEqual([2]);
	});

	test("editing the reader drops the positions its old text read", () => {
		// Before the edited line runs, not after: a rule consulting the graph
		// between the edit and the run must not be told the old edges.
		const { dag, doc, evaluator, view } = graphFor(["9", "line 1 + 1"]);
		expect(readersOf(dag, 1)).toEqual([2]);

		doc.editLine(2, "5");
		evaluator.evaluate(view);
		expect(readersOf(dag, 1)).toEqual([]);
		expect(dag.getReads(2).has(linePositionEdgeKey(1))).toBe(false);
	});

	test("retargeting a reference leaves only the new position", () => {
		const { dag, doc, evaluator, view } = graphFor(["9", "line 1 + 1", "4"]);
		doc.editLine(2, "line 3 + 1");
		evaluator.evaluate(view);

		expect(readersOf(dag, 1)).toEqual([]);
		expect(readersOf(dag, 3)).toEqual([2]);
		expect(dag.positionsReadBy(2)).toEqual([3]);
	});

	test("a goal seek reads its target's position", () => {
		// Through its own closures rather than through `line N`, and it takes
		// the same edge, so a cycle through a seek is a cycle the graph holds.
		const { dag } = graphFor([":v1 = 7", "v1 * 2", "solve line 2 for v1 = 40"]);
		expect(readersOf(dag, 2)).toEqual([3]);
	});
});

describe("what the graph says about a run", () => {
	test("a run cuts the recorded positions back to the ones it read", () => {
		const dag = new DependencyGraph();
		for (const position of [3, 4, 5]) dag.registerLinePositionDependency(9, position);
		dag.reconcilePositionReads(9);
		expect(dag.positionsReadBy(9).sort()).toEqual([3, 4, 5]);

		// The next run reads only line 4.
		dag.registerLinePositionDependency(9, 4);
		dag.reconcilePositionReads(9);
		expect(dag.positionsReadBy(9)).toEqual([4]);
		expect(readersOf(dag, 3)).toEqual([]);
		expect(readersOf(dag, 5)).toEqual([]);
		expect(readersOf(dag, 4)).toEqual([9]);

		// And a run that read nothing leaves nothing.
		dag.reconcilePositionReads(9);
		expect(dag.positionsReadBy(9)).toEqual([]);
		expect(readersOf(dag, 4)).toEqual([]);
	});

	test("a data-source pin survives the positions being forgotten", () => {
		// Discovered the same way, but not about the text.
		const dag = new DependencyGraph();
		dag.registerLineDataSourceDependency(9, "currency", ["USD"]);
		dag.registerLinePositionDependency(9, 4);
		dag.forgetPositionReads(9);

		expect(readersOf(dag, 4)).toEqual([]);
		expect(dag.getReads(9).has(dataSourceEdgeKey("currency", ["USD"]))).toBe(true);
	});

	test("a reader that recorded a new position is reported once, and not again", () => {
		const dag = new DependencyGraph();
		for (const position of [5, 4, 3, 2, 1]) dag.registerLinePositionDependency(6, position);
		dag.registerLinePositionDependency(8, 7);
		expect([...dag.takeReadersThatGainedAPosition()]).toEqual([6, 8]);

		// The repeat, which is every line of a settled pass, reports nothing.
		for (const position of [5, 4, 3, 2, 1]) dag.registerLinePositionDependency(6, position);
		dag.registerLinePositionDependency(8, 7);
		expect([...dag.takeReadersThatGainedAPosition()]).toEqual([]);

		dag.registerLinePositionDependency(8, 1);
		expect([...dag.takeReadersThatGainedAPosition()]).toEqual([8]);
		dag.clear();
		expect([...dag.takeReadersThatGainedAPosition()]).toEqual([]);
	});

	test("the positions a line reads come back as a span and a set together", () => {
		const dag = new DependencyGraph();
		for (const position of [5, 6, 7, 40]) dag.registerLinePositionDependency(9, position);
		expect(dag.positionsReadBy(9).sort((a, b) => a - b)).toEqual([5, 6, 7, 40]);
		expect(dag.positionsReadBy(1)).toEqual([]);
	});

	test("an edge pointing down the document is what a cycle needs, and is counted", () => {
		// `prev` and `above` read upwards, and a document of them can hold no
		// cycle; a reference to a line below is the one thing that can close
		// one, so the walk that looks for cycles asks this first.
		const dag = new DependencyGraph();
		dag.registerLinePositionDependency(2, 1);
		expect(dag.hasDownwardPositionRead()).toBe(false);

		dag.registerLinePositionDependency(1, 3);
		expect(dag.hasDownwardPositionRead()).toBe(true);
		dag.forgetPositionReads(1);
		expect(dag.hasDownwardPositionRead()).toBe(false);

		// Counted once however the entry records it: as a set member first and
		// inside the span later.
		for (const position of [5, 3, 4, 3]) dag.registerLinePositionDependency(1, position);
		dag.removeLine(1);
		expect(dag.hasDownwardPositionRead()).toBe(false);
	});

	test("a settled pass over a column records nothing new", () => {
		const lines = ["1"];
		for (let i = 0; i < 40; i++) lines.push("prev + 1");
		const { dag, evaluator, view } = graphFor(lines);
		evaluator.evaluate(view);
		evaluator.evaluate(view);
		expect([...dag.takeReadersThatGainedAPosition()]).toEqual([]);
		expect(dag.hasDownwardPositionRead()).toBe(false);
	});

	test("a structural edit clears them, and the next pass puts them back", () => {
		const { dag, doc, evaluator, view } = graphFor(["1", "2", "total above"]);
		expect(readersOf(dag, 1)).toEqual([3]);

		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: ["a note"] }]);
		expect(readersOf(dag, 1)).toEqual([]);

		evaluator.evaluate({ ...view, endLine: 4 });
		// The aggregate is line 4 now, reading the two amounts above it.
		expect(readersOf(dag, 2)).toEqual([4]);
		expect(readersOf(dag, 3)).toEqual([4]);
	});
});
