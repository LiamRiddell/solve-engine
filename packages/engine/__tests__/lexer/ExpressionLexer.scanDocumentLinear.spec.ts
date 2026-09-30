/**
 * A whole-document scan costs each line what that line costs, not what the
 * rest of the document costs.
 *
 * `classifyFromPositions` used to look for the inline-solve opener with
 * `input.indexOf("s\`", pos)` and only then check that the hit fell inside the
 * line. When `scanDocument` is classifying, `input` is the whole document, so
 * a line with no marker scanned to the end of the document before the check
 * rejected the hit: every line paid for every line after it, and the scan was
 * quadratic in line count. A profile of a 10,000-line parse put two thirds of
 * the self time in that one function. The wikilink close had the same shape.
 *
 * Two things are pinned here. The searches are now bounded to the line, so the
 * classification of a line is exactly what classifying that line on its own
 * gives (a marker on a later line must neither influence nor cost anything),
 * and the scan of a document four times as long costs about four times as
 * much rather than sixteen.
 */

import { describe, expect, test } from "@jest/globals";
import { Lexer } from "@solve-js/lexer/Lexer";

/** Prose with many candidate `s` characters and no inline solve, the shape that scanned worst. */
const PROSE_LINE = "Sales figures since last session suggest sensible savings, so seasonal staff stays";

function proseDocument(lines: number, tail: string): string {
	return Array.from({ length: lines }, () => PROSE_LINE).join("\n") + "\n" + tail;
}

/**
 * Milliseconds for one full scan of each text, as the fastest of several runs.
 *
 * Interference on a shared machine (a collection, another process, the JIT
 * moving a function up a tier) only ever adds time, so the fastest run is the
 * closest to the scan's own cost. The texts take turns, so a slow stretch of
 * the machine lands on both rather than on one. A median of five, taken for one
 * text and then the other, moved the four-to-one ratio between 3 and 9.6 on an
 * unchanged tree.
 */
export function fastestScanMs(lexer: Lexer, texts: readonly string[], runs = 9): number[] {
	const collect = (globalThis as { gc?: () => void }).gc;
	const fastest = texts.map(() => Infinity);
	for (let i = 0; i < runs; i++) {
		texts.forEach((text, t) => {
			collect?.();
			const started = performance.now();
			lexer.scanDocument(text);
			fastest[t] = Math.min(fastest[t], performance.now() - started);
		});
	}
	return fastest;
}

describe("scanDocument reads no further than the line it is classifying", () => {
	test("a marker on a later line does not change how an earlier line classifies", () => {
		const lexer = new Lexer("en");
		const lines = [
			"1 + 2",
			"- 100 + 20",
			"3. 4 + 4",
			"#fff + #000",
			"[[unclosed on this line",
			"![[also unclosed",
			"plain prose with an s in it",
			"the answer is s`5 * 5` today",
			"]] and a closer that belongs to nothing",
		];
		const scanned = lexer.scanDocument(lines.join("\n"));

		expect(scanned).toHaveLength(lines.length);
		lines.forEach((line, i) => {
			const alone = lexer.classifyLine(line);
			const { contentOffset, ...inDocument } = scanned[i].classification;
			const { contentOffset: aloneOffset, ...aloneRest } = alone;
			expect(inDocument).toEqual(aloneRest);
			// A content offset is absolute in a document scan and relative to the
			// line on its own; the two agree once the line's start is taken off.
			expect(contentOffset === undefined ? undefined : contentOffset - scanned[i].startOffset).toBe(aloneOffset);
		});
		// The one line that really holds a marker is the only one flagged.
		expect(scanned.map((r) => r.classification.hasInlineSolve)).toEqual(lines.map((line) => line.includes("s`")));
	});

	test("fastestScanMs times a real scan and keeps the fastest run", () => {
		const lexer = new Lexer("en");
		const [ms, empty] = fastestScanMs(lexer, [proseDocument(100, ""), ""], 3);
		expect(Number.isFinite(ms)).toBe(true);
		expect(ms).toBeGreaterThanOrEqual(0);
		// An empty document still scans, and no runs leaves nothing measured.
		expect(Number.isFinite(empty)).toBe(true);
		expect(fastestScanMs(lexer, [""], 0)).toEqual([Infinity]);
		expect(fastestScanMs(lexer, [], 3)).toEqual([]);
	});

	test("a wikilink closed only on a later line is not a wikilink", () => {
		const lexer = new Lexer("en");
		const scanned = lexer.scanDocument("[[note\n1 + 1 ]]");
		expect(scanned[0].classification.type).toBe("expression");
		expect(scanned[1].classification.type).toBe("expression");
	});

	test("scanning four times the prose costs about four times as much, not sixteen", () => {
		/*
		 * The tail holds the only inline solve, so under the old search every
		 * one of the prose lines scanned all the way to it. Linear behaviour
		 * gives a ratio near 4; the quadratic behaviour this guards against gave
		 * a clean 16. The bound is set well clear of both, so a loaded machine
		 * cannot fail it and a regression cannot pass it.
		 */
		const lexer = new Lexer("en");
		const tail = "total is s`1 + 1` here";
		// Both sizes sit above the point where a scan starts paying for young
		// collections. At 4,000 and 16,000 lines only the larger did, and the
		// smaller one's time swung between 6 and 18 ms from run to run.
		const small = proseDocument(8_000, tail);
		const large = proseDocument(32_000, tail);
		// Warm the scanner so neither measurement pays for a cold path.
		fastestScanMs(lexer, [small, large], 2);

		const [smallMs, largeMs] = fastestScanMs(lexer, [small, large], 7);

		expect(largeMs / smallMs).toBeLessThan(9);
	});
});
