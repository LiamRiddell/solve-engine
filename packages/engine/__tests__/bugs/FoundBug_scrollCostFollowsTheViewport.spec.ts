import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { PrefixSums } from "@solve-js/engine/PrefixSums";
import { VMCheckpointer } from "@solve-js/vm/VMCheckpoints";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Found bug: a viewport-only change cost more the longer the note. Measured on
 * a note of alternating definitions and reads, the median `setViewport` rose
 * from 2.0 ms at 5,000 lines to 6.6 ms at 20,000 for a jump of about a
 * thousand lines, and from 2.4 ms to 11.8 ms for a scroll of five lines (4.9
 * times), where a scroll runs the same forty lines at any size. Two walks of
 * the whole note sat in every scroll: `restoreTo` rebuilt the VM from every
 * checkpoint above the viewport, and the pass's starting budget summed what
 * every line above it had spent.
 *
 * The VM is now moved from the line it was left at (`VMCheckpointer.syncTo`),
 * which costs the distance scrolled, and the spend is kept in running totals by
 * position (`PrefixSums`), which a line that runs again changes in place.
 * After: 1.5 ms and 1.8 ms for the jump, 0.7 ms and 1.1 ms for the scroll.
 */

function alternating(count: number): string[] {
	const lines: string[] = [];
	for (let i = 0; lines.length < count; i++) {
		lines.push(`:v${i} = ${i + 1}`);
		lines.push(`v${i} * 2`);
	}
	return lines.slice(0, count);
}

function shownLine(line: EvalLineResult): string {
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	const text = formatValue(line.result).replace(/^=\s*/, "");
	return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
}

/** An evaluated note of `size` lines, with a counter of the document lookups a call makes. */
function evaluated(size: number) {
	const doc = new DocumentModel();
	doc.setDocument(alternating(size).join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	evaluator.evaluate({ startLine: 1, endLine: size });
	const lookups = (body: () => void): number => {
		const counted = doc as unknown as { getLinePosition: (id: number) => number; getLineAt: (n: number) => unknown };
		const position = counted.getLinePosition;
		const at = counted.getLineAt;
		let calls = 0;
		counted.getLinePosition = (id: number) => {
			calls++;
			return position.call(doc, id);
		};
		counted.getLineAt = (n: number) => {
			calls++;
			return at.call(doc, n);
		};
		try {
			body();
		} finally {
			counted.getLinePosition = position;
			counted.getLineAt = at;
		}
		return calls;
	};
	return { doc, evaluator, lookups };
}

describe("the reported case: a scroll costs the viewport, not the note", () => {
	test("a scroll of a few lines makes the same document lookups at 5,000 and 20,000 lines", () => {
		const counts = [5_000, 20_000].map((size) => {
			const { evaluator, lookups } = evaluated(size);
			// Once, to build what a scroll keeps between calls.
			evaluator.setViewport({ startLine: size - 200, endLine: size - 160 });
			const calls = lookups(() => evaluator.setViewport({ startLine: size - 195, endLine: size - 155 }));
			evaluator.dispose();
			return calls;
		});
		expect(counts[1]).toBeLessThanOrEqual(counts[0] * 1.1 + 20);
	});

	test("a scroll no longer rebuilds the VM from every checkpoint above it", () => {
		const { evaluator } = evaluated(2_000);
		const proto = VMCheckpointer.prototype as unknown as { restoreTo: (n: number) => void };
		const original = proto.restoreTo;
		let rebuilt = 0;
		proto.restoreTo = function (this: VMCheckpointer, n: number) {
			rebuilt++;
			original.call(this, n);
		};
		try {
			for (let at = 100; at < 1_900; at += 300) evaluator.setViewport({ startLine: at, endLine: at + 40 });
		} finally {
			proto.restoreTo = original;
			evaluator.dispose();
		}
		expect(rebuilt).toBe(0);
	});

	test("every scroll still answers what a pass from the top answers", () => {
		const size = 3_000;
		const { evaluator } = evaluated(size);
		const lines = alternating(size);
		const expected = (n: number) => {
			const i = Math.floor((n - 1) / 2);
			return n % 2 === 1 ? String(i + 1) : String((i + 1) * 2);
		};
		for (const at of [2_900, 10, 1_500, 1_505, 1_495, 2_999, 1]) {
			const view = evaluator.setViewport({ startLine: at, endLine: Math.min(at + 30, size) });
			const shown = view.lines.filter((l) => l.lineNumber >= at).map(shownLine);
			expect(shown).toEqual(Array.from({ length: shown.length }, (_, k) => expected(at + k).replace(/\B(?=(\d{3})+(?!\d))/g, ",")));
		}
		expect(lines.length).toBe(size);
		evaluator.dispose();
	});
});

describe("the three entry points", () => {
	test("a scroll's pass budget starts where a pass from the top would leave it", () => {
		// The budget counts line runs from line 1 (#711); a viewport pass starts
		// at what the lines above it recorded, which PrefixSums now answers.
		const lines = [...Array.from({ length: 6 }, () => "line 1 for x from 1 to 5 step 1"), "1", "line 7 for x from 1 to 5 step 1"];
		const engine = newTrackedEngine({ config: { vm: { maxLineRunsPerPass: 32 } } });
		const doc = new DocumentModel();
		doc.setDocument(["5", ...lines].join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, engine);
		try {
			const full = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(shownLine);
			const view = evaluator.setViewport({ startLine: 8, endLine: 9 }).lines.map(shownLine);
			expect(view).toEqual(full.slice(7));
			const batch = newTrackedEngine({ config: { vm: { maxLineRunsPerPass: 32 } } }).parseDocument(doc.getAllLines().map((l) => l.text).join("\n"));
			const last = batch.lines[8];
			const shown = last.result === null ? `ERROR ${last.error}` : `${last.result.type === ValueType.Error ? "ERROR " : ""}${formatValue(last.result).replace(/^=\s*/, "")}`;
			expect(shown).toBe(full[8]);
		} finally {
			evaluator.dispose();
		}
	});
});

describe("the parts: PrefixSums", () => {
	test("ordinary: sums before a position, and a change at one position", () => {
		const sums = new PrefixSums([1, 2, 3, 4, 5]);
		expect(sums.size).toBe(5);
		expect([1, 2, 3, 4, 5, 6].map((p) => sums.sumBefore(p))).toEqual([0, 1, 3, 6, 10, 15]);
		sums.add(3, 10);
		expect([1, 3, 4, 6].map((p) => sums.sumBefore(p))).toEqual([0, 3, 16, 25]);
		sums.add(3, -10);
		expect(sums.sumBefore(6)).toBe(15);
	});

	test("boundary: an empty run, the first and last positions, and a position past the end", () => {
		const empty = new PrefixSums([]);
		expect(empty.size).toBe(0);
		expect(empty.sumBefore(1)).toBe(0);
		empty.add(1, 5);
		expect(empty.sumBefore(99)).toBe(0);
		const sums = new PrefixSums([7]);
		expect(sums.sumBefore(1)).toBe(0);
		expect(sums.sumBefore(2)).toBe(7);
		expect(sums.sumBefore(Number.MAX_SAFE_INTEGER)).toBe(7);
	});

	test("boundary: a run of a hundred thousand agrees with a plain sum", () => {
		const values = Array.from({ length: 100_000 }, (_, i) => (i * 7919) % 13);
		const sums = new PrefixSums(values);
		for (let p = 1; p <= values.length; p += 997) {
			expect(sums.sumBefore(p)).toBe(values.slice(0, p - 1).reduce((a, b) => a + b, 0));
		}
	});

	test("hostile: positions and figures that are not numbers change nothing and throw nothing", () => {
		const sums = new PrefixSums([1, Number.NaN, Number.POSITIVE_INFINITY, 2]);
		expect(sums.sumBefore(5)).toBe(3);
		for (const position of [Number.NaN, 0, -1, 2.5, Number.POSITIVE_INFINITY]) sums.add(position, 100);
		sums.add(2, Number.NaN);
		sums.add(2, Number.POSITIVE_INFINITY);
		expect(sums.sumBefore(5)).toBe(3);
		expect(sums.sumBefore(Number.NaN)).toBe(0);
		expect(sums.sumBefore(-4)).toBe(0);
		expect(sums.sumBefore(2.9)).toBe(1);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a scroll over definitions of %s", (word) => {
		expectPrototypeUntouched(() => {
			const lines = [`:${word} = 1`, `${word} + 1`, `:${word} = 5`, `${word} + 1`, "prev"];
			const doc = new DocumentModel();
			doc.setDocument(lines.join("\n"));
			const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
			try {
				evaluator.evaluate({ startLine: 1, endLine: 5 });
				expect(evaluator.setViewport({ startLine: 2, endLine: 5 }).lines.map(shownLine)).toEqual(["2", "5", "6", "6"]);
				expect(evaluator.setViewport({ startLine: 4, endLine: 5 }).lines.map(shownLine)).toEqual(["6", "6"]);
				expect(evaluator.setViewport({ startLine: 2, endLine: 2 }).lines.map(shownLine)).toEqual(["2"]);
			} finally {
				evaluator.dispose();
			}
		});
	});

	test("two hundred scrolls over twenty thousand lines stay within budget", () => {
		const { evaluator } = evaluated(20_000);
		const started = performance.now();
		let at = 0;
		for (let i = 0; i < 200; i++) {
			at = (at + 997) % 19_900;
			evaluator.setViewport({ startLine: at + 1, endLine: at + 40 });
		}
		expect(performance.now() - started).toBeLessThan(20_000);
		evaluator.dispose();
	});
});

describe("adversarial: realistic breakage", () => {
	test("an edit, then scrolls: the edited line's spend is counted once", () => {
		const { doc, evaluator } = evaluated(400);
		doc.editLine(10, ":v4 = 1000");
		evaluator.evaluate({ startLine: 1, endLine: 40 });
		const view = evaluator.setViewport({ startLine: 10, endLine: 12 }).lines.map(shownLine);
		expect(view).toEqual(["1,000", "6", "12"]);
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 0, insertLines: [":v0 = 3"] }]);
		const after = evaluator.setViewport({ startLine: 11, endLine: 13 });
		expect(after.lines.filter((l) => l.lineNumber >= 11).map(shownLine)).toEqual(["1,000", "6", "12"]);
		evaluator.dispose();
	});
});

describe("adversarial: edge cases", () => {
	test.each(NUMERIC_EDGES)("a definition of %s scrolled past and back", (value) => {
		const lines = [":x = 1", `:x = ${value}`, "x", "prev"];
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			const full = evaluator.evaluate({ startLine: 1, endLine: 4 }).lines.map(shownLine);
			evaluator.setViewport({ startLine: 4, endLine: 4 });
			expect(evaluator.setViewport({ startLine: 3, endLine: 4 }).lines.map(shownLine)).toEqual(full.slice(2));
		} finally {
			evaluator.dispose();
		}
	});
});
