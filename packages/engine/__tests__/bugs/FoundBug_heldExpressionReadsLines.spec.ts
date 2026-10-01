import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { heldExpressionReadsLines } from "@solve-js/parser/HeldExpression";
import { OpCode } from "@solve-js/parser/OpCode";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `map(x + prev, 1:3)` was refused with "map/reduce transform
 * expressions must be synchronous (no weather/stocks/currency calls)", and
 * the same of `sum`, `prod`, `reduce`, a plot and the algebra verbs.
 *
 * A held expression is compiled on its own and worked out away from the line,
 * once for each element or point, or as a formula. A call that reads other
 * lines marks the line as one that waits, so every held form refused it as
 * live data. Batch AB gave such a call `readsDocument` and refused a function
 * body for what it is (`FUNCTION_BODY_READS_LINES`); every held form now does
 * the same through one check (`heldExpressionReadsLines` in
 * parser/HeldExpression.ts), with `HELD_EXPRESSION_READS_LINES` and the way to
 * write it: name the line's value first, `p = prev`, and use `p`.
 */

/** A line's answer through evaluateExpression, or `CODE: message` for a refusal. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** A line's answer through the single-line entry point evaluateLine, or `CODE: message`. */
function single(line: string): string {
	try {
		const value = newTrackedEngine().evaluateLine(1, line);
		if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
		return formatValue(value).replace(/^=\s*/, "");
	} catch (error) {
		if (error instanceof EngineError) return `${error.code}: ${error.message}`;
		throw error;
	}
}

/** A document line's answer, or `ERROR <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "ERROR no line";
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	if (line.result.isError()) return `ERROR ${String(line.result.errorMessage)}`;
	return formatValue(line.result).replace(/^=\s*/, "");
}

/** Each line of a document through both document passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** The refusal's words for a held form, as the reader sees them. */
const readsLines = (verb: string): string =>
	`${verb}'s expression reads other lines of the document, and it is worked out away from the line, where there are no lines to read: give the line's value a name first, as in p = prev, and use p in the expression`;

describe("the lines that exposed it", () => {
	test.each([
		["map(x + prev, 1:3)", "map"],
		["reduce(acc + prev, 1:3)", "reduce"],
		["sum(x + prev, 1:3)", "sum"],
		["prod(x + prev, 1:3)", "prod"],
		["map(x + line 1, 1:3)", "map"],
		["sum(x + total above, 1:3)", "sum"],
		["plot x + prev from 0 to 1", "plot"],
		["der(x^2 + prev, x)", "der"],
		["solve(x + prev = 3, x)", "solve"],
		["integral(x + prev, x)", "integral"],
	])("%s is refused as reading lines, through evaluateExpression and evaluateLine", (line, verb) => {
		const refusal = `HELD_EXPRESSION_READS_LINES: ${readsLines(verb)}`;
		expect(outcome(line)).toBe(refusal);
		expect(single(line)).toBe(refusal);
	});

	test("through both document passes, which agree, and the way the refusal names answers", () => {
		expect(both(["5", "map(x + prev, 1:3)", "p = 5", "map(x + p, 1:3)", "sum(x + p, 1:3)"])).toEqual([
			"5",
			`ERROR ${readsLines("map")}`,
			"5",
			"[6, 7, 8]",
			"21",
		]);
	});

	test("live data in a held expression keeps its own refusal", () => {
		expect(outcome("map(x + weather in London, 1:3)")).toBe(
			"MAP_REDUCE_TRANSFORM_MUST_BE_SYNCHRONOUS: map/reduce transform expressions must be synchronous (no weather/stocks/currency calls).",
		);
		expect(outcome("f(x) = x + prev")).toMatch(/^FUNCTION_BODY_READS_LINES: /);
	});
});

describe("the parts: heldExpressionReadsLines", () => {
	const index = new Map([["readsLine", 0], ["waits", 1], ["quick", 2]]);

	test("ordinary: a held expression with a line-reading call is refused, naming its form", () => {
		const builder = new BytecodeBuilder(index);
		builder.emitPluginCall("readsLine", 0, { readsDocument: true });
		const error = heldExpressionReadsLines(builder.build(), builder, "map")!;
		expect(error.code).toBe("HELD_EXPRESSION_READS_LINES");
		expect(error.message).toBe(readsLines("map"));
	});

	test("boundary: no call, a call that never waits, and one that waits for data are not this refusal", () => {
		const plain = new BytecodeBuilder(index);
		plain.emitOpcode(OpCode.PUSH_NUMBER);
		plain.emitNumber(1);
		expect(heldExpressionReadsLines(plain.build(), plain, "map")).toBeNull();
		const quick = new BytecodeBuilder(index);
		quick.emitPluginCall("quick", 0, { synchronous: true });
		expect(heldExpressionReadsLines(quick.build(), quick, "map")).toBeNull();
		const waits = new BytecodeBuilder(index);
		waits.emitPluginCall("waits", 0);
		expect(heldExpressionReadsLines(waits.build(), waits, "map")).toBeNull();
	});

	test("hostile: a markup or prototype-shaped verb is quoted as text", () => {
		const builder = new BytecodeBuilder(index);
		builder.emitPluginCall("readsLine", 0, { readsDocument: true });
		const program = builder.build();
		expect(heldExpressionReadsLines(program, builder, "<b>x</b>")!.message).toMatch(/^<b>x<\/b>'s expression/);
		expect(heldExpressionReadsLines(program, builder, "__proto__")!.code).toBe("HELD_EXPRESSION_READS_LINES");
		expect(heldExpressionReadsLines(program, builder, "a".repeat(10_000))!.message.length).toBeLessThan(1_000);
	});
});

describe("adversarial: security", () => {
	test("a prototype word beside the line read is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("map(x + X + prev, 1:3)", PROTOTYPE_WORDS)) expect(outcome(line)).toBe(`HELD_EXPRESSION_READS_LINES: ${readsLines("map")}`);
		});
	});

	test("a long held expression and a huge range are refused within the budget", () => {
		expectHonestLine(`map(${RESOURCE_PROBES.longSum(2_000)} + prev, 1:3)`, { budgetMs: 5_000 });
		expectHonestLine(`sum(x + prev, ${RESOURCE_PROBES.hugeRange()})`, { budgetMs: 5_000 });
		expectHonestDocument(RESOURCE_PROBES.manyLines(500, "map(x + prev, 1:2)"), { budgetMs: 20_000 });
	});

	test("markup-shaped text in the held expression is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`map(x + ${edge} + prev, 1:3)`);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a check over it, a section and a tag around it", () => {
		expect(both(["# Totals", "2", "check sum(x + prev, 1:3) == 12", "map(x + prev, 1:3) #costs", "map(x * 2, 1:3) #costs"])).toEqual([
			"",
			"2",
			`ERROR ${readsLines("sum")}`,
			`ERROR ${readsLines("map")}`,
			"[2, 4, 6]",
		]);
	});

	test("an edit that names the value first answers", () => {
		expect(both(["10", "reduce(acc + prev, 1:3)"])).toEqual(["10", `ERROR ${readsLines("reduce")}`]);
		expect(both(["10", "p = prev", "reduce(acc + x + p, 1:3)"])).toEqual(["10", "10", "26"]);
	});
});

describe("adversarial: edge cases", () => {
	test("each numeric edge beside the line read is the same refusal", () => {
		for (const line of fill("map(x * (X) + prev, 1:2)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("a line read on the first line, and CRLF", () => {
		expect(both(["map(x + prev, 1:3)\r", ""])).toEqual([`ERROR ${readsLines("map")}`, ""]);
	});
});
