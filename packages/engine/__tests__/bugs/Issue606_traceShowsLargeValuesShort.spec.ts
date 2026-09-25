import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #606: `inputs of line N` formatted every traced value in full before
 * the size check. A 100,000-element list is 787,929 characters that take about
 * 2.3 s to format, so a five-line chain of it spent 12 s and was then refused
 * as too long. A trace now shows a large value short, and cuts it before
 * formatting, so the work is bounded as well as the text.
 */

/** The last line's answer through each document pass, with the slower pass's time. */
function trace(text: string): { batch: string; incremental: string; ms: number } {
	const read = (result: ParsingResult) => {
		const line = result.lines[result.lines.length - 1];
		return line.result ? formatValue(line.result) : `ERROR ${line.error}`;
	};
	let started = Date.now();
	const batch = read(newTrackedEngine().parseDocument(text));
	const batchMs = Date.now() - started;
	started = Date.now();
	const incremental = read(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text));
	return { batch, incremental, ms: Math.max(batchMs, Date.now() - started) };
}

const LIST = "[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, and 99,990 more]";

describe("a trace shows a large value short", () => {
	test("the survey's chain: five lines each holding a 100,000-element list", () => {
		const { batch, incremental, ms } = trace("v = map(x*1, 1:100000)\nw = v\nx2 = w\ny = x2\nz = y\ninputs of line 5");
		expect(batch).toBe(
			`= z ${LIST} (line 5) <- y ${LIST} (line 4) <- [x2 ${LIST} (line 3) <- [w ${LIST} (line 2) <- [v ${LIST} (line 1)]]]`,
		);
		expect(incremental).toBe(batch);
		// About 12,000 ms before, then refused.
		expect(ms).toBeLessThan(3_000);
	});

	test("one list", () => {
		const { batch, incremental } = trace("v = map(x*1, 1:100000)\ninputs of line 1");
		expect(batch).toBe(`= v ${LIST} (line 1) reads no other line`);
		expect(incremental).toBe(batch);
	});

	test("a list of ten is shown whole, and a list of eleven is not", () => {
		expect(trace("v = map(x*1, 1:10)\ninputs of line 1").batch).toBe("= v [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] (line 1) reads no other line");
		expect(trace("v = map(x*1, 1:11)\ninputs of line 1").batch).toBe("= v [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, and 1 more] (line 1) reads no other line");
	});

	test("a column keeps its semicolons", () => {
		expect(trace("c = transpose(map(x*1, 1:50))\ninputs of line 1").batch).toBe("= c [1; 2; 3; 4; 5; 6; 7; 8; 9; 10; and 40 more] (line 1) reads no other line");
	});

	test("a large matrix shows its shape, and a small one is shown whole", () => {
		expect(trace("m = transpose(map(x*1, 1:200)) * map(x*1, 1:200)\ninputs of line 1").batch).toBe("= m [200x200 matrix] (line 1) reads no other line");
		expect(trace("m = [1, 2; 3, 4]\ninputs of line 1").batch).toBe("= m [1, 2; 3, 4] (line 1) reads no other line");
	});

	test("a long text shows its first eighty characters and a count", () => {
		const { batch, incremental } = trace('s = repeat("ab", 100000)\ninputs of line 1');
		expect(batch).toBe(`= s ${"ab".repeat(40)}... and 199,920 more characters (line 1) reads no other line`);
		expect(incremental).toBe(batch);
	});
});

describe("adversarial: the cut is honest at its edges", () => {
	test("characters outside the Basic Multilingual Plane are never split, and are counted as one each", () => {
		expect(trace('s = repeat("😀", 100)\ninputs of line 1').batch).toBe(`= s ${"😀".repeat(40)}... and 60 more characters (line 1) reads no other line`);
		// 81 code units would put the cut inside the forty-first emoji.
		expect(trace('s = "a" + repeat("😀", 50)\ninputs of line 1').batch).toBe(`= s a${"😀".repeat(39)}... and 11 more characters (line 1) reads no other line`);
	});

	test("a text of exactly eighty characters is shown whole", () => {
		expect(trace(`s = repeat("ab", 40)\ninputs of line 1`).batch).toBe(`= s ${"ab".repeat(40)} (line 1) reads no other line`);
	});

	test("a chain of lines each holding the list stays bounded at the trace's own limits", () => {
		const chain = ["v1 = map(x*1, 1:100000)", ...Array.from({ length: 40 }, (_, i) => `v${i + 2} = v${i + 1}`)].join("\n");
		const { batch, ms } = trace(`${chain}\ninputs of line 41`);
		expect(batch.startsWith(`= v41 ${LIST} (line 41)`)).toBe(true);
		expect(batch.length).toBeLessThan(10_000);
		expect(ms).toBeLessThan(5_000);
	});

	test("a traced value that failed still reads as error", () => {
		expect(trace("a = 5 kg to m\nb = a + 1\ninputs of line 2").batch).toMatch(/^= b error \(line 2\) <- a error \(line 1\)$/);
	});
});
