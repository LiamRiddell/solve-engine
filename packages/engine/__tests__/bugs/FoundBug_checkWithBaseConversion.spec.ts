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
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { BindingPower, getBindingPower } from "@solve-js/parser/BindingPower";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { ComparisonParselet } from "@solve-js/packages/conditionals/parselets/ComparisonParselet";
import { checkParselet } from "@solve-js/packages/conditionals/parselets/CheckParselet";
import { AsConverterParselet } from "@solve-js/packages/converters/parselets/AsConverterParselet";
import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Found bugs, one cause: a display conversion (`as hex`, and `in hex`, which
 * the normaliser rewrites to it) bound at the same level as a comparison.
 *
 * `check 255 in hex == 255` was refused as "a check compares two things": the
 * check read its left side at the comparisons' level, so it stopped before the
 * `as`, found no comparison sign there, and threw. `A in hex == B in hex`
 * answered `0x1`: the second conversion took the whole comparison as its
 * operand, `((A in hex) == B) in hex`, the hex form of true. Comparisons now
 * bind one step looser (`BindingPower.Comparison`) than the phrase operators
 * at `Conditional`, so a conversion on either side is that side's, and a
 * check reads each side to the comparison sign. A value in a base is still
 * the number, so `check 255 in hex == 255` passes, as `check 1 km in m ==
 * 1000 m` does.
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function doc(text: string): string[] {
	return expectHonestDocument(text).batch;
}

/** Tokens for a source string, with the whitespace the parser never sees. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
}

/** A parser holding only the comparisons and `as`, the parts this fix moved apart. */
function bareParser(source: string): { parser: PrecedenceParser; builder: BytecodeBuilder } {
	const registry = new ParseletRegistry();
	registry.registerInfix("EQUALITY", new ComparisonParselet(OpCode.EQ));
	registry.registerInfix("NEQ", new ComparisonParselet(OpCode.NEQ));
	registry.registerInfix("LT", new ComparisonParselet(OpCode.LT));
	registry.registerInfix("GT", new ComparisonParselet(OpCode.GT));
	registry.registerInfix("AS", new AsConverterParselet());
	const parser = new PrecedenceParser(registry, 50, "en");
	parser.load(lex(source), false);
	// The check emits its call by name; any index resolves it for a parse-only run.
	const builder = new BytecodeBuilder(new Map([["checkComparison", 0]]));
	parser.setBuilder(builder);
	return { parser, builder };
}

/** A line parsed and run with only the comparisons and `as` registered. */
function bare(source: string) {
	const { parser, builder } = bareParser(source);
	parser.parseExpression(BindingPower.Lowest, builder);
	expect(parser.peek()).toBeUndefined();
	builder.emitOpcode(OpCode.HALT);
	return unwrapEvalResult(executeBytecode(builder.build(), createVM(sharedOpRegistry)));
}

/** What `check` reads after its keyword: the tokens it leaves unread, or the code it refuses with. */
function afterCheck(source: string): string {
	const { parser, builder } = bareParser(source);
	try {
		checkParselet.parse(parser, lex("check")[0], builder);
	} catch (e) {
		return e instanceof EngineError ? `refused ${e.code}` : `crashed ${(e as Error).constructor.name}`;
	}
	const left: string[] = [];
	while (parser.peek() !== undefined) left.push(parser.consume().value);
	return left.length === 0 ? "read to the end" : `left ${left.join(" ")}`;
}

/** A live evaluator's answers after editing one line, the way an editor does on a keystroke. */
function afterEdit(lines: string[], lineNumber: number, text: string): string[] {
	const model = new DocumentModel();
	model.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(model, newTrackedEngine());
	try {
		evaluator.evaluate({ startLine: 1, endLine: model.lineCount });
		model.editLine(lineNumber, text);
		const pass = evaluator.evaluate({ startLine: 1, endLine: model.lineCount });
		return pass.lines.map((line) => {
			if (line.error) return `ERROR ${line.error}`;
			if (!line.result) return "";
			const answer = formatValue(line.result).replace(/^=\s*/, "");
			return line.result.type === ValueType.Error ? `ERROR ${answer}` : answer;
		});
	} finally {
		evaluator.terminateWorker();
	}
}

describe("the lines that exposed it", () => {
	test.each([
		["check 255 in hex == 255", "✓"],
		["check 255 as hex == 255", "✓"],
		["check 255 in hex == 0xff in hex", "✓"],
		["check 255 in binary == 0xff in octal", "✓"],
		["check 255 to hex == 0xff to bin", "✓"],
		["check 256 in hex == 255", "check failed: 0x100 is not equal to 255"],
		["check 255 in hex == 256 in hex", "check failed: 0xFF is not equal to 0x100"],
		["check 255 in hex < 256 in hex", "✓"],
		["check 255 in hex != 255", "check failed: 0xFF is equal to 255"],
		["check 255 in hex ≈ 250 within 2%", "✓ (differs by 2%)"],
		["255 in hex == 0xff in hex", "true"],
		["255 as hex == 0xff as hex", "true"],
		["255 in binary == 0xff in octal", "true"],
		["0xff in hex != 255 in binary", "false"],
		["255 == 0xff in hex", "true"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("the check treats a base as it treats a unit conversion on either side", () => {
		expect(shown("check 1 km in m == 1000 m")).toBe("✓");
		expect(shown("check 5 km in m == 5000 m")).toBe("✓");
		expect(shown("check (255 in hex) == (0xff in hex)")).toBe(shown("check 255 in hex == 0xff in hex"));
	});

	test("the other phrase operators on a check's sides are read whole too", () => {
		expect(shown("check 800 to 1000 == 25%")).toBe("✓");
		expect(shown("check 40 is what % of 50 == 80%")).toBe("✓");
		expect(shown("check 0.75 as fraction == \"3/4\"")).toBe("✓");
		expect(shown("check 2024 in roman == \"MMXXIV\"")).toBe("✓");
	});

	test("the reported document, through both passes", () => {
		expect(doc("A = 255\nB = 0xff\nA in hex == B in hex\ncheck A in hex == B in hex\ncheck A as binary == B as octal")).toEqual([
			"= 255",
			"= 255",
			"= true",
			"= ✓",
			"= ✓",
		]);
	});
});

describe("the existing in and as forms keep their meaning", () => {
	test.each([
		["5 km in m", "5,000.00 m"],
		["5 km in m == 5000 m", "true"],
		["192.168.1.7 in 192.168.1.0/24", "true"],
		["192.168.1.7 in 192.168.1.0/24 == true", "true"],
		["check 192.168.1.7 in 192.168.1.0/24 == true", "✓"],
		["20 to 40 as x", "2x"],
		["5 km is to 500m as 5 cm is to what", "0.50 cm"],
		["255 in hex", "0xFF"],
		["1 < 2 < 3", "true"],
		["2 > 1 == true", "true"],
		["(5 > 3) as number", "1"],
		["if 255 in hex == 0xff in hex then 1 else 2", "1"],
		["not 255 in hex == 0xff in hex", "false"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("a conversion written after a comparison is the right side's, so a boolean needs its brackets", () => {
		expect(shown("5 > 3 as number")).toBe("true");
		expect(shown("(5 > 3) as number")).toBe("1");
	});
});

describe("the binding-power ladder, the part that changed", () => {
	test("a comparison sits between the bitwise operators and the phrase operators", () => {
		expect(BindingPower.Comparison).toBeGreaterThan(BindingPower.BitwiseAnd);
		expect(BindingPower.Comparison).toBeLessThan(BindingPower.Conditional);
		expect(BindingPower.Conditional).toBeLessThan(BindingPower.Shift);
		expect(BindingPower.Conjunction).toBeLessThan(BindingPower.Comparison);
		expect(new ComparisonParselet(OpCode.EQ).bindingPower).toBe(BindingPower.Comparison);
		expect(new AsConverterParselet().bindingPower).toBe(BindingPower.Conditional);
	});

	test("getBindingPower reads each level by name, and nothing else", () => {
		expect(getBindingPower("Comparison")).toBe(23);
		expect(getBindingPower("Conditional")).toBe(24);
		expect(getBindingPower("Lowest")).toBe(0);
		expect(getBindingPower("Call")).toBe(80);
		expect(getBindingPower("")).toBe(0);
		expect(getBindingPower("comparison")).toBe(0);
	});

	test("getBindingPower answers 0 for a name every object inherits", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(getBindingPower(word)).toBe(0);
		});
	});
});

describe("ComparisonParselet with as beside it", () => {
	test("a conversion on each side is that side's", () => {
		expect(bare("255 as hex == 255 as hex").value).toBe(true);
		expect(bare("255 as hex == 254 as hex").value).toBe(false);
		expect(bare("255 as binary == 255 as octal").value).toBe(true);
		expect(bare("255 == 255 as hex").value).toBe(true);
		expect(bare("255 as hex != 255").value).toBe(false);
	});

	test("ordering, a chain and a boolean after a comparison", () => {
		expect(bare("255 as hex < 256 as hex").value).toBe(true);
		expect(bare("1 < 2 < 3").value).toBe(true);
		expect(bare("5 > 3 as number").type).toBe(ValueType.Boolean);
	});

	test("a hostile converter name is read as a name, not a property", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(bare(`255 as ${word} == 255`).type).toBe(ValueType.Error);
		});
	});
});

describe("checkParselet reads each side to the comparison sign", () => {
	test.each([
		["255 as hex == 255", "read to the end"],
		["255 as hex == 255 as hex", "read to the end"],
		["255 == 255 as hex", "read to the end"],
		["255 as hex < 256 as binary", "read to the end"],
		["255 as hex == 255 == 255", "left == 255"],
		["255 as hex", "refused CHECK_EXPECTED_COMPARISON"],
		["255", "refused CHECK_EXPECTED_COMPARISON"],
		["255 as constructor == 255", "read to the end"],
		["255 as == 255", "refused AS_CONVERTER_EXPECTED_NAME"],
	])("check %s: %s", (source, outcome) => {
		expect(afterCheck(source)).toBe(outcome);
	});
});

describe("adversarial", () => {
	test("security: a word naming an inherited property as a side or a target, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`check ${word} in hex == 255`);
				expectHonestLine(`check 255 in hex == ${word} in hex`);
				expectHonestLine(`check 255 as ${word} == 255`);
				expectHonestLine(`${word} in hex == ${word} in hex`);
				expectHonestDocument(`${word} = 255\ncheck ${word} in hex == 255`);
			}
		});
		expect(shown("check 255 in hex == constructor")).toBe("THROWS Undefined variable: constructor");
	});

	test("security: look-alike and markup-shaped text on either side is read as text", () => {
		for (const line of fill("check X in hex == 255", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("255 in hex == X in hex", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("check 255 in hex == 255 in hex​");
		expectHonestLine("check ٢٥٥ in hex == 255");
	});

	test("security: a long chain, deep brackets and a long sum are answered in time", () => {
		const chain = Array.from({ length: 500 }, () => "255 in hex").join(" == ");
		expectHonestLine(chain);
		expectHonestLine(`check ${RESOURCE_PROBES.longSum(5_000)} in hex == 1`);
		expect(shown(`check ${RESOURCE_PROBES.longSum(200)} in hex == 19900`)).toBe("✓");
		expectHonestLine(`check ${RESOURCE_PROBES.deepParens(500)} in hex == 1`);
		expectHonestDocument(RESOURCE_PROBES.manyLines(1_000, "check prev in hex == prev"));
	});

	test("realistic: a typo in the base, and a side that is not a number", () => {
		expect(shown("check 255 in hax == 255")).toBe("\"hax\" is not a unit. Did you mean ha or hlx?");
		expect(shown("check 255 in hexx == 255")).toBe("\"hexx\" is not a unit.");
		expect(shown("check 255 in hex == true")).toBe("check: 0xFF and true cannot be compared");
		expect(shown("check 255 in hex")).toBe("THROWS Expected an operator or the end of the line, but found \"255\"");
		expect(shown("check 255 in hex ==")).toBe("THROWS The line ends after \"==\", where a value was expected");
	});

	test("realistic: values from the lines above, a line reference, a what-if and an edit", () => {
		expect(doc("A = 255\nB = 0xff\ncheck A in hex == B in hex\ncheck line 1 in hex == line 2")).toEqual(["= 255", "= 255", "= ✓", "= ✓"]);
		expect(doc("A = 256\nB = 0xff\ncheck A in hex == B in hex")[2]).toBe("ERROR check failed: 0x100 is not equal to 0xFF");
		const text = "A = 255\nB = 0xff\ncheck A in hex == B in hex";
		expect(newTrackedEngine().parseDocument(text).checks).toEqual(expect.objectContaining({ passed: 1, failed: 0 }));
		expect(afterEdit(["A = 255", "B = 0xff", "check A in hex == B in hex"], 1, "A = 256")).toEqual([
			"256",
			"255",
			"ERROR check failed: 0x100 is not equal to 0xFF",
		]);
	});

	test("realistic: the check under a heading, with a total beneath it that steps over it", () => {
		expect(doc("# Bases\n255\n0xff\ncheck line 2 in hex == line 3 in hex\ntotal above")).toEqual([
			"",
			"= 255",
			"= 255",
			"= ✓",
			"= 510",
		]);
	});

	test("edge: zero, negative zero, negatives and the exact-integer boundary", () => {
		expect(shown("check 0 in hex == -0 in hex")).toBe("✓");
		expect(shown("check -0 in hex == 0")).toBe("✓");
		expect(shown("check -255 in hex == -255")).toBe("✓");
		expect(shown("check 2^53 + 1 in hex == 2^53 + 1")).toBe("✓");
		expect(shown("check 2^53 + 1 in hex == 2^53")).toBe("check failed: 0x20000000000001 is not equal to 9,007,199,254,740,992");
		expect(shown("check (2^100 + 1) in hex == (2^100 + 1) in binary")).toBe("✓");
		expect(shown("check 12345678901234567890123456789012345 in hex == 12345678901234567890123456789012345")).toBe("✓");
	});

	test("edge: the largest double and a value with no digits", () => {
		expect(shown("check 1e308 in hex == 1e308")).toBe("✓");
		const infinite = evaluateLine("check (1/0) in hex == 1");
		expect(infinite.kind === "error" ? infinite.code : infinite.kind).toBe("BASE_NOT_FINITE");
	});

	test("edge: every numeric edge on both sides of a check and a comparison", () => {
		for (const line of fill("check X in hex == X in hex", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		for (const line of fill("X in binary == X in octal", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("edge: CRLF, a trailing newline and blank lines around the check", () => {
		expect(doc("A = 255\r\nB = 0xff\r\ncheck A in hex == B in hex\r\n")).toEqual(["= 255", "= 255", "= ✓", ""]);
		expect(doc("\n\nA = 255\n\ncheck A in hex == 255\n")).toEqual(["", "", "= 255", "", "= ✓", ""]);
	});
});
