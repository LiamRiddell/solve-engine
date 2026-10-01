import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { DependencyGraph, type DocumentView } from "@solve-js/vm/DependencyGraph";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Found bug: the evaluator's cycle walk held O(n^2) numbers at once on the
 * first pass of a large ledger. The walk is a depth-first search over "who
 * reads this line", and each frame on its stack held the full list of its
 * line's readers. A running total after every entry of a ledger is read by
 * every line below it, and the walk goes down the whole chain, so the stack
 * held n^2 / 2 readers: 8 million for 4,000 lines, measured at about 79 MB of
 * transient heap for the walk alone (9 MB after).
 *
 * Each frame now reads its line's readers one at a time
 * (`DependencyGraph.positionReadersOf`), so the walk holds its path and not
 * every reader of every line on it.
 */

function shownLine(line: EvalLineResult): string {
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	const text = formatValue(line.result).replace(/^=\s*/, "");
	return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
}

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
	});
}

const ledger = (n: number): string[] => ["1", ...Array.from({ length: n }, () => "total above")];

/** A live first pass over `lines`, with how many reader sets the graph built while it ran. */
function firstPass(lines: string[]): { shown: string[]; setsBuilt: number } {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	const proto = DependencyGraph.prototype as unknown as { getAffectedLinesByPosition: (n: number) => ReadonlySet<number> };
	const original = proto.getAffectedLinesByPosition;
	let setsBuilt = 0;
	proto.getAffectedLinesByPosition = function (this: DependencyGraph, n: number) {
		setsBuilt++;
		return original.call(this, n);
	};
	try {
		const shown = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(shownLine);
		return { shown, setsBuilt };
	} finally {
		proto.getAffectedLinesByPosition = original;
		evaluator.dispose();
	}
}

describe("the reported case: the first pass of a ledger", () => {
	test("answers every running total, as the batch pass does", () => {
		const lines = ledger(300);
		const { shown } = firstPass(lines);
		expect(shown).toEqual(read(newTrackedEngine().parseDocument(lines.join("\n"))));
		expect(shown.slice(0, 4)).toEqual(["1", "1", "1", "1"]);
	});

	test("the cycle walk builds no set of readers per line", () => {
		// The walk used to collect each line's readers into a set of its own
		// and hold it on its stack; it now reads them one at a time.
		expect(firstPass(ledger(300)).setsBuilt).toBe(0);
	});

	test("a ledger of 1,500 entries finishes within budget", () => {
		const started = performance.now();
		const { shown } = firstPass(ledger(1_500));
		expect(performance.now() - started).toBeLessThan(30_000);
		expect(shown.length).toBe(1_501);
	});

	test("a real cycle is still found", () => {
		const lines = ["line 2 + 1", "prev + 1", "5"];
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			let shown: string[] = [];
			for (let i = 0; i < 3; i++) shown = evaluator.evaluate({ startLine: 1, endLine: 3 }).lines.map(shownLine);
			expect(shown).toEqual(read(newTrackedEngine().parseDocument(lines.join("\n"))));
		} finally {
			evaluator.dispose();
		}
	});
});

describe("the three entry points", () => {
	test("evaluateDocument and parseDocument agree on a ledger, and evaluateLine refuses total above", () => {
		const text = ledger(50).join("\n");
		expect(read(evaluateDocument(newTrackedEngine(), text))).toEqual(read(newTrackedEngine().parseDocument(text)));
		const value = newTrackedEngine().evaluateExpression("total above");
		expect(value.type).toBe(ValueType.Error);
	});
});

describe("the parts: positionReadersOf", () => {
	const view = (tags: Record<number, string[]> = {}): DocumentView => ({ memberTags: (n) => tags[n] ?? [], isSummary: () => false });

	test("ordinary: the same readers getAffectedLinesByPosition collects, the line itself left out", () => {
		const dag = new DependencyGraph();
		dag.setDocumentView(view());
		for (let reader = 2; reader <= 6; reader++) for (let n = 1; n < reader; n++) dag.registerLinePositionDependency(reader, n);
		for (let n = 1; n <= 6; n++) {
			expect(new Set(dag.positionReadersOf(n))).toEqual(new Set(dag.getAffectedLinesByPosition(n)));
			expect([...dag.positionReadersOf(n)]).not.toContain(n);
		}
	});

	test("ordinary: a tag reader is among them", () => {
		const dag = new DependencyGraph();
		dag.setDocumentView(view({ 1: ["food"], 2: ["food"] }));
		dag.registerLineTagDependency(3, "food");
		expect([...dag.positionReadersOf(1)]).toEqual([3]);
		expect([...dag.positionReadersOf(3)]).toEqual([]);
	});

	test("boundary: an empty graph and a line nothing reads yield nothing", () => {
		const dag = new DependencyGraph();
		expect([...dag.positionReadersOf(1)]).toEqual([]);
		dag.registerLinePositionDependency(5, 4);
		expect([...dag.positionReadersOf(1)]).toEqual([]);
		expect([...dag.positionReadersOf(4)]).toEqual([5]);
	});

	test("boundary: it can be read part of the way and left", () => {
		const dag = new DependencyGraph();
		for (let reader = 2; reader <= 1_000; reader++) dag.registerLinePositionDependency(reader, 1);
		const readers = dag.positionReadersOf(1);
		expect(readers.next().done).toBe(false);
		expect(readers.return(undefined).done).toBe(true);
	});

	test("hostile: a position that is not a line yields nothing and throws nothing", () => {
		const dag = new DependencyGraph();
		dag.registerLinePositionDependency(3, 2);
		for (const n of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY, 2.5]) expect(() => [...dag.positionReadersOf(n)]).not.toThrow();
		expect([...dag.positionReadersOf(Number.NaN)]).toEqual([]);
	});

	test("hostile: tag names that are inherited properties", () => {
		expectPrototypeUntouched(() => {
			const dag = new DependencyGraph();
			dag.setDocumentView(view({ 1: [...PROTOTYPE_WORDS] }));
			for (const word of PROTOTYPE_WORDS) dag.registerLineTagDependency(2, word);
			expect([...new Set(dag.positionReadersOf(1))]).toEqual([2]);
		});
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a ledger of %s tags answers as the batch pass does", (word) => {
		expectPrototypeUntouched(() => {
			const lines = [...Array.from({ length: 30 }, (_, i) => `${i} #${word}`), `total of #${word}`];
			expect(firstPass(lines).shown).toEqual(read(newTrackedEngine().parseDocument(lines.join("\n"))));
		});
	});
});

describe("adversarial: realistic breakage", () => {
	test("an edit in the middle of a ledger, then a pass, agrees with a fresh one", () => {
		const lines = ledger(200);
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			doc.editLine(100, "7");
			const shown = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(shownLine);
			expect(shown).toEqual(read(newTrackedEngine().parseDocument(doc.getAllLines().map((l) => l.text).join("\n"))));
		} finally {
			evaluator.dispose();
		}
	});

	test("a section ledger and a tag ledger", () => {
		for (const lines of [["# Costs", ...Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? "1" : 'total of section "Costs"'))], Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? "1 #a" : "total of #a"))]) {
			expect(firstPass(lines).shown).toEqual(read(newTrackedEngine().parseDocument(lines.join("\n"))));
		}
	});
});

describe("adversarial: edge cases", () => {
	test("a ledger of one entry and a ledger of none", () => {
		expect(firstPass(["total above"]).shown).toEqual(read(newTrackedEngine().parseDocument("total above")));
		expect(firstPass(["1", "total above"]).shown).toEqual(["1", "1"]);
	});
});
