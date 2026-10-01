import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
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
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { ComparisonParselet } from "@solve-js/packages/conditionals/parselets/ComparisonParselet";
import { checkParselet, comparisonOf, refusalAfterCheck } from "@solve-js/packages/conditionals/parselets/CheckParselet";
import { checkComparison, checkLink } from "@solve-js/packages/conditionals/CheckFunctions";
import { ValueType, numberValue, stringValue, uomValue, errorValue } from "@solve-js/vm/Value";

/**
 * Found bug: a chained check answered a confident false.
 *
 * `check 1 == 1 == 1` gave `false`. The check read one comparison, `1 == 1`,
 * and left the second `== 1` to the line, which compared the check's tick with
 * 1. `check 1 < 2 > 0` was false the same way, and `check 1 < 2 < 3` passed
 * only by luck. A chain is now every link at once, as `1 == 1 and 1 == 1`
 * would read: each link but the last is `checkLink`, which hands its right
 * side on to the next when it holds and its failure otherwise, so a side
 * shared by two links is worked out once, and the first link that fails is the
 * one reported. A `within` margin belongs to the last link, the one it is
 * written after; anything else after a check is refused by name.
 *
 * Proving the chain over the numeric edges found a second fault in the same
 * function: an infinity made the margin around it infinite, so `check 0 <
 * 1/0` failed with "0 is not less than ∞" and `check 1/0 == 1/0` with "∞ is not
 * equal to ∞". A side with no finite value is now ordered as the comparison
 * operators order it.
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

/** What `check` reads after its keyword on a parser holding only the comparisons: the tokens it leaves, or the code it refuses with. */
function afterCheck(source: string): string {
	const registry = new ParseletRegistry();
	registry.registerInfix("EQUALITY", new ComparisonParselet(OpCode.EQ));
	registry.registerInfix("LT", new ComparisonParselet(OpCode.LT));
	registry.registerInfix("GT", new ComparisonParselet(OpCode.GT));
	const parser = new PrecedenceParser(registry, 50, "en");
	parser.load(lex(source), false);
	const builder = new BytecodeBuilder(new Map([["checkComparison", 0], ["checkLink", 1], ["checkBoth", 2]]));
	parser.setBuilder(builder);
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

/** The first token of a line, for the parselet's helpers. */
const token = (source: string): Token => lex(source)[0];

describe("the lines that exposed it", () => {
	test.each([
		["check 1 == 1 == 1", "✓"],
		["check 1 == 1 == 2", "check failed: 1 is not equal to 2"],
		["check 1 == 2 == 2", "check failed: 1 is not equal to 2"],
		["check 1 < 2 < 3", "✓"],
		["check 1 < 3 < 2", "check failed: 3 is not less than 2"],
		["check 1 < 2 > 0", "✓"],
		["check 0 <= 5 <= 10", "✓"],
		["check 1 km < 1500 m < 2 km", "✓"],
		["check 22/7 ≈ 3.14 ≈ pi within 0.1%", "✓ (differs by 0.05%)"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("the bare comparison is unchanged: it still groups from the left", () => {
		expect(shown("1 == 1 == 1")).toBe("true");
		expect(shown("1 < 2 < 3")).toBe("true");
	});

	test("a margin is the last link's, and a comparison after it is refused", () => {
		expect(shown("check 22/7 ≈ 3.14 within 1% ≈ pi")).toBe(
			"THROWS a check ends with its comparison, so \"≈\" after it is not read. Put a side in brackets to use \"≈\" in it, or join two checks with \"and\"",
		);
	});

	test("the reported document, through both passes", () => {
		expect(doc("A = 5\ncheck 0 < A < 10\ncheck A == 5 == 5\ncheck 0 < A < 4")).toEqual([
			"= 5",
			"= ✓",
			"= ✓",
			"ERROR check failed: 5 is not less than 4",
		]);
	});
});

describe("a side with no finite value", () => {
	test.each([
		["check 0 < 1/0", "✓"],
		["check 1/0 == 1/0", "✓"],
		["check 1/0 > 5", "✓"],
		["check -1/0 < 0", "✓"],
		["check -1/0 < 1/0", "✓"],
		["check 1/0 != -1/0", "✓"],
		["check 0 < 1/0 < 2", "check failed: ∞ is not less than 2"],
		["check 5 == 1/0", "check failed: 5 is not equal to ∞"],
		["check 2n^2000 < 2n^2000 + 1", "✓"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("checkComparison orders an infinity as the operators do", () => {
		const eq = stringValue("==");
		expect(checkComparison([numberValue(Infinity), numberValue(Infinity), eq]).value).toBe("✓");
		expect(checkComparison([numberValue(Infinity), numberValue(-Infinity), eq]).errorCode).toBe("CHECK_FAILED");
		expect(checkComparison([numberValue(1e308), numberValue(Infinity), stringValue("<")]).value).toBe("✓");
		expect(checkComparison([numberValue(NaN), numberValue(NaN), eq]).errorCode).toBe("CHECK_FAILED");
	});
});

describe("comparisonOf", () => {
	test("each comparison token names its comparison", () => {
		expect(comparisonOf(token("=="))).toBe("==");
		expect(comparisonOf(token("!="))).toBe("!=");
		expect(comparisonOf(token("<"))).toBe("<");
		expect(comparisonOf(token(">="))).toBe(">=");
	});

	test("anything else is not one", () => {
		expect(comparisonOf(undefined)).toBeUndefined();
		expect(comparisonOf(token("5"))).toBeUndefined();
		expect(comparisonOf(token("+"))).toBeUndefined();
		expect(comparisonOf(token("="))).toBeUndefined();
	});

	test("hostile: a token type named after an inherited property is not a comparison", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(comparisonOf({ ...token("5"), type: word })).toBeUndefined();
		});
	});
});

describe("checkLink, the part that was added", () => {
	const lt = stringValue("<");

	test("ordinary: a link that holds hands on its right side, itself", () => {
		const right = numberValue(2);
		expect(checkLink([numberValue(1), right, lt])).toBe(right);
		const metres = uomValue(1500, "m");
		expect(checkLink([uomValue(1, "km"), metres, lt])).toBe(metres);
	});

	test("ordinary: a link that fails hands on the failure", () => {
		const out = checkLink([numberValue(3), numberValue(2), lt]);
		expect(out.errorCode).toBe("CHECK_FAILED");
		expect(formatValue(out)).toBe("check failed: 3 is not less than 2");
	});

	test("boundary: a link between things of two kinds hands on the refusal", () => {
		expect(checkLink([uomValue(1, "m"), uomValue(1, "kg"), lt]).errorCode).toBe("CHECK_INCOMPARABLE");
		expect(checkLink([numberValue(1), stringValue("1"), stringValue("==")]).errorCode).toBe("CHECK_INCOMPARABLE");
	});

	test("hostile: missing arguments and an unknown comparison are refused, not thrown", () => {
		expect(checkLink([numberValue(1), numberValue(1), stringValue("<>")]).errorCode).toBe("CHECK_EXPECTED_COMPARISON");
		expect(checkLink([numberValue(1)]).type).toBe(ValueType.Error);
		expect(checkLink([errorValue("X", "x"), numberValue(1), lt]).type).toBe(ValueType.Error);
	});
});

describe("refusalAfterCheck", () => {
	test("the end of the line and an ordinary token end a check", () => {
		expect(refusalAfterCheck(undefined)).toBeNull();
		expect(refusalAfterCheck(token("5"))).toBeNull();
		expect(refusalAfterCheck(token("+"))).toBeNull();
	});

	test("a comparison and a bitwise operator are refused by name", () => {
		expect(refusalAfterCheck(token("<"))?.code).toBe("CHECK_JOIN_UNSUPPORTED");
		expect(refusalAfterCheck(lex("1 | 2")[1])?.code).toBe("CHECK_JOIN_UNSUPPORTED");
		expect(refusalAfterCheck(lex("1 & 2")[1])?.message).toBe(
			"a check ends with its comparison, so \"&\" after it is not read. Put a side in brackets to use \"&\" in it, or join two checks with \"and\"",
		);
	});

	test("hostile: a token type named after an inherited property ends the check", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(refusalAfterCheck({ ...token("5"), type: word })).toBeNull();
		});
	});
});

describe("checkParselet reads the whole chain", () => {
	test.each([
		["1 == 1", "read to the end"],
		["1 == 1 == 1", "read to the end"],
		["1 < 2 < 3 < 4", "read to the end"],
		["1 < 2 > 0", "read to the end"],
		["1 ==", "refused UNEXPECTED_END_OF_INPUT"],
		["1 == 1 ==", "refused UNEXPECTED_END_OF_INPUT"],
		["1", "refused CHECK_EXPECTED_COMPARISON"],
		["1 == 1 | 2", "refused CHECK_JOIN_UNSUPPORTED"],
	])("check %s: %s", (source, outcome) => {
		expect(afterCheck(source)).toBe(outcome);
	});
});

describe("adversarial", () => {
	test("security: a word naming an inherited property in a chain, as a variable and unknown, with the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`check 1 < ${word} < 3`);
				expect(doc(`${word} = 2\ncheck 1 < ${word} < 3`)).toEqual(["= 2", "= ✓"]);
			}
		});
	});

	test("security: a long chain, deep brackets in a link and many chained lines are answered in time", () => {
		// The longest a line may be is 2,000 characters, so the chains are written tight.
		// Past the engine's complexity limit a chain is refused by it, in time.
		expect(shown(`check ${Array.from({ length: 200 }, () => "1").join("==")}`)).toBe("✓");
		expect(shown(`check ${Array.from({ length: 600 }, () => "1").join("==")}`)).toBe("THROWS Expression complexity score 1200 exceeds maximum of 500");
		const rising = Array.from({ length: 201 }, (_, i) => String(i)).join("<");
		expect(shown(`check ${rising}`)).toBe("✓");
		expect(shown(`check ${rising}<3`)).toBe("check failed: 200 is not less than 3");
		expect(shown(`check 0 < ${RESOURCE_PROBES.deepParens(20)} < 2`)).toBe("✓");
		expectHonestLine(`check 0 < ${RESOURCE_PROBES.deepParens(500)} < 2`);
		expectHonestLine(`check 0 < ${RESOURCE_PROBES.longSum(5_000)} < 1`);
		expectHonestDocument(RESOURCE_PROBES.manyLines(1_000, "check prev == prev == prev"));
	});

	test("security: look-alike and markup-shaped text in a chain is read as text", () => {
		for (const line of fill("check 1 < X < 3", TEXT_EDGES)) expectHonestLine(line);
		expect(shown("check 1 == 1 ==​ 1")).toBe("✓");
		expectHonestLine("check 1 ＝＝ 1 == 1");
		expectHonestLine("check 1 < ٢ < 3");
	});

	test("realistic: a typo, a unit that does not fit, the lines above, a what-if, a total and an edit", () => {
		expect(shown("check 1 < 2 <")).toBe("THROWS The line ends after \"<\", where a value was expected");
		expect(shown("check 1 m < 2 m < 3 kg")).toBe("check: length and mass cannot be compared");
		expect(doc("a = 1\ncheck 0 < a < 10\nline 2 with a = 50")).toEqual(["= 1", "= ✓", "ERROR check failed: 50 is not less than 10"]);
		expect(doc("£900\n£300\ncheck 0 < line 1 + line 2 < £1,000\ntotal above")).toEqual([
			"= £900.00",
			"= £300.00",
			"ERROR check failed: £1,200.00 is not less than £1,000.00",
			"= £1,200.00",
		]);
		expect(afterEdit(["A = 5", "check 0 < A < 10"], 1, "A = 50")).toEqual(["50", "ERROR check failed: 50 is not less than 10"]);
		expect(newTrackedEngine().parseDocument("A = 5\ncheck 0 < A < 10\ncheck 0 < A < 4").checks).toEqual(expect.objectContaining({ passed: 1, failed: 1 }));
	});

	test("realistic: an explanation of a chained check names no internal function", () => {
		let text: string;
		try {
			text = JSON.stringify(newTrackedEngine().explainLine("check 1 < 2 < 3"));
		} catch (e) {
			text = (e as Error).message;
		}
		expect(text).not.toMatch(/checkLink|checkComparison|checkBoth|\[object /);
	});

	test("edge: zero, negative zero, 2^53 and the 34-digit limit in a chain", () => {
		expect(shown("check -0 == 0 == -0")).toBe("✓");
		expect(shown("check 2^53 < 2^53 + 1 < 2^53 + 2")).toBe("✓");
		expect(shown("check 2^53 + 1 == 2^53 + 1 == 2^53")).toBe("check failed: 9,007,199,254,740,993 is not equal to 9,007,199,254,740,992");
		expect(shown("check 12345678901234567890123456789012345 == 12345678901234567890123456789012345 == 12345678901234567890123456789012345")).toBe("✓");
	});

	test("edge: every numeric edge as the middle of a chain", () => {
		for (const line of fill("check X <= X <= X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		for (const line of fill("check -1/0 < X < 1/0", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("edge: CRLF, a trailing newline and blank lines around a chained check", () => {
		expect(doc("A = 5\r\ncheck 0 < A < 10\r\n")).toEqual(["= 5", "= ✓", ""]);
		expect(doc("\nA = 5\n\ncheck 0 < A < 10\n")).toEqual(["", "= 5", "", "= ✓", ""]);
	});
});
