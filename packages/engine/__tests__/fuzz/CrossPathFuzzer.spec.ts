import { describe, expect, test } from "@jest/globals";
import { generateCrossPathCase } from "@tools/fuzz/CrossPathFuzzer";
import { compareResults, lineAnswer, runCrossPathCase } from "@tools/fuzz/CrossPathOracle";
import { caseSize, shrink } from "@tools/fuzz/Shrink";
import { caseId } from "@tools/fuzz/Corpus";
import type { CrossPathCase } from "@tools/fuzz/FuzzCase";
import type { ParsedLine, ParsingResult } from "@solve-js/types/ParsingResult";
import { errorValue, numberValue } from "@solve-js/vm/Value";

/**
 * The cross-path generator (#688): one document asked of `parseDocument` and
 * `evaluateDocument`, compared line for line.
 */

/** A minimal parsed line, for the comparison's unit tests. */
function line(fields: Partial<ParsedLine>): ParsedLine {
	return { lineNumber: 1, text: "", startPosition: 0, endPosition: 0, isEmpty: false, hasInlineSolves: false, inlineSolves: [], expression: null, error: null, result: null, ...fields } as ParsedLine;
}
const result = (lines: ParsedLine[]) => ({ lines }) as unknown as ParsingResult;

describe("generateCrossPathCase", () => {
	test("is deterministic, and never emits goal seek, which only one pass supports", () => {
		for (let seed = 0; seed < 300; seed++) {
			const a = generateCrossPathCase(seed);
			expect(JSON.stringify(generateCrossPathCase(seed))).toBe(JSON.stringify(a));
			expect(a.kind).toBe("crosspath");
			expect(a.lines.length).toBeGreaterThanOrEqual(1);
			expect(a.lines.some((text) => /^\s*solve line /.test(text))).toBe(false);
		}
	});

	test("sometimes ends in a line break, the shape #613 was", () => {
		const endings = Array.from({ length: 300 }, (_, seed) => generateCrossPathCase(seed).lines.at(-1));
		expect(endings.filter((text) => text === "").length).toBeGreaterThan(10);
	});
});

describe("compareResults", () => {
	test("agrees when every line reads the same", () => {
		const a = result([line({ result: numberValue(5) }), line({})]);
		const b = result([line({ result: numberValue(5) }), line({})]);
		expect(compareResults(a, b)).toBeNull();
	});

	test("a line error and an error value with the same text are the same answer", () => {
		// Where the failure is carried differs between the passes by design
		// until 3.0; the text is what is compared.
		const a = result([line({ error: "Undefined variable: x" })]);
		const b = result([line({ result: errorValue("UNDEFINED_VARIABLE", "Undefined variable: x") })]);
		expect(lineAnswer(a.lines[0])).toBe("error: Undefined variable: x");
		expect(compareResults(a, b)).toBeNull();
	});

	test("a different answer is found, with its line", () => {
		const a = result([line({ result: numberValue(1) }), line({ result: numberValue(2) })]);
		const b = result([line({ result: numberValue(1) }), line({ result: numberValue(3) })]);
		expect(compareResults(a, b)).toEqual({ line: 2, batch: "2", incremental: "3" });
	});

	test("a different line count is found", () => {
		expect(compareResults(result([line({})]), result([line({}), line({})]))).toEqual({ line: 0, batch: "1 lines", incremental: "2 lines" });
	});
});

describe("runCrossPathCase", () => {
	test("both passes agree on an ordinary document", () => {
		const outcome = runCrossPathCase({ kind: "crosspath", lines: ["rent: $500", "food: $200", "total above", "", ":x = 3", "x * 2"] });
		expect(outcome.kind).toBe("ok");
	});

	test("the #613 shape agrees now: a trailing line break is not a line on either pass", () => {
		expect(runCrossPathCase({ kind: "crosspath", lines: ["1", "2", ""] }).kind).toBe("ok");
	});

	test("the #803 shape, its first finding, agrees now that #803 is fixed", () => {
		// It was reported as `line 1: parseDocument says "0", evaluateDocument
		// says "error: Line 3 has not been evaluated yet ..."`; the corpus keeps
		// the reduced finding as a fixed entry, replayed on every run.
		const outcome = runCrossPathCase({ kind: "crosspath", lines: ['count of section "Home"', "# Home", "// note 5"] });
		expect(outcome.kind).toBe("ok");
	});
});

describe("shrinking and the corpus", () => {
	const noisy: CrossPathCase = { kind: "crosspath", lines: ["10", "20", 'count of section "Home"', "# Home", "// note 5", "30"] };
	// A stand-in for a disagreement, since the one this generator first found
	// (#803) is fixed: the property holds while the reader and the comment it
	// read are both still in the document, which is what a real reduction of
	// that finding kept.
	const stillDisagrees = (candidate: { kind: string }) =>
		candidate.kind === "crosspath" &&
		(candidate as CrossPathCase).lines.includes('count of section "Home"') &&
		(candidate as CrossPathCase).lines.includes("// note 5");

	test("a disagreement shrinks to the lines that cause it, and never below one line", () => {
		const reduced = shrink(noisy, stillDisagrees);
		expect((reduced.input as CrossPathCase).lines).toEqual(['count of section "Home"', "// note 5"]);
		expect(reduced.input.kind).toBe("crosspath");
		const lines = (reduced.input as CrossPathCase).lines;
		expect(lines.length).toBeGreaterThanOrEqual(1);
		expect(lines.length).toBeLessThan(noisy.lines.length);
		expect(caseSize(reduced.input)).toBe(lines.length);
	});

	test("the same document gets the same corpus id", () => {
		expect(caseId({ ...noisy })).toBe(caseId(noisy));
		expect(caseId({ kind: "crosspath", lines: ["1"] })).not.toBe(caseId(noisy));
	});
});
