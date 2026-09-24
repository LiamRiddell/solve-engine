/**
 * What-if and sweeps, `line N with <name> = <value>` and `line N for <name>
 * from <a> to <b> step <s>` (GitHub issue #505), and the host's
 * `engine.whatIf(text, overrides)`.
 *
 * Goal seek re-runs one line with one name bound, so an input that reaches its
 * target through another line is out of its reach. These forms re-run every
 * line from the top of the document to the target, from their text, in a
 * scratch engine, so the input flows through every line between, and nothing
 * the document holds is touched.
 *
 * Three properties matter, and each has its own block below: the answer is the
 * one a reader would get by editing the input and re-reading the target (units
 * and all); every refusal is a named error rather than a guess or a hang; and
 * the note reads the same before and after, through both document passes and
 * through an editing session.
 */
import { describe, expect, test } from "@jest/globals";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { Value, ValueType, uomValue } from "@solve-js/vm/Value";
import { EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { SWEEP_MAX_STEPS } from "@solve-js/packages/whatif";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Each line as a reader sees it: the answer, or `ERROR: <message>` whether the
 * line threw (the batch pass) or returned an error Value (the incremental pass
 * stores a throw that way). The codes are read separately, by {@link codeOf}.
 */
function readLines(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR: ${line.error}`;
		if (!line.result) return "";
		const shown = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR: ${shown}` : shown;
	});
}

/** The batch pass, `parseDocument`. */
function batch(lines: string[]): string[] {
	return readLines(newTrackedEngine().parseDocument(lines.join("\n")));
}

/** The incremental pass, `evaluateDocument`. */
function incremental(lines: string[]): string[] {
	return readLines(evaluateDocument(newTrackedEngine(), lines.join("\n")));
}

/** Both passes, asserted to agree line for line, then the shared answer. */
function both(lines: string[]): string[] {
	const fromBatch = batch(lines);
	expect(incremental(lines)).toEqual(fromBatch);
	return fromBatch;
}

/** The error code a line returned, or null when it did not return an error Value. */
function codeOf(lines: string[], n: number): string | null {
	const result = newTrackedEngine().parseDocument(lines.join("\n")).lines[n - 1]?.result;
	return result && result.type === ValueType.Error ? String(result.value) : null;
}

/** The mortgage from the issue: line 3 reads deposit, line 4 reads line 3's payment. */
const MORTGAGE = [
	"deposit = 100000",
	"rate = 4%",
	"payment = monthly repayment on deposit over 25 years at rate",
	"payment * 12",
];

describe("a what-if re-runs the lines between", () => {
	test("an input the target reads through another line reaches it", () => {
		// Line 4 does not name deposit; it reads payment, which line 3 computes
		// from deposit. Goal seek refuses this shape; a what-if follows it.
		const out = both([...MORTGAGE, "line 4 with deposit = 150000"]);
		expect(out[4]).toBe("9,501.06");
	});

	test("the answer is the one editing the input gives", () => {
		const edited = batch(["deposit = 150000", ...MORTGAGE.slice(1)]);
		expect(both([...MORTGAGE, "line 4 with deposit = 150000"])[4]).toBe(edited[3]);
	});

	test("several inputs at once, joined by and or a comma", () => {
		const out = both([...MORTGAGE, "line 4 with deposit = 150000 and rate = 5%", "line 4 with deposit = 150000, rate = 5%"]);
		expect(out.slice(4)).toEqual(["10,522.62", "10,522.62"]);
	});

	test("money stays money", () => {
		const out = both(["price = $100", "qty = 3", "price * qty", "line 3 with price = $120"]);
		expect(out[3]).toBe("$360.00");
	});

	test("a quantity keeps its unit", () => {
		const out = both(["m = 2 kg", "a = 3", "m * a", "line 3 with m = 5 kg"]);
		expect(out[3]).toBe("15.00 kg");
	});

	test("the value is an ordinary expression", () => {
		const out = both(["x = 5", "x * 2", "line 2 with x = 10 + line 1"]);
		expect(out[2]).toBe("30");
	});

	test("a what-if is a value like any other inside a larger expression", () => {
		const out = both([...MORTGAGE, "(line 4 with deposit = 150000) - line 4"]);
		expect(out[4]).toBe("3,167.02");
	});

	test("an input a user function reads reaches the call", () => {
		const out = both(["f(n) = n * rate", "rate = 3", "f(2)", "line 3 with rate = 10"]);
		expect(out[3]).toBe("20");
	});

	test("an input read by a running total reaches it", () => {
		const out = both(["total += 5", "total += x", "x = 1", "line 2 with x = 10"]);
		expect(out[3]).toBe("15");
	});

	test("an input set between two lines stays at the override below its definition", () => {
		// y is defined from x, then overridden directly: the definition's own
		// right-hand side is set aside, and every line below reads 100.
		const out = both(["x = 5", "y = x + 1", "y * 2", "line 3 with y = 100", "line 3 with x = 100"]);
		expect(out.slice(3)).toEqual(["200", "202"]);
	});

	test("the line that sets the input reads as the override", () => {
		const out = both(["deposit = 100000", "deposit * 2", "line 1 with deposit = 5", "line 2 with deposit = 5"]);
		expect(out.slice(2)).toEqual(["5", "10"]);
	});

	test("a target below the what-if is read from its text", () => {
		const out = both(["line 3 with x = 2", "x = 5", "x * 2"]);
		expect(out[0]).toBe("4");
	});

	test("a seeded draw repeats in the re-run, so only the input moves the answer", () => {
		const out = both(["random seed 7", "x = 1", "roll(1, 100) + x", "line 3 with x = 1", "line 3 for x from 1 to 3 step 1"]);
		expect(out[3]).toBe(out[2]);
		expect(out[4]).toBe("[51, 52, 53]");
	});

	test("the spellings the grammar reads", () => {
		const out = both(["x = 5", "x * 2", "line2 with x = 3", "line 2 with x=3", "LINE 2 WITH x = 3"]);
		expect(out.slice(2)).toEqual(["6", "6", "6"]);
	});
});

describe("a sweep lists the target's answers across a range", () => {
	test("the issue's rates, through the line between", () => {
		const out = both([...MORTGAGE, "line 4 for rate from 3% to 6% step 1%"]);
		expect(out[4]).toBe("[5,690.54, 6,334.04, 7,015.08, 7,731.62]");
	});

	test("each answer is what the matching what-if gives", () => {
		const out = both([
			...MORTGAGE,
			"line 4 for rate from 3% to 6% step 1%",
			"line 4 with rate = 3%",
			"line 4 with rate = 6%",
		]);
		expect(out[4].startsWith(`[${out[5]},`)).toBe(true);
		expect(out[4].endsWith(`, ${out[6]}]`)).toBe(true);
	});

	test("a range can run downwards", () => {
		const out = both(["x = 5", "# heading", "x * 2", "line 3 for x from 3 to 1 step -1"]);
		expect(out[3]).toBe("[6, 4, 2]");
	});

	test("a quantity range steps in the start's unit, converting the others", () => {
		const out = both(["m = 2 kg", "a = 3", "m * a", "line 3 for m from 1 kg to 2 kg step 500 g"]);
		expect(out[3]).toBe("[3, 4.50, 6]");
	});

	test("a money range lists the amounts, the way every list does", () => {
		const out = both(["price = $100", "qty = 3", "price * qty", "line 3 for price from $100 to $300 step $50"]);
		expect(out[3]).toBe("[300, 450, 600, 750, 900]");
	});

	test("a step that does not land on the end stops before it", () => {
		const out = both(["x = 5", "x * 2", "line 2 for x from 1 to 4 step 2", "line 2 for x from 5 to 5 step 1"]);
		expect(out.slice(2)).toEqual(["[2, 6]", "[10]"]);
	});

	test("a fractional step lands on its end despite binary rounding", () => {
		const out = both(["x = 5", "x * 2", "line 2 for x from 0.1 to 0.3 step 0.1", "line 2 for x from 1 to 2 step 0.25"]);
		expect(out.slice(2)).toEqual(["[0.20, 0.40, 0.60]", "[2, 2.50, 3, 3.50, 4]"]);
	});

	test("step stays usable as a variable name", () => {
		const out = both(["step = 2", "x = 1", "x * step", "line 3 for x from 1 to 3 step step", "line 3 for step from 1 to 3 step 1"]);
		expect(out.slice(3)).toEqual(["[2, 6]", "[1, 2, 3]"]);
	});

	test("an as written after the sweep applies to the whole list", () => {
		const result = newTrackedEngine().parseDocument(["x = 5", "x * 2", "line 2 for x from 1 to 4 step 1 as sparkline"].join("\n"));
		expect(result.lines[2].result?.type).toBe(ValueType.Chart);
	});
});

describe("every refusal is named", () => {
	const doc = ["x = 5", "x * 2"];

	test("a zero step", () => {
		expect(codeOf([...doc, "line 2 for x from 1 to 3 step 0"], 3)).toBe("SWEEP_STEP_ZERO");
	});

	test("a step that moves away from the end", () => {
		expect(codeOf([...doc, "line 2 for x from 1 to 3 step -1"], 3)).toBe("SWEEP_STEP_WRONG_SIGN");
		expect(codeOf([...doc, "line 2 for x from 3 to 1 step 1"], 3)).toBe("SWEEP_STEP_WRONG_SIGN");
	});

	test("more steps than the limit", () => {
		expect(codeOf([...doc, `line 2 for x from 1 to ${SWEEP_MAX_STEPS + 1} step 1`], 3)).toBe("SWEEP_TOO_MANY_STEPS");
		// The limit itself is allowed.
		const atLimit = newTrackedEngine().parseDocument([...doc, `line 2 for x from 1 to ${SWEEP_MAX_STEPS} step 1`].join("\n"));
		expect(atLimit.lines[2].result?.type).toBe(ValueType.Matrix);
	});

	test("more line re-runs than the limit, before any of them runs", () => {
		const long = Array.from({ length: 199 }, (_, i) => `v${i} = ${i}`);
		const lines = ["x = 1", ...long, "x * 2", "line 201 for x from 1 to 1000 step 1"];
		expect(codeOf(lines, 202)).toBe("SWEEP_TOO_MUCH_WORK");
	});

	test("a range whose start, end and step are different kinds of value", () => {
		expect(codeOf([...doc, "line 2 for x from 3% to 6% step 1"], 3)).toBe("SWEEP_RANGE_MISMATCH");
		expect(codeOf([...doc, "line 2 for x from 1 to 3 step 1 kg"], 3)).toBe("SWEEP_RANGE_MISMATCH");
		expect(codeOf([...doc, "line 2 for x from 1 kg to 3 m step 1 kg"], 3)).toBe("INCOMPATIBLE_UNITS");
		expect(codeOf([...doc, 'line 2 for x from "a" to 3 step 1'], 3)).toBe("SWEEP_RANGE_NOT_NUMERIC");
	});

	test("an answer a list cannot hold", () => {
		expect(codeOf(["x = 1", "if x > 2 then 1 kg else 1 m", "line 2 for x from 1 to 4 step 1"], 3)).toBe("INCOMPATIBLE_UNITS");
		expect(codeOf(["x = 1", "sqrt(x - 3)", "line 2 for x from 1 to 5 step 1"], 3)).toBe("SWEEP_ANSWER_NOT_NUMERIC");
	});

	test("a step whose answer fails names the value it failed at", () => {
		// A two-item list indexed from 0 has no item 2.
		const lines = ["x = 0", "[10, 20][x]", "line 2 for x from 0 to 3 step 1"];
		const out = batch(lines);
		expect(codeOf(lines, 3)).toBe("SWEEP_STEP_FAILED");
		expect(out[2]).toContain("With x at 2, line 2 has no answer");
	});

	test("an input no line uses, which is almost always a misspelling", () => {
		expect(codeOf([...doc, "line 2 with y = 3"], 3)).toBe("WHAT_IF_INPUT_NOT_USED");
		expect(codeOf([...doc, "line 2 with X = 3"], 3)).toBe("WHAT_IF_INPUT_NOT_USED");
		expect(codeOf([...doc, "line 2 for y from 1 to 3 step 1"], 3)).toBe("WHAT_IF_INPUT_NOT_USED");
	});

	test("a what-if naming its own line", () => {
		expect(codeOf([...doc, "line 3 with x = 1"], 3)).toBe("WHAT_IF_TARGETS_ITSELF");
	});

	test("a line past the end of the document", () => {
		expect(codeOf([...doc, "line 9 with x = 1"], 3)).toBe("WHAT_IF_LINE_OUT_OF_RANGE");
	});

	test("a target that is not a calculation", () => {
		expect(codeOf(["x = 5", "# heading", "x * 2", "line 2 with x = 1"], 4)).toBe("WHAT_IF_TARGET_NOT_A_CALCULATION");
	});

	test("a what-if inside another's re-run", () => {
		expect(codeOf([...doc, "line 2 with x = 10", "line 3 with x = 1"], 4)).toBe("WHAT_IF_NESTED");
	});

	test("a span holding a line that sets a global, which other documents read", () => {
		try {
			expect(codeOf(["x = 1", "global :whatIfSpecG = x * 2", "x + 1", "line 3 with x = 5"], 4)).toBe("WHAT_IF_WRITES_GLOBAL");
			// The document's own pass wrote 2; a re-run at x = 5 would have written 10.
			expect(sharedGlobalVariableStore.get("whatIfSpecG")?.toNumber()).toBe(2);
		} finally {
			sharedGlobalVariableStore.clear();
		}
	});

	test("the same input given twice, or a sweep with no step, is a parse error", () => {
		const out = batch([...doc, "line 2 with x = 1 and x = 2", "line 2 for x from 1 to 3"]);
		expect(out[2]).toBe("ERROR: This what-if sets x twice. Give each input once.");
		expect(out[3]).toContain("A sweep needs a step");
	});
});

describe("the note reads the same before and after", () => {
	const WITH_FORMS = [
		...MORTGAGE,
		"line 4 with deposit = 150000",
		"line 4 for rate from 3% to 6% step 1%",
		"deposit",
		"rate",
		"payment",
		"line 3",
	];

	test("every ordinary line answers as it does in the note without the forms", () => {
		const without = both([...MORTGAGE, "deposit", "rate", "payment", "line 3"]);
		const withForms = both(WITH_FORMS);
		expect([...withForms.slice(0, 4), ...withForms.slice(6)]).toEqual(without);
	});

	test("the engine's variables and cached results are untouched after a batch pass", () => {
		const engine = newTrackedEngine();
		engine.parseDocument(WITH_FORMS.join("\n"));
		expect(formatValue(engine.evaluateExpression("deposit"))).toBe("= 100,000");
		expect(formatValue(engine.evaluateExpression("rate"))).toBe("= 4.00%");
		expect(formatValue(engine.evaluateExpression("payment"))).toBe("= 527.84");
		expect(readLines(engine.parseDocument(MORTGAGE.join("\n")))).toEqual(["100,000", "4.00%", "527.84", "6,334.04"]);
	});

	test("the incremental pass leaves its document model and the engine's variables as they were", () => {
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(WITH_FORMS.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, engine);
		try {
			for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: WITH_FORMS.length });
			const shown = (n: number) => formatValue(doc.getLineAt(n)!.result!).replace(/^=\s*/, "");
			expect([1, 2, 3, 4].map(shown)).toEqual(["100,000", "4.00%", "527.84", "6,334.04"]);
			expect(shown(5)).toBe("9,501.06");
			expect(engine.getVM().getVar("deposit")?.toNumber()).toBe(100000);
			expect(engine.getDocumentModel()).toBe(doc);
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("an edit to an input's line reaches the what-if, and agrees with a fresh pass", () => {
		// Colon definitions: a bare `name = value` line records no reads in the
		// incremental pass, so an edit above it does not re-run it there. That
		// is a separate, existing gap; the what-if lines are what is under test.
		const lines = [
			":deposit = 100000",
			":rate = 4%",
			":payment = monthly repayment on deposit over 25 years at rate",
			"payment * 12",
			"line 4 with rate = 5%",
			"line 4 for rate from 3% to 4% step 1%",
		];
		const engine = newTrackedEngine();
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, engine);
		try {
			for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
			doc.editLine(1, ":deposit = 150000");
			lines[0] = ":deposit = 150000";
			for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: lines.length });
			const shown = (n: number) => formatValue(doc.getLineAt(n)!.result!).replace(/^=\s*/, "");
			const fresh = batch(lines);
			expect([1, 2, 3, 4, 5, 6].map(shown)).toEqual(fresh);
			expect(shown(5)).toBe("10,522.62");
		} finally {
			evaluator.terminateWorker();
		}
	});
});

describe("the host API, engine.whatIf", () => {
	const text = MORTGAGE.join("\n");

	test("answers the document as it would read with the overrides", () => {
		const engine = newTrackedEngine();
		const scenario = readLines(engine.whatIf(text, { deposit: 150000, rate: "5%" }));
		expect(scenario).toEqual(["150,000", "5.00%", "876.89", "10,522.62"]);
	});

	test("leaves the engine exactly as it was", () => {
		const engine: ExpressionEngine = newTrackedEngine();
		const before = readLines(engine.parseDocument(text));
		engine.whatIf(text, { deposit: 1 });
		expect(readLines(engine.parseDocument(text))).toEqual(before);
		expect(engine.getVM().getVar("deposit")?.toNumber()).toBe(100000);
		expect(engine.getDocumentModel()).toBeNull();
	});

	test("takes a number, an expression in text, or a Value, and keeps a unit", () => {
		const engine = newTrackedEngine();
		const lines = ["price = $100", "qty = 3", "price * qty"].join("\n");
		expect(readLines(engine.whatIf(lines, { price: "$120" }))[2]).toBe("$360.00");
		expect(readLines(engine.whatIf(lines, { qty: 4 }))[2]).toBe("$400.00");
		expect(readLines(engine.whatIf(lines, { price: uomValue(50, "USD") }))[2]).toBe("$150.00");
	});

	test("a what-if line inside a scenario answers within it", () => {
		const engine = newTrackedEngine();
		const scenario = readLines(engine.whatIf([...MORTGAGE, "line 4 with deposit = 150000"].join("\n"), { rate: "5%" }));
		expect(scenario[4]).toBe("10,522.62");
	});

	test("refuses by name rather than guessing", () => {
		const engine = newTrackedEngine();
		const codeOfThrow = (overrides: Parameters<ExpressionEngine["whatIf"]>[1], input = text): string => {
			try {
				engine.whatIf(input, overrides);
			} catch (e) {
				return (e as EngineError).code;
			}
			return "no throw";
		};
		expect(codeOfThrow({ depsoit: 5 })).toBe("WHAT_IF_INPUT_NOT_USED");
		expect(codeOfThrow({ deposit: "nope" })).toBe("WHAT_IF_OVERRIDE_INVALID");
		expect(codeOfThrow({ deposit: Number.NaN })).toBe("WHAT_IF_OVERRIDE_INVALID");
		expect(codeOfThrow({ "2x": 5 })).toBe("WHAT_IF_OVERRIDE_INVALID");
		expect(codeOfThrow({ deposit: {} as unknown as Value })).toBe("WHAT_IF_OVERRIDE_INVALID");
		expect(codeOfThrow({ x: 5 }, "x = 1\nglobal :whatIfSpecHostG = x")).toBe("WHAT_IF_WRITES_GLOBAL");
	});

	test("refuses a document longer than parseDocument accepts, with the same code", () => {
		const engine = newTrackedEngine({ config: { performance: { maxDocumentLines: 2 } } });
		expect(() => engine.whatIf("x = 1\nx * 2\nx * 3", { x: 2 })).toThrow(expect.objectContaining({ code: "DOCUMENT_TOO_LARGE" }));
	});
});

describe("a sweep over a name that is also a unit letter", () => {
	test("sweeps the variable rather than reading `d from` as days from", () => {
		// `d`, `s` and `h` are time units, and `d from` was fused into a date
		// offset before the sweep could claim its input's name.
		expect(both([":d = 100", "d * 2", "line 2 for d from 1 to 3 step 1"])[2]).toBe("[2, 4, 6]");
		expect(both([":s = 1", "s + 1", "line 2 for s from 1 to 3 step 1"])[2]).toBe("[2, 3, 4]");
	});

	test("and a date offset still reads as one", () => {
		expect(both(["30 days from 3 March 2026"])[0]).toBe("Thursday, April 2, 2026");
	});
});
