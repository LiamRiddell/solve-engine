import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { tagBreakdownHandler } from "@solve-js/packages/tags/TagsPluginFunctions";
import { numberValue, stringValue, uomValue, type Value } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #734: `total by tag` walked every line of the note on every call,
 * reading each line's tags again and totalling, formatting and sharing out
 * every group, so 500 breakdown lines over 500 tags took 6.9 s where one took
 * 48 ms. The groups now come from the tag index the document paths keep
 * (`LineExecutionContext.getTagGroups`, one object while the text is
 * unchanged), and the answer is kept against that object, the line left out
 * and the members' values, so every breakdown line asking the same question of
 * the same values is served the same answer.
 *
 * The batch pass's tag index listed a line twice when it carried one tag twice
 * (`$40 #food #Food`), so `total of #food` came to $80 through parseDocument
 * and $40 through evaluateDocument. It lists the line once now.
 */

// ── Helpers ─────────────────────────────────────────────────────────────

function answers(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.isError() ? `ERROR ${text}` : text;
	});
}
const batch = (lines: readonly string[]) => answers(newTrackedEngine().parseDocument(lines.join("\n")));
const incremental = (lines: readonly string[]) => answers(evaluateDocument(newTrackedEngine(), lines.join("\n")));

/** Both passes, which must agree; the batch answers. */
function both(lines: readonly string[]): string[] {
	const out = batch(lines);
	expect(incremental(lines)).toEqual(out);
	return out;
}

/** 500 lines each with its own tag, then `count` breakdown lines. */
function manyTags(tags: number, breakdowns: number): string[] {
	const lines = Array.from({ length: tags }, (_, i) => `$${i + 1} #t${i}`);
	for (let i = 0; i < breakdowns; i++) lines.push("total by tag");
	return lines;
}

/** A median of three timings, in milliseconds. */
function timed(work: () => void): number {
	const runs: number[] = [];
	for (let i = 0; i < 3; i++) {
		const started = performance.now();
		work();
		runs.push(performance.now() - started);
	}
	return runs.sort((a, b) => a - b)[1];
}

/**
 * A hand-built context over fixed lines, for the handler on its own. Every
 * line has its answer, above the asker or not, which no document pass gives,
 * so the handler's own rules are what the test sees.
 */
function contextOver(
	lines: Record<number, { text: string; value?: Value }>,
	options: { lineIndex: number; groups?: ReadonlyMap<string, readonly number[]> },
): LineExecutionContext {
	const count = Math.max(0, ...Object.keys(lines).map(Number));
	return {
		lineIndex: options.lineIndex,
		getLineCount: () => count,
		getLineText: (n) => (n >= 1 && n <= count ? lines[n]?.text ?? "" : undefined),
		getLineResult: (n) => lines[n]?.value,
		isLineBoundary: (n) => (lines[n]?.text ?? "").trim() === "" || /^\s*#/.test(lines[n]?.text ?? ""),
		getTagGroups: options.groups === undefined ? undefined : () => options.groups,
	};
}

const shown = (v: Value) => formatValue(v).replace(/^=\s*/, "");

// ── The tag index ───────────────────────────────────────────────────────

describe("DocumentModel.tagGroups", () => {
	test("every tag, lower-cased, with its lines ascending", () => {
		const doc = new DocumentModel();
		doc.setDocument(["$3 #Food", "$2 #fun", "# a #heading", "total of #food", "$1 #food #fun"].join("\n"));
		// A heading's own tag is indexed, and the aggregates pass the heading
		// over as a boundary; a line asking about a tag is not a member.
		expect([...doc.tagGroups()].sort()).toEqual([
			["food", [1, 5]],
			["fun", [2, 5]],
			["heading", [3]],
		]);
		expect(doc.linesCarryingTag("FOOD")).toEqual([1, 5]);
		expect(doc.linesCarryingTag("nothing")).toEqual([]);
	});

	test("the same object while the text is the same, and a new one after an edit", () => {
		const doc = new DocumentModel();
		doc.setDocument(["$1 #a", "$2 #b"].join("\n"));
		const first = doc.tagGroups();
		expect(doc.tagGroups()).toBe(first);
		doc.editLine(2, "$2 #b");
		expect(doc.tagGroups()).toBe(first);
		doc.editLine(2, "$2 #c");
		const second = doc.tagGroups();
		expect(second).not.toBe(first);
		expect([...second.keys()].sort()).toEqual(["a", "c"]);
	});

	test("a structural edit moves the positions", () => {
		const doc = new DocumentModel();
		doc.setDocument(["$1 #a", "$2 #a"].join("\n"));
		doc.applyChanges([{ startLine: 1, deleteCount: 0, insertLines: ["prose"] }]);
		expect(doc.tagGroups().get("a")).toEqual([2, 3]);
	});

	test("a line carrying one tag twice is one membership", () => {
		const doc = new DocumentModel();
		doc.setDocument("$40 #food #Food #FOOD");
		expect(doc.tagGroups().get("food")).toEqual([1]);
	});

	test("an empty note, and a note with no tag, have no groups", () => {
		for (const text of ["", "\n\n", "1\n2", "# heading"]) {
			const doc = new DocumentModel();
			doc.setDocument(text);
			expect(doc.tagGroups().size).toBe(0);
		}
	});

	test("prototype words are tags like any other", () => {
		expectPrototypeUntouched(() => {
			const doc = new DocumentModel();
			doc.setDocument(PROTOTYPE_WORDS.map((word, i) => `$${i + 1} #${word}`).join("\n"));
			const groups = doc.tagGroups();
			for (const [i, word] of PROTOTYPE_WORDS.entries()) expect(groups.get(word.toLowerCase())).toEqual([i + 1]);
		});
	});
});

// ── The handler on its own ──────────────────────────────────────────────

describe("the breakdown handler", () => {
	const lines = {
		1: { text: "$40 #food", value: uomValue(40, "USD") },
		2: { text: "$10 #fun", value: uomValue(10, "USD") },
		3: { text: "$50 #food #x", value: uomValue(50, "USD") },
		4: { text: "total by tag" },
	};
	const groups: ReadonlyMap<string, readonly number[]> = new Map([
		["food", [1, 3]],
		["fun", [2]],
		["x", [3]],
	]);

	test("reads its groups from the index, and agrees with the walk", () => {
		const fromIndex = tagBreakdownHandler([], contextOver(lines, { lineIndex: 4, groups }));
		const fromWalk = tagBreakdownHandler([], contextOver(lines, { lineIndex: 4 }));
		expect(shown(fromIndex)).toBe("food $90.00 (90%) · fun $10.00 (10%) · x $50.00 (50%)");
		expect(shown(fromWalk)).toBe(shown(fromIndex));
	});

	test("a line that asks and carries a tag leaves itself out, and a line that does not keeps it", () => {
		// Asked alternately, so a kept answer for one would be served to the other if the line left out were not part of the question.
		for (let i = 0; i < 3; i++) {
			expect(shown(tagBreakdownHandler([], contextOver(lines, { lineIndex: 3, groups })))).toBe("food $40.00 (80%) · fun $10.00 (20%)");
			expect(shown(tagBreakdownHandler([], contextOver(lines, { lineIndex: 4, groups })))).toBe("food $90.00 (90%) · fun $10.00 (10%) · x $50.00 (50%)");
			// Line 1 left out, `fun` is the first tag the members write.
			expect(shown(tagBreakdownHandler([], contextOver(lines, { lineIndex: 1, groups })))).toBe("fun $10.00 (17%) · food $50.00 (83%) · x $50.00 (83%)");
		}
	});

	test("a kept answer is served to the next line as a copy", () => {
		const first = tagBreakdownHandler([], contextOver(lines, { lineIndex: 4, groups }));
		const second = tagBreakdownHandler([], contextOver({ ...lines, 5: { text: "total by tag" } }, { lineIndex: 5, groups }));
		expect(second).not.toBe(first);
		expect(shown(second)).toBe(shown(first));
	});

	test("a member's new value is a new answer, whatever the index says", () => {
		const before = shown(tagBreakdownHandler([], contextOver(lines, { lineIndex: 4, groups })));
		const changed = { ...lines, 2: { text: "$10 #fun", value: uomValue(30, "USD") } };
		const after = shown(tagBreakdownHandler([], contextOver(changed, { lineIndex: 4, groups })));
		expect(before).toBe("food $90.00 (90%) · fun $10.00 (10%) · x $50.00 (50%)");
		expect(after).toBe("food $90.00 (75%) · fun $30.00 (25%) · x $50.00 (42%)");
	});

	test("a member with no answer, one that is text, one in another measure, and a zero whole are each refused by name", () => {
		const cases: [Record<number, { text: string; value?: Value }>, string][] = [
			[{ 1: { text: "$40 #food" }, 2: { text: "total by tag" } }, "Line 1 has not been evaluated yet"],
			[{ 1: { text: "hi #Food", value: stringValue("hi") }, 2: { text: "total by tag" } }, "Line 1, tagged #Food, is not a plain number or unit value."],
			[{ 1: { text: "$40 #food", value: uomValue(40, "USD") }, 2: { text: "3 kg #fun", value: uomValue(3, "kg") }, 3: { text: "total by tag" } }, "money and mass cannot be added. A breakdown needs every tagged line in one measure, so the tags share one whole."],
			[{ 1: { text: "0 #a", value: numberValue(0) }, 2: { text: "total by tag" } }, "The tagged lines add up to zero, so no tag has a share of them."],
			[{ 1: { text: "no tags here", value: numberValue(1) }, 2: { text: "total by tag" } }, "No lines carry a tag, so there is nothing to break down."],
		];
		for (const [doc, message] of cases) {
			const count = Object.keys(doc).length;
			const walked = tagBreakdownHandler([], contextOver(doc, { lineIndex: count }));
			expect(walked.errorMessage).toBe(message);
		}
	});

	test("a heading in a group is passed over", () => {
		const doc = { 1: { text: "# Travel #food" }, 2: { text: "$1 #food", value: uomValue(1, "USD") }, 3: { text: "total by tag" } };
		const withIndex = tagBreakdownHandler([], contextOver(doc, { lineIndex: 3, groups: new Map([["food", [1, 2]]]) }));
		expect(shown(withIndex)).toBe("food $1.00 (100%)");
	});

	test("an index naming a line past the end, or line 0, is passed over as a line with no figure", () => {
		const doc = { 1: { text: "$1 #a", value: uomValue(1, "USD") }, 2: { text: "total by tag" } };
		const hostile = new Map([["a", [0, 1, 99]]]);
		expect(shown(tagBreakdownHandler([], contextOver(doc, { lineIndex: 2, groups: hostile })))).toBe("a $1.00 (100%)");
	});
});

// ── Documents ───────────────────────────────────────────────────────────

describe("five hundred breakdowns cost about what one does", () => {
	test("the issue's document: every breakdown line shows the same breakdown, through both passes", () => {
		const lines = manyTags(500, 500);
		const out = both(lines);
		expect(out[500].startsWith("t0 $1.00 (<1%) · t1 $2.00 (<1%) · t2 $3.00 (<1%) · t3 $4.00 (<1%)")).toBe(true);
		expect(new Set(out.slice(500)).size).toBe(1);
	});

	test("500 breakdowns take a small multiple of one, where the walk took about 60 times", () => {
		const one = timed(() => batch(manyTags(500, 1)));
		const many = timed(() => batch(manyTags(500, 500)));
		expect(many / one).toBeLessThan(15);
	});

	test("the incremental pass is linear too, and a second pass is served from the kept answer", () => {
		const doc = new DocumentModel();
		doc.setDocument(manyTags(300, 300).join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		const first = timed(() => evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }));
		expect(first).toBeLessThan(10_000);
		const last = doc.getLineAt(600)!.result!;
		expect(formatValue(last).startsWith("= t0 $1.00 (<1%)")).toBe(true);
		evaluator.terminateWorker();
	});
});

describe("the batch pass counts a line once per tag (found beside #734)", () => {
	test.each([
		[["$40 #food #Food", "total of #food"], "$40.00"],
		[["$40 #food #Food", "count of #food"], "1"],
		[["$40 #food #Food", "average of #food"], "$40.00"],
		[["$40 #food #Food", "$10 #fun", "total by tag"], "food $40.00 (80%) · fun $10.00 (20%)"],
	])("%j", (lines, expected) => {
		expect(both(lines)[lines.length - 1]).toBe(expected);
	});
});

// ── Adversarial ─────────────────────────────────────────────────────────

describe("adversarial: realistic breakage", () => {
	test("a breakdown line that carries a tag is not a member of its own breakdown", () => {
		const out = both(["$5 #x", "$40 #food", "total by tag #food"]);
		expect(out[2]).toBe("x $5.00 (11%) · food $40.00 (89%)");
		// The same line without its tag reads the same two members.
		expect(both(["$5 #x", "$40 #food", "total by tag"])[2]).toBe(out[2]);
	});

	test("two breakdown lines that each carry a different tag", () => {
		const lines = ["$5 #a", "$7 #b", "total by tag #a", "total by tag #b"];
		const out = both(lines);
		// Each leaves itself out and reads the other, which is a member: the
		// first finds it not yet evaluated, and the second finds the first's
		// error.
		expect(out[2]).toBe("ERROR Line 4 has not been evaluated yet");
		expect(out[3]).toBe("ERROR Line 3 has an error");
	});

	test("an edit that changes a member's tag between passes", () => {
		const doc = new DocumentModel();
		doc.setDocument(["$40 #food", "$10 #fun", "total by tag", "total by tag"].join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		const view = () => ({ startLine: 1, endLine: doc.lineCount });
		evaluator.evaluate(view());
		expect(formatValue(doc.getLineAt(4)!.result!)).toBe("= food $40.00 (80%) · fun $10.00 (20%)");
		doc.editLine(2, "$10 #travel");
		evaluator.evaluate(view());
		evaluator.evaluate(view());
		const shownNow = [3, 4].map((n) => formatValue(doc.getLineAt(n)!.result!));
		expect(shownNow).toEqual(["= food $40.00 (80%) · travel $10.00 (20%)", "= food $40.00 (80%) · travel $10.00 (20%)"]);
		expect(shownNow.map((s) => s.replace(/^=\s*/, ""))).toEqual(batch(["$40 #food", "$10 #travel", "total by tag", "total by tag"]).slice(2));
		evaluator.terminateWorker();
	});

	test("an edit that changes a member's amount between passes", () => {
		const doc = new DocumentModel();
		doc.setDocument(["$40 #food", "$10 #fun", "total by tag"].join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		evaluator.evaluate({ startLine: 1, endLine: 3 });
		doc.editLine(1, "$90 #food");
		evaluator.evaluate({ startLine: 1, endLine: 3 });
		expect(formatValue(doc.getLineAt(3)!.result!)).toBe("= food $90.00 (90%) · fun $10.00 (10%)");
		evaluator.terminateWorker();
	});

	test("the breakdown meets a section and a tag total", () => {
		both(["# Costs", "$40 #food", "$10 #fun", "total by tag", 'total of section "Costs"', "total of #food"]);
	});
});

describe("adversarial: security", () => {
	test("prototype words as tags", () => {
		expectPrototypeUntouched(() => {
			const out = both(["$1 #constructor", "$2 #__proto__", "$3 #toString", "total by tag", "total by tag"]);
			expect(out[3]).toBe("constructor $1.00 (17%) · __proto__ $2.00 (33%) · toString $3.00 (50%)");
			expect(out[4]).toBe(out[3]);
		});
	});

	test("look-alike and markup-shaped text beside tagged lines", () => {
		for (const text of TEXT_EDGES) expectHonestDocument(["$1 #a", text, "$2 #b", "total by tag", "total by tag"].join("\n"));
	});

	test("two thousand tags and two thousand breakdowns stay within budget, and the note's limit refuses by name", () => {
		const { incremental: out } = expectHonestDocument(manyTags(2_000, 2_000).join("\n"), { budgetMs: 60_000 });
		expect(out[2_000].startsWith("= t0 $1.00 (<1%)")).toBe(true);
		expect(out[out.length - 1]).toContain("the most one note keeps (vm.maxRetainedElements)");
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negative and exact amounts", () => {
		expect(both(["$0.10 #a", "$0.20 #a", "-$0.05 #b", "total by tag"])[3]).toBe("a $0.30 (120%) · b -$0.05 (-20%)");
	});

	test("a breakdown in a note of one line, and one before its members", () => {
		expect(both(["total by tag"])[0]).toBe("ERROR No lines carry a tag, so there is nothing to break down.");
		expect(both(["total by tag", "$1 #a"])[0]).toBe("ERROR Line 2 has not been evaluated yet");
	});

	test("CRLF, a lone carriage return and a trailing line break", () => {
		expectHonestDocument("$1 #a\r\n$2 #b\r\ntotal by tag\r\n");
		expectHonestDocument("$1 #a\r$2 #b\rtotal by tag\r");
	});
});
