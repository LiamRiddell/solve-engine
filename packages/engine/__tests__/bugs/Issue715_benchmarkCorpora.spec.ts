import { describe, expect, test } from "@jest/globals";
import { generateTierDocument, isCorpusProse, realisticDocument } from "@tools/benchmarkCorpora";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #715: the benchmarks measured the wrong thing. The throughput corpus
 * read `:v${i}` on lines where `v${i}` was never assigned, so 36% of the large
 * tier was the undefined-name error path; the document-parse corpus cycled 33
 * fixed lines, so past 250 lines every further line was a compile-cache hit,
 * and seven of the 33 failed (`8 L/100km in mpg`, and a `line 1` that read the
 * prose on line 1).
 *
 * Both corpora now live in `tools/benchmarkCorpora.ts`, where this spec checks
 * what they claim to be: every read of the throughput corpus names a variable
 * assigned above it, and every line of the document-parse corpus is distinct
 * and evaluates, except the prose, which takes the failed-parse path a real
 * note's prose takes. The benchmarks themselves run outside the ordinary
 * suite, so without this check a corpus could drift back unnoticed.
 */

/** Line counts: errors split into undefined names, prose that failed, and anything else. */
function survey(result: ParsingResult, lines: string[]): { undefinedNames: number; prose: number; other: string[] } {
	let undefinedNames = 0;
	let prose = 0;
	const other: string[] = [];
	result.lines.forEach((l, i) => {
		const failed = l.error !== null || (l.result !== null && formatValue(l.result).startsWith("= ERROR"));
		if (!failed) return;
		if (l.errorCode === "UNDEFINED_VARIABLE" || /Undefined variable/.test(l.error ?? "")) undefinedNames++;
		else if (isCorpusProse(lines[i])) prose++;
		else other.push(`${i + 1}: ${lines[i]} (${l.error})`);
	});
	return { undefinedNames, prose, other };
}

const TIERS = [
	{ name: "small", exprs: 100, lines: 100 },
	{ name: "medium", exprs: 500, lines: 1_000 },
	{ name: "large", exprs: 2_000, lines: 10_000 },
] as const;

describe("generateTierDocument (the throughput corpus)", () => {
	test.each(TIERS)("the $name tier reads no undefined name and has no errors", (tier) => {
		const text = generateTierDocument(tier.exprs, tier.lines);
		const lines = text.split("\n");
		expect(lines).toHaveLength(tier.lines);
		const counts = survey(newTrackedEngine().parseDocument(text), lines);
		expect(counts).toEqual({ undefinedNames: 0, prose: 0, other: [] });
	});

	test("every read names a variable assigned on an earlier line", () => {
		const lines = generateTierDocument(2_000, 10_000).split("\n");
		const assigned = new Set<string>();
		for (const line of lines) {
			const target = /^:(v\d+) = /.exec(line);
			if (target) { assigned.add(target[1]); continue; }
			for (const m of line.matchAll(/:(v\d+)/g)) expect(assigned.has(m[1])).toBe(true);
		}
	});

	test("boundary: one slot, zero lines, and a slot count past the line count", () => {
		expect(generateTierDocument(1, 3)).toBe(":v0 = 1\n:v1 = 2\n:v2 = 3");
		expect(generateTierDocument(5, 0)).toBe("");
		expect(generateTierDocument(1_000, 5).split("\n")).toEqual([":v0 = 1", ":v0 + 11", "sqrt(3)", "4% of 103", ":v0 * 5"]);
	});

	test("hostile: a non-positive or fractional slot count still writes a document that evaluates", () => {
		for (const slots of [0, -3, 2.7, Number.NaN]) {
			const text = generateTierDocument(slots, 12);
			const counts = survey(newTrackedEngine().parseDocument(text), text.split("\n"));
			expect({ slots, counts }).toEqual({ slots, counts: { undefinedNames: 0, prose: 0, other: [] } });
		}
	});
});

describe("realisticDocument (the document-parse corpus)", () => {
	test.each([50, 250, 1_000, 10_000])("%i lines, every one distinct, and only the prose fails", (n) => {
		const text = realisticDocument(n);
		const lines = text.split("\n");
		expect(lines).toHaveLength(n);
		expect(new Set(lines).size).toBe(n);
		const counts = survey(newTrackedEngine().parseDocument(text), lines);
		expect(counts.undefinedNames).toBe(0);
		expect(counts.other).toEqual([]);
	});

	test("about a quarter of it is prose", () => {
		const lines = realisticDocument(2_300).split("\n");
		const share = lines.filter(isCorpusProse).length / lines.length;
		expect(share).toBeGreaterThan(0.2);
		expect(share).toBeLessThan(0.4);
	});

	test("the cross-line forms resolve: `line N` reads its block's budget", () => {
		const result = newTrackedEngine().parseDocument(realisticDocument(23));
		const line22 = result.lines[21];
		expect(line22.text).toBe("line 2 + 100");
		expect(formatValue(line22.result!)).toBe("= 48,100");
	});

	test("the fuel-economy line uses the documented spelling and evaluates", () => {
		const line = realisticDocument(23).split("\n")[9];
		expect(line).toBe("4 l/100km in mpg");
		expect(formatValue(newTrackedEngine().evaluateExpression(line))).toBe("= 58.80 mpg");
	});

	test("boundary: zero lines, one line, and a cut inside a block", () => {
		expect(realisticDocument(0)).toBe("");
		expect(realisticDocument(1)).toBe("Notes from the garden planning session with Alice");
		expect(realisticDocument(24).split("\n").pop()).toBe("Notes from the kitchen planning session with Alice");
	});
});

describe("isCorpusProse (unit)", () => {
	test("ordinary: the corpus's prose templates", () => {
		for (const line of realisticDocument(23).split("\n").filter((_, i) => [0, 6, 11, 14, 18, 22].includes(i))) expect({ line, prose: isCorpusProse(line) }).toEqual({ line, prose: true });
	});

	test("boundary and hostile: expressions, empty lines, prototype words and markup are not prose", () => {
		for (const line of [":budget0 = 48000", "120 km/h to m/s", "line 2 + 100", "", ...PROTOTYPE_WORDS, ...TEXT_EDGES]) {
			expect({ line, prose: isCorpusProse(line) }).toEqual({ line, prose: false });
		}
	});
});

describe("adversarial", () => {
	test("security: both corpora at size leave Object.prototype alone and pass honestly", () => {
		expectPrototypeUntouched(() => {
			expectHonestDocument(generateTierDocument(500, 1_000), { budgetMs: 20_000 });
			// Its `now + N days` lines read the clock, so two passes a second apart
			// differ there; the agreement is checked below with those lines left out.
			expectHonestDocument(realisticDocument(1_000), { budgetMs: 20_000, agree: false });
		});
	});

	test("realistic breakage: the batch and incremental passes agree value for value on the document-parse corpus", () => {
		const text = realisticDocument(460);
		const read = (lines: ParsingResult["lines"]) => lines.map((l) => (l.result === null ? "" : formatValue(l.result)));
		const batch = read(newTrackedEngine().parseDocument(text).lines);
		const incremental = read(evaluateDocument(newTrackedEngine(), text).lines);
		// `now + N days` is a date relative to the clock, read twice; everything
		// else is fixed and must agree.
		const lines = text.split("\n");
		const fixed = (i: number) => !lines[i].startsWith("now ") && !isCorpusProse(lines[i]);
		expect(batch.filter((_, i) => fixed(i))).toEqual(incremental.filter((_, i) => fixed(i)));
	});

	test("edge cases: CRLF endings and a trailing newline change no answer", () => {
		const text = realisticDocument(46);
		const read = (t: string) => newTrackedEngine().parseDocument(t).lines.map((l) => (l.result === null ? "" : formatValue(l.result))).filter((_, i) => !text.split("\n")[i]?.startsWith("now "));
		expect(read(text.replace(/\n/g, "\r\n")).slice(0, 46)).toEqual(read(text));
		expect(read(`${text}\n`)).toEqual([...read(text), ""]);
	});
});
