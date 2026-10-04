import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DependencyGraph, EVERY_TAG, dataSourceEdgeKey, edgeKey, linePositionEdgeKey, type DocumentView } from "@solve-js/vm/DependencyGraph";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #733: a span aggregate stored one dependency edge per line it read, as
 * a `line:<n>` key in three indexes (`consumers`, `pinnedReads`, `lineReads`),
 * so a running total after each ledger entry cost the square of the ledger:
 * 3,000 `total above` lines held 508.8 MB through evaluateDocument, and 6,000
 * ran a 2 GB heap out.
 *
 * A positional read is now held once, in the reader's own entry (a span, a
 * sparse set, a list of spans of figures, and the tags it reads), and "which
 * lines read line k" is an interval index over those entries plus the tag
 * index. A tag total takes one edge on its tag (through `getTaggedLines`), a
 * section total one span of figures (through `noteFigureSpanRead`), and a
 * member read the form already declared records nothing more.
 */

// ── Helpers ─────────────────────────────────────────────────────────────

/** The formatted answer of each line, or `ERROR <message>`. */
function answers(result: { lines: readonly { result: { isError(): boolean; errorMessage?: string } | null; error: string | null }[] }): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		const v = line.result as unknown as Parameters<typeof formatValue>[0] | null;
		if (!v) return "";
		return formatValue(v).replace(/^=\s*/, "");
	});
}

const batch = (lines: readonly string[]) => answers(newTrackedEngine().parseDocument(lines.join("\n")));
const incremental = (lines: readonly string[]) => answers(evaluateDocument(newTrackedEngine(), lines.join("\n")));

/** A live editor over the text, settled by three passes. */
function editorFor(lines: readonly string[]) {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const engine = newTrackedEngine();
	const evaluator = new ThreeTierEvaluator(doc, engine);
	const settle = () => {
		for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
	};
	settle();
	const shown = () =>
		Array.from({ length: doc.lineCount }, (_, i) => {
			const r = doc.getLineAt(i + 1)?.result;
			return r ? formatValue(r).replace(/^=\s*/, "") : "";
		});
	return { doc, engine, evaluator, settle, shown, dag: engine.getDag() };
}

/** What a settled editor over this text shows, the way the differential fuzz settles its oracle. */
function settled(lines: readonly string[]): string[] {
	const editor = editorFor(lines);
	const shown = editor.shown();
	editor.evaluator.terminateWorker();
	return shown;
}

/** The lines reading a position, ascending. */
const readersOf = (dag: DependencyGraph, n: number) => [...dag.getAffectedLinesByPosition(n)].sort((a, b) => a - b);

/** The graph's private indexes, read for the memory checks. */
interface GraphInternals {
	consumers: Map<string, Set<number>>;
	lineReads: Map<number, Set<string>>;
	pinnedReads: Map<number, Set<string>>;
	positionReads: Map<number, { sparse: Set<number> | null; figures: number[] | null; tags: Set<string> | null }>;
}
const internals = (dag: DependencyGraph) => dag as unknown as GraphInternals;

/** How many entries the graph holds in all, every set and list counted by its size. */
function graphEntries(dag: DependencyGraph): number {
	const g = internals(dag);
	let total = 0;
	for (const set of g.consumers.values()) total += set.size;
	for (const set of g.lineReads.values()) total += set.size;
	for (const set of g.pinnedReads.values()) total += set.size;
	for (const entry of g.positionReads.values()) total += 1 + (entry.sparse?.size ?? 0) + (entry.figures?.length ?? 0) + (entry.tags?.size ?? 0);
	return total;
}

/** Whether any index holds a `line:` key. */
function holdsLineKeys(dag: DependencyGraph): boolean {
	const g = internals(dag);
	const prefix = linePositionEdgeKey(0).slice(0, -1);
	for (const key of g.consumers.keys()) if (key.startsWith(prefix)) return true;
	for (const set of g.lineReads.values()) for (const key of set) if (key.startsWith(prefix)) return true;
	for (const set of g.pinnedReads.values()) for (const key of set) if (key.startsWith(prefix)) return true;
	return false;
}

/** The ledger shapes the issue measured. */
const ledger = {
	above: (n: number) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "1" : "total above")),
	section: (n: number) => ["# Costs", ...Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "1" : 'total of section "Costs"'))],
	tag: (n: number) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "1 #a" : "total of #a")),
	aboveOnly: (n: number) => ["1", ...Array.from({ length: n }, () => "total above")],
};

/** A document view over a fixed list of line texts, for the graph on its own. */
function viewOver(texts: Record<number, { tags?: string[]; summary?: boolean }>): DocumentView {
	return {
		memberTags: (n) => texts[n]?.tags ?? [],
		isSummary: (n) => texts[n]?.summary === true,
	};
}

// ── The graph: positions ────────────────────────────────────────────────

describe("a span is one entry, answered through the interval index", () => {
	test("an above aggregate over a block is found from every line in it, and from no other", () => {
		const dag = new DependencyGraph();
		for (let n = 9; n >= 1; n--) dag.registerLinePositionDependency(10, n);
		for (let n = 1; n <= 9; n++) expect(readersOf(dag, n)).toEqual([10]);
		expect(readersOf(dag, 10)).toEqual([]);
		expect(readersOf(dag, 11)).toEqual([]);
		expect(readersOf(dag, 0)).toEqual([]);
		expect(holdsLineKeys(dag)).toBe(false);
		expect(graphEntries(dag)).toBe(1);
	});

	test("overlapping spans of many readers are each found, and only where they reach", () => {
		const dag = new DependencyGraph();
		// Reader r reads r - 3 .. r - 1, so line k is read by k + 1 .. k + 3.
		for (let r = 4; r <= 40; r++) for (let n = r - 3; n < r; n++) dag.registerLinePositionDependency(r, n);
		for (let k = 1; k <= 40; k++) {
			const expected = [k + 1, k + 2, k + 3].filter((r) => r >= 4 && r <= 40 && r - 3 <= k);
			expect(readersOf(dag, k)).toEqual(expected);
		}
	});

	test("a position far from the span is sparse and found exactly", () => {
		const dag = new DependencyGraph();
		for (const n of [5, 6, 7, 40]) dag.registerLinePositionDependency(9, n);
		expect(readersOf(dag, 40)).toEqual([9]);
		expect(readersOf(dag, 39)).toEqual([]);
		expect(readersOf(dag, 8)).toEqual([]);
	});

	test("a reader is never its own reader, whatever it records", () => {
		const dag = new DependencyGraph();
		dag.registerLinePositionDependency(3, 3);
		dag.registerLineFigureSpan(3, 1, 5);
		expect(readersOf(dag, 3)).toEqual([]);
		expect(readersOf(dag, 2)).toEqual([3]);
	});

	test("the index is rebuilt after a change and not before", () => {
		const dag = new DependencyGraph();
		dag.registerLinePositionDependency(5, 1);
		expect(readersOf(dag, 1)).toEqual([5]);
		dag.registerLinePositionDependency(6, 1);
		expect(readersOf(dag, 1)).toEqual([5, 6]);
		dag.forgetPositionReads(5);
		expect(readersOf(dag, 1)).toEqual([6]);
		dag.removeLine(6);
		expect(readersOf(dag, 1)).toEqual([]);
	});

	test("the `line:` getters are made from the entries, so their answers are unchanged", () => {
		const dag = new DependencyGraph();
		dag.registerLine(9, ["x"], []);
		for (const n of [3, 4, 5]) dag.registerLinePositionDependency(9, n);
		expect([...dag.getReads(9)].sort()).toEqual([linePositionEdgeKey(3), linePositionEdgeKey(4), linePositionEdgeKey(5), "x"]);
		expect([...dag.getConsumers(linePositionEdgeKey(4))]).toEqual([9]);
		expect([...dag.directConsumersOf(linePositionEdgeKey(4))]).toEqual([9]);
		expect([...dag.getConsumers(linePositionEdgeKey(8))]).toEqual([]);
		const snapshot = dag.getSnapshot();
		expect(snapshot.consumers[linePositionEdgeKey(3)]).toEqual([9]);
		expect(snapshot.reads[9].sort()).toEqual([linePositionEdgeKey(3), linePositionEdgeKey(4), linePositionEdgeKey(5), "x"]);
		// And nothing stored them.
		expect(holdsLineKeys(dag)).toBe(false);
	});

	test("the vocabulary a language service asks for holds no position", () => {
		const dag = new DependencyGraph();
		dag.registerLine(1, [], ["price"]);
		dag.registerLine(2, ["price", edgeKey("tag", "food")], []);
		dag.registerLinePositionDependency(2, 1);
		expect([...dag.keysInUse()].sort()).toEqual(["#food", "price"]);
	});

	test("the data-source readers are listed without a snapshot", () => {
		const dag = new DependencyGraph();
		dag.registerLineDataSourceDependency(7, "currency", ["USD"]);
		dag.registerLineDataSourceDependency(3, "currency", ["EUR"]);
		dag.registerLinePositionDependency(3, 1);
		expect(dag.linesReadingADataSource()).toEqual([3, 7]);
		expect(dag.getReads(3).has(dataSourceEdgeKey("currency", ["EUR"]))).toBe(true);
	});
});

// ── The graph: tags and spans of figures ────────────────────────────────

describe("a tag edge is one edge, followed back through the document view", () => {
	test("a tag total reaches the lines carrying its tag now, and no others", () => {
		const dag = new DependencyGraph();
		dag.setDocumentView(viewOver({ 1: { tags: ["food"] }, 2: { tags: ["fun"] }, 3: { tags: ["food", "fun"] } }));
		dag.registerLineTagDependency(4, "Food");
		expect(readersOf(dag, 1)).toEqual([4]);
		expect(readersOf(dag, 2)).toEqual([]);
		expect(readersOf(dag, 3)).toEqual([4]);
		expect(dag.readsAnyPosition(4)).toBe(true);
		expect(dag.positionsReadBy(4)).toEqual([]);
		expect(graphEntries(dag)).toBe(2);
	});

	test("every tag at once, the edge a breakdown takes", () => {
		const dag = new DependencyGraph();
		dag.setDocumentView(viewOver({ 1: { tags: ["a"] }, 2: {}, 3: { tags: ["b"] } }));
		dag.registerLineTagDependency(4, EVERY_TAG);
		expect(readersOf(dag, 1)).toEqual([4]);
		expect(readersOf(dag, 2)).toEqual([]);
		expect(readersOf(dag, 3)).toEqual([4]);
	});

	test("a member that loses its tag is no longer reached, with nothing recorded again", () => {
		const tags: Record<number, { tags?: string[] }> = { 1: { tags: ["a"] } };
		const dag = new DependencyGraph();
		dag.setDocumentView(viewOver(tags));
		dag.registerLineTagDependency(2, "a");
		expect(readersOf(dag, 1)).toEqual([2]);
		tags[1] = {};
		expect(readersOf(dag, 1)).toEqual([]);
	});

	test("a run that stops reading a tag drops it, and one that reads nothing drops the line", () => {
		const dag = new DependencyGraph();
		dag.setDocumentView(viewOver({ 1: { tags: ["a"] }, 2: { tags: ["b"] } }));
		dag.registerLineTagDependency(5, "a");
		dag.registerLineTagDependency(5, "b");
		dag.reconcilePositionReads(5);
		dag.takeEdgeChanges();
		dag.registerLineTagDependency(5, "b");
		dag.reconcilePositionReads(5);
		expect(readersOf(dag, 1)).toEqual([]);
		expect(readersOf(dag, 2)).toEqual([5]);
		expect(dag.takeEdgeChanges().lines).toEqual([5]);
		dag.reconcilePositionReads(5);
		expect(readersOf(dag, 2)).toEqual([]);
		expect(dag.readsAnyPosition(5)).toBe(false);
	});

	test("a new tag edge is reported to the cycle walk once", () => {
		const dag = new DependencyGraph();
		dag.registerLineTagDependency(5, "a");
		dag.registerLineTagDependency(5, "a");
		expect([...dag.takeReadersThatGainedAPosition()]).toEqual([5]);
		dag.registerLineTagDependency(5, "a");
		expect([...dag.takeReadersThatGainedAPosition()]).toEqual([]);
	});

	test("without a document view a tag edge reaches no line", () => {
		const dag = new DependencyGraph();
		dag.registerLineTagDependency(2, "a");
		expect(readersOf(dag, 1)).toEqual([]);
		expect(dag.hasDownwardPositionRead()).toBe(true);
	});

	test("a span of figures passes over a summary line", () => {
		const dag = new DependencyGraph();
		dag.setDocumentView(viewOver({ 3: { summary: true } }));
		dag.registerLineFigureSpan(6, 2, 5);
		expect(readersOf(dag, 2)).toEqual([6]);
		expect(readersOf(dag, 3)).toEqual([]);
		expect(readersOf(dag, 5)).toEqual([6]);
		expect(readersOf(dag, 1)).toEqual([]);
		expect(dag.positionsReadBy(6).sort((a, b) => a - b)).toEqual([2, 4, 5]);
		expect(graphEntries(dag)).toBe(3);
	});

	test("a span of figures below its reader counts as a downward edge, and goes with its run", () => {
		const dag = new DependencyGraph();
		dag.registerLineFigureSpan(2, 3, 9);
		expect(dag.hasDownwardPositionRead()).toBe(true);
		dag.reconcilePositionReads(2);
		expect(dag.hasDownwardPositionRead()).toBe(true);
		dag.registerLineFigureSpan(2, 1, 1);
		dag.reconcilePositionReads(2);
		expect(dag.hasDownwardPositionRead()).toBe(false);
		expect(readersOf(dag, 5)).toEqual([]);
		expect(readersOf(dag, 1)).toEqual([2]);
	});

	test("an empty, reversed or fractional span of figures records nothing", () => {
		const dag = new DependencyGraph();
		dag.registerLineFigureSpan(2, 5, 4);
		dag.registerLineFigureSpan(2, 1.5, 3);
		dag.registerLineFigureSpan(2, Number.NaN, 3);
		dag.registerLineFigureSpan(2, 1, Number.POSITIVE_INFINITY);
		expect(dag.readsAnyPosition(2)).toBe(false);
	});

	test("a hostile tag name is a key like any other", () => {
		expectPrototypeUntouched(() => {
			const dag = new DependencyGraph();
			dag.setDocumentView({ memberTags: () => PROTOTYPE_WORDS.map((w) => w.toLowerCase()), isSummary: () => false });
			for (const word of PROTOTYPE_WORDS) dag.registerLineTagDependency(9, word);
			expect(readersOf(dag, 1)).toEqual([9]);
			dag.reconcilePositionReads(9);
			dag.clear();
			expect(readersOf(dag, 1)).toEqual([]);
		});
	});
});

// ── The graph against a reference ───────────────────────────────────────

describe("the index answers what a scan of every reader answers", () => {
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

	test("over 600 random runs, forgets and removals", () => {
		const size = 30;
		const random = seeded(733);
		const pick = (n: number) => 1 + Math.floor(random() * n);
		const lines: Record<number, { tags?: string[]; summary?: boolean }> = {};
		for (let n = 1; n <= size; n++) lines[n] = { tags: random() < 0.3 ? [["a", "b", "c"][pick(3) - 1]] : [], summary: random() < 0.2 };
		const dag = new DependencyGraph();
		dag.setDocumentView(viewOver(lines));
		// The reference: what each reader's last run read.
		const lastRun = new Map<number, { positions: Set<number>; figures: [number, number][]; tags: Set<string> }>();

		for (let step = 0; step < 600; step++) {
			const reader = pick(size);
			const roll = random();
			if (roll < 0.1) {
				dag.forgetPositionReads(reader);
				lastRun.delete(reader);
			} else if (roll < 0.15) {
				dag.removeLine(reader);
				lastRun.delete(reader);
			} else {
				const run = { positions: new Set<number>(), figures: [] as [number, number][], tags: new Set<string>() };
				const reads = pick(4) - 1;
				for (let r = 0; r < reads; r++) {
					const kind = random();
					if (kind < 0.5) {
						// A contiguous run downwards, the way `above` reads, or one position.
						const from = pick(size);
						const length = random() < 0.5 ? 1 : pick(6);
						for (let n = from; n > from - length && n >= 1; n--) {
							dag.registerLinePositionDependency(reader, n);
							if (n !== reader) run.positions.add(n);
						}
					} else if (kind < 0.75) {
						const first = pick(size);
						const last = first + pick(5) - 1;
						dag.registerLineFigureSpan(reader, first, last);
						if (!run.figures.some(([f, l]) => f === first && l === last)) run.figures.push([first, last]);
					} else {
						const tag = random() < 0.2 ? EVERY_TAG : ["a", "b", "c"][pick(3) - 1];
						dag.registerLineTagDependency(reader, tag);
						run.tags.add(tag);
					}
				}
				dag.reconcilePositionReads(reader);
				if (run.positions.size === 0 && run.figures.length === 0 && run.tags.size === 0) lastRun.delete(reader);
				else lastRun.set(reader, run);
			}

			if (step % 20 !== 19) continue;
			for (let k = 0; k <= size + 1; k++) {
				const expected: number[] = [];
				for (const [r, run] of lastRun) {
					if (r === k) continue;
					const tagsOfK = lines[k]?.tags ?? [];
					const byPosition = run.positions.has(k);
					const byFigures = !(lines[k]?.summary === true) && run.figures.some(([f, l]) => k >= f && k <= l);
					const byTag = tagsOfK.some((t) => run.tags.has(t)) || (tagsOfK.length > 0 && run.tags.has(EVERY_TAG));
					if (byPosition || byFigures || byTag) expected.push(r);
				}
				expect({ step, k, readers: readersOf(dag, k) }).toEqual({ step, k, readers: expected.sort((a, b) => a - b) });
			}
			expect(holdsLineKeys(dag)).toBe(false);
		}
	});
});

// ── Documents ───────────────────────────────────────────────────────────

describe("the ledgers the issue measured", () => {
	test.each([
		["total above", ledger.above],
		["a section total", ledger.section],
		["a tag total", ledger.tag],
	])("%s after each entry: right answers, both passes agree", (_form, shape) => {
		const lines = shape(200);
		const out = incremental(lines);
		expect(out).toEqual(batch(lines));
		expect(out[out.length - 1]).toBe("100");
	});

	test.each([
		["total above", ledger.above],
		["a section total", ledger.section],
		["a tag total", ledger.tag],
		["1 then total above on every line", ledger.aboveOnly],
	])("%s: the graph grows with the ledger, not with its square", (_form, shape) => {
		const entriesAt = (n: number) => {
			const editor = editorFor(shape(n));
			const dag = editor.dag;
			expect(holdsLineKeys(dag)).toBe(false);
			const entries = graphEntries(dag);
			editor.evaluator.terminateWorker();
			return entries;
		};
		const small = entriesAt(400);
		const large = entriesAt(800);
		// Linear doubles; the per-line edges this replaces quadrupled.
		expect(large / small).toBeLessThan(2.5);
		expect(large).toBeLessThan(8 * 800);
	});

	test("every reader is still found: an edit to the first entry reaches the last total", () => {
		const editor = editorFor(ledger.above(40));
		expect(readersOf(editor.dag, 1)).toContain(40);
		editor.doc.editLine(1, "5");
		editor.settle();
		const shown = editor.shown();
		expect(shown[shown.length - 1]).toBe("24");
		expect(shown).toEqual(batch(Array.from({ length: 40 }, (_, i) => (i === 0 ? "5" : i % 2 === 0 ? "1" : "total above"))));
		editor.evaluator.terminateWorker();
	});

	test("a section total's members reach it, and the totals inside the section do not", () => {
		const editor = editorFor(["# Costs", "1", 'total of section "Costs"', "2", 'total of section "Costs"']);
		expect(readersOf(editor.dag, 2)).toEqual([3, 5]);
		expect(readersOf(editor.dag, 4)).toEqual([3, 5]);
		expect(readersOf(editor.dag, 3)).toEqual([]);
		expect(readersOf(editor.dag, 5)).toEqual([]);
		editor.evaluator.terminateWorker();
	});

	test("a tag total's members reach it, through the tag", () => {
		const editor = editorFor(["1 #a", "2 #b", "3 #A", "total of #a"]);
		expect(readersOf(editor.dag, 1)).toEqual([4]);
		expect(readersOf(editor.dag, 2)).toEqual([]);
		expect(readersOf(editor.dag, 3)).toEqual([4]);
		expect(editor.shown()[3]).toBe("4");
		editor.evaluator.terminateWorker();
	});
});

// ── Adversarial ─────────────────────────────────────────────────────────

describe("adversarial: realistic breakage", () => {
	test("a span edited shorter by a heading drops the lines above the heading", () => {
		const editor = editorFor(["1", "2", "3", "total above"]);
		expect(readersOf(editor.dag, 1)).toEqual([4]);
		editor.doc.editLine(2, "# a heading");
		editor.settle();
		expect(readersOf(editor.dag, 1)).toEqual([]);
		expect(readersOf(editor.dag, 3)).toEqual([4]);
		expect(editor.shown()).toEqual(batch(["1", "# a heading", "3", "total above"]));
		editor.evaluator.terminateWorker();
	});

	test("a heading inserted inside a section's span ends the section there", () => {
		const editor = editorFor(["# Costs", "1", "2", "3", 'total of section "Costs"']);
		editor.evaluator.applyTransaction([{ startLine: 3, deleteCount: 0, insertLines: ["# Other"] }]);
		editor.settle();
		const text = ["# Costs", "1", "# Other", "2", "3", 'total of section "Costs"'];
		expect(editor.shown()).toEqual(batch(text));
		expect(editor.shown()).toEqual(settled(text));
		expect(readersOf(editor.dag, 4)).toEqual([]);
		expect(readersOf(editor.dag, 2)).toEqual([6]);
		editor.evaluator.terminateWorker();
	});

	test("a tag removed from one member leaves the total and its edges", () => {
		const editor = editorFor(["10 #a", "20 #a", "total of #a"]);
		expect(editor.shown()[2]).toBe("30");
		editor.doc.editLine(2, "20");
		editor.settle();
		expect(editor.shown()[2]).toBe("10");
		expect(readersOf(editor.dag, 2)).toEqual([]);
		expect(readersOf(editor.dag, 1)).toEqual([3]);
		expect(editor.shown()).toEqual(batch(["10 #a", "20", "total of #a"]));
		editor.evaluator.terminateWorker();
	});

	test("a positional cycle through a tag total closed and then reopened", () => {
		const start = ["line 3 + 1 #a", "2 #a", "total of #a"];
		const editor = editorFor(start);
		// Closed: line 1 reads the total, which reads line 1.
		expect(editor.shown()).toEqual(batch(start));
		editor.doc.editLine(1, "7 #a");
		editor.settle();
		expect(editor.shown()).toEqual(["7", "2", "9"]);
		editor.doc.editLine(1, "line 3 + 1 #a");
		editor.settle();
		expect(editor.shown()).toEqual(batch(start));
		expect(editor.shown()).toEqual(settled(start));
		editor.evaluator.terminateWorker();
	});

	test("a positional cycle through a section total closed and then reopened", () => {
		const start = ["# Costs", "line 4 + 1", "2", 'total of section "Costs"'];
		const editor = editorFor(start);
		expect(editor.shown()).toEqual(batch(start));
		editor.doc.editLine(2, "5");
		editor.settle();
		expect(editor.shown()).toEqual(["", "5", "2", "7"]);
		editor.doc.editLine(2, "line 4 + 1");
		editor.settle();
		expect(editor.shown()).toEqual(batch(start));
		editor.evaluator.terminateWorker();
	});

	test("two totals of one section read neither each other nor themselves", () => {
		const lines = ["# Costs", "1", 'Subtotal: total of section "Costs"', "2", 'total of section "Costs"'];
		expect(settled(lines)).toEqual(batch(lines));
		expect(batch(lines)[4]).toBe("3");
	});

	test("a snapshot round trip after a ledger restores the answers", () => {
		const engine = newTrackedEngine();
		evaluateDocument(engine, ledger.above(40).join("\n"));
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())), { packages: BUILTIN_PACKAGES });
		expect(answers(evaluateDocument(restored, ledger.above(40).join("\n")))).toEqual(batch(ledger.above(40)));
	});
});

describe("adversarial: security", () => {
	test("prototype words as tags on a ledger", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestDocument([`1 #${word}`, `total of #${word}`, `2 #${word}`, `total of #${word}`, "total by tag"].join("\n"));
			}
		});
	});

	test("look-alike and markup-shaped text inside a span", () => {
		for (const text of TEXT_EDGES) {
			expectHonestDocument(["1", text, "2", "total above", "# Costs", "3", text, 'total of section "Costs"'].join("\n"));
		}
	});

	test("thousands of running totals stay within budget, through both passes", () => {
		const text = ledger.above(3_000).join("\n");
		const { incremental: out } = expectHonestDocument(text, { budgetMs: 30_000 });
		expect(out[out.length - 1]).toBe("= 1,500");
	});
});

describe("adversarial: edge cases", () => {
	test("an empty section, a section at the end, and a heading alone", () => {
		for (const lines of [["# Costs", 'total of section "Costs"'], ["1", "# Costs", 'total of section "Costs"'], ["# Costs"]]) {
			expect(incremental(lines)).toEqual(batch(lines));
		}
	});

	test("CRLF and a trailing line break around a ledger", () => {
		const text = ledger.tag(20).join("\r\n") + "\r\n";
		expectHonestDocument(text);
	});

	test("a range at the edge of the document and past it", () => {
		for (const lines of [["1", "2", "sum(line 1 : line 2)"], ["1", "sum(line 0 : line 1)"], ["1", "2", "sum(line 1 : line 9000000)"]]) {
			expect(incremental(lines)).toEqual(batch(lines));
		}
	});

	test("a position of 0 or past the end has no reader", () => {
		const editor = editorFor(ledger.above(10));
		expect(readersOf(editor.dag, 0)).toEqual([]);
		expect(readersOf(editor.dag, -1)).toEqual([]);
		expect(readersOf(editor.dag, 11)).toEqual([]);
		expect(readersOf(editor.dag, Number.MAX_SAFE_INTEGER)).toEqual([]);
		editor.evaluator.terminateWorker();
	});
});
