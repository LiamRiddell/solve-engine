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

/** Milliseconds for one full scan, as the median of a few runs so a single hiccup cannot decide the test. */
function medianScanMs(lexer: Lexer, text: string, runs = 5): number {
	const samples: number[] = [];
	for (let i = 0; i < runs; i++) {
		const started = performance.now();
		lexer.scanDocument(text);
		samples.push(performance.now() - started);
	}
	samples.sort((a, b) => a - b);
	return samples[Math.floor(samples.length / 2)];
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
		const small = proseDocument(4_000, tail);
		const large = proseDocument(16_000, tail);
		// Warm the scanner once so neither measurement pays for a cold path.
		lexer.scanDocument(small);

		const smallMs = medianScanMs(lexer, small);
		const largeMs = medianScanMs(lexer, large);

		expect(largeMs / smallMs).toBeLessThan(9);
	});
});
