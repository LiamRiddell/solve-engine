/**
 * The tag scanner is linear in the length of the line.
 *
 * 2.38.1 taught `lineCarriesTag` to examine every occurrence of the tag, so a
 * line can query one group and join another. Each occurrence then did two
 * things costing the length of the line: it copied the whole prefix, and it ran
 * the opener pattern over that copy. The pattern is anchored at its end but not
 * its start, so the regex engine scans from every position.
 *
 * A line whose occurrences are *all* queries never takes the early return, so it
 * paid that per occurrence. Measured on one machine, the same call across that
 * change: 1,000 occurrences went from 0.10 ms to 11.4 ms, 16,000 from 0.09 ms to
 * 2,145 ms, a clean four times per doubling.
 *
 * The reachable shape is not a hand-written line: `aggregateTagged` runs the
 * scanner over the raw text of every line, including ones the evaluator
 * classifies as skippable markdown, so a table cell holding the text is enough
 * and the expression-length guard never applies.
 */
import { describe, expect, test } from "@jest/globals";
import { lineCarriesTag } from "@solve-js/packages/tags/TagScanner";

/**
 * Well past any line a person writes, so the bound below says something.
 * 200,000 occurrences is a 2.4 MB line.
 */
const OCCURRENCES = 200_000;

/**
 * A bound set from a measurement, the way the benchmark suites are (#364).
 *
 * The scanner does this in about 62 ms on the machine this was written on, so
 * the bound carries sixteen times headroom and will not flake on a loaded
 * runner. The implementation it replaced needed roughly five minutes for the
 * same input, so the bound still fails that by two orders of magnitude.
 */
const BUDGET_MS = 1000;

describe("cost", () => {
	test("a line of nothing but queries is scanned in linear time", () => {
		const line = "total of #a ".repeat(OCCURRENCES);
		const started = process.hrtime.bigint();
		const carries = lineCarriesTag(line, "a");
		const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

		// Every occurrence is a query, so the answer is that nothing joins.
		expect(carries).toBe(false);
		expect(elapsedMs).toBeLessThan(BUDGET_MS);
	});

	test("and so is a line of nothing but marks", () => {
		// This one returns on the second occurrence, so it was always fast. It is
		// here so that a future rewrite cannot make the early exit the only fast
		// path again.
		const line = "1 " + "#a ".repeat(OCCURRENCES);
		const started = process.hrtime.bigint();
		expect(lineCarriesTag(line, "a")).toBe(true);
		expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(BUDGET_MS);
	});
});

describe("every reading is the one 2.38.1 established", () => {
	test("a mark joins the group", () => {
		expect(lineCarriesTag("40 #food", "food")).toBe(true);
		expect(lineCarriesTag("40 + 15 #food and a note", "food")).toBe(true);
	});

	test("a query names the group without joining it", () => {
		expect(lineCarriesTag("total of #food", "food")).toBe(false);
		expect(lineCarriesTag("sum of #food", "food")).toBe(false);
		expect(lineCarriesTag("average of #food", "food")).toBe(false);
		expect(lineCarriesTag("count of #food", "food")).toBe(false);
	});

	test("a line can query one group and join another", () => {
		expect(lineCarriesTag("total of #food #reviewed", "food")).toBe(false);
		expect(lineCarriesTag("total of #food #reviewed", "reviewed")).toBe(true);
	});

	test("a heading is not a tagged line", () => {
		expect(lineCarriesTag("#food", "food")).toBe(false);
		expect(lineCarriesTag("   #food", "food")).toBe(false);
		// But a heading further along the line is an ordinary mark.
		expect(lineCarriesTag("# Notes #food", "food")).toBe(true);
	});

	test("the tag has to be the whole word", () => {
		expect(lineCarriesTag("40 #housingcost", "housing")).toBe(false);
		expect(lineCarriesTag("40 a#food", "food")).toBe(false);
		expect(lineCarriesTag("40 #FOOD", "food")).toBe(true);
	});

	test("an empty tag matches nothing", () => {
		expect(lineCarriesTag("40 #food", "")).toBe(false);
	});
});

describe("the window the bounded opener test draws", () => {
	test("ordinary whitespace between the words is still a query", () => {
		expect(lineCarriesTag("total   of   #food", "food")).toBe(false);
		expect(lineCarriesTag("average\tof\t#food", "food")).toBe(false);
	});

	test("but an opener pushed past the window reads as a mark", () => {
		// The boundary, stated: only the characters immediately in front of the
		// `#` are examined, so an opener separated from its tag by more
		// whitespace than that is not recognised. It then reads as a member,
		// which is what it was before queries were distinguished at all, so the
		// failure direction is the old behaviour rather than a new answer.
		expect(lineCarriesTag(`total of${" ".repeat(100)}#food`, "food")).toBe(true);
	});
});
