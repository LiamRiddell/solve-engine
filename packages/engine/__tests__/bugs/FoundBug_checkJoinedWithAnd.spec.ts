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
import { formatValue } from "@solve-js/format/FormatEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { refusalAfterCheck } from "@solve-js/packages/conditionals/parselets/CheckParselet";
import { checkBoth, isCheckLine } from "@solve-js/packages/conditionals/CheckFunctions";
import { ValueType, errorValue, numberValue, stringValue } from "@solve-js/vm/Value";

/**
 * Found bug: a check joined with `and` failed with an error about adding text.
 *
 * `check 1 == 1 and 1 == 1` answered TEXT_ARITHMETIC. The check read its first
 * comparison and stopped, and the line went on to add the check's tick to the
 * second comparison, since `and` is also addition (`5 and 3` is 8). A check now
 * reads comparisons joined with `and` (or `&&`) as one check of all of them:
 * it passes when each one holds, and fails with the first that does not
 * (`checkBoth` in CheckFunctions.ts). `or` is refused by name: a check states
 * what must hold, and the way to check that one of two things holds is to
 * compare the answer, `check (A or B) == true`, which already works.
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

const OR_REFUSAL =
	"THROWS a check states things that must all hold, so it joins them with \"and\", not \"or\". To check that one of two things holds, compare the answer, as in \"check (:a > 0 or :b > 0) == true\"";

describe("the lines that exposed it", () => {
	test.each([
		["check 1 == 1 and 1 == 1", "✓"],
		["check 1 == 1 and 1 == 2", "check failed: 1 is not equal to 2"],
		["check 1 == 2 and 1 == 3", "check failed: 1 is not equal to 2"],
		["check 1 == 1 && 2 > 1", "✓"],
		["check 1 == 1 and 2 == 2 and 3 == 3", "✓"],
		["check 1 == 1 and 2 == 3 and 4 == 5", "check failed: 2 is not equal to 3"],
		["check 1 < 2 < 3 and 3 > 2 > 1", "✓"],
		["check 22/7 ≈ pi within 0.1% and 5 m ≈ 5.01 m within 1 cm", "✓ (differs by 0.04% and by 0.01 m)"],
		["check 22/7 ≈ pi within 0.1% and 1 == 1", "✓ (differs by 0.04%)"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("or is refused by name, and the comparison it points to works", () => {
		expect(shown("check 1 == 1 or 1 == 2")).toBe(OR_REFUSAL);
		expect(shown("check 1 == 1 || 1 == 2")).toBe(OR_REFUSAL);
		expect(shown("check (1 == 1 or 1 == 2) == true")).toBe("✓");
	});

	test("the other meanings of and are unchanged", () => {
		expect(shown("5 and 3")).toBe("8");
		expect(shown("true and false")).toBe("false");
		expect(shown("5 > 3 and 2 > 1")).toBe("true");
		expect(shown("check (true and true) == true")).toBe("✓");
	});

	test("the reported document, through both passes", () => {
		expect(doc(":a = 3\n:b = 4\ncheck :a > 0 and :b > 0\ncheck :a > 0 and :b > 10")).toEqual([
			"= 3",
			"= 4",
			"= ✓",
			"ERROR check failed: 4 is not more than 10",
		]);
	});
});

describe("checkBoth, the part that was added", () => {
	const tick = stringValue("✓");

	test("ordinary: two ticks are one tick", () => {
		expect(checkBoth([tick, tick]).value).toBe("✓");
	});

	test("ordinary: each margin a side passed by is kept, in order", () => {
		expect(checkBoth([stringValue("✓ (differs by 0.04%)"), tick]).value).toBe("✓ (differs by 0.04%)");
		expect(checkBoth([tick, stringValue("✓ (differs by 0.01 m)")]).value).toBe("✓ (differs by 0.01 m)");
		expect(checkBoth([stringValue("✓ (differs by 1%)"), stringValue("✓ (differs by 2%)")]).value).toBe("✓ (differs by 1% and by 2%)");
	});

	test("boundary: the combined answer still counts as one passed check", () => {
		expect(isCheckLine("check a and b", checkBoth([stringValue("✓ (differs by 1%)"), stringValue("✓ (differs by 2%)")]))).toBe(true);
	});

	test("hostile: anything but two ticks is refused, not passed", () => {
		for (const args of [
			[tick],
			[],
			[tick, stringValue("✓ shipped")],
			[stringValue("yes"), tick],
			[numberValue(1), tick],
			[tick, errorValue("CHECK_FAILED", "check failed: 1 is not equal to 2")],
			[stringValue("constructor"), stringValue("__proto__")],
		]) {
			expect(checkBoth(args).type).toBe(ValueType.Error);
		}
	});
});

describe("refusalAfterCheck names or", () => {
	test("both spellings", () => {
		expect(refusalAfterCheck(lex("1 or 2")[1])?.code).toBe("CHECK_JOIN_UNSUPPORTED");
		expect(refusalAfterCheck(lex("1 || 2")[1])?.code).toBe("CHECK_JOIN_UNSUPPORTED");
	});
});

describe("adversarial", () => {
	test("security: a word naming an inherited property on either side of the and, with the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`check ${word} == 1 and 1 == 1`);
				expectHonestLine(`check 1 == 1 and ${word} == 1`);
				expect(doc(`${word} = 2\ncheck ${word} > 1 and ${word} < 3`)).toEqual(["= 2", "= ✓"]);
			}
		});
	});

	test("security: many checks joined in one line, deep brackets and many lines are answered in time", () => {
		const many = Array.from({ length: 100 }, () => "1==1").join(" and ");
		expect(shown(`check ${many}`)).toBe("✓");
		expect(shown(`check ${many} and 1==2`)).toBe("check failed: 1 is not equal to 2");
		expectHonestLine(`check ${Array.from({ length: 400 }, () => "1==1").join(" and ")}`);
		expectHonestLine(`check ${RESOURCE_PROBES.deepParens(500)} == 1 and 1 == 1`);
		expectHonestDocument(RESOURCE_PROBES.manyLines(1_000, "check prev == prev and prev > -1"));
	});

	test("security: look-alike letters and markup-shaped text are read as text", () => {
		// A Cyrillic a in "and" is not the word, so the line is refused, not joined.
		expect(shown("check 1 == 1 аnd 1 == 1")).toBe("THROWS Expected an operator or the end of the line, but found \"1\"");
		expectHonestLine("check 1 == 1 a​nd 1 == 1");
		for (const line of fill("check 1 == 1 and X == 1", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("check \"<b>\" == \"<b>\" and \"'; DROP\" == \"'; DROP\"");
	});

	test("realistic: a half-written line, a unit that does not fit, an unknown name on either side", () => {
		expect(shown("check 1 == 1 and")).toBe("THROWS The line ends after \"and\", where a value was expected");
		expect(shown("check 1 == 1 and 5")).toBe(
			"THROWS a check compares two things, as in \"check :spent <= :budget\" or \"check 22/7 ≈ pi within 0.1%\"",
		);
		expect(shown("check 1 m == 1 kg and 1 == 1")).toBe("check: length and mass cannot be compared");
		expect(shown("check 1 == 1 and 1 m == 1 kg")).toBe("check: length and mass cannot be compared");
		expect(shown("check 1 == 1 and x == 1")).toBe("THROWS Undefined variable: x");
		expect(shown("check 1 == 1 | 2")).toBe(
			"THROWS a check ends with its comparison, so \"|\" after it is not read. Put a side in brackets to use \"|\" in it, or join two checks with \"and\"",
		);
	});

	test("realistic: the lines above, a what-if, a total that steps over it, an edit and the check count", () => {
		expect(doc("a = 1\ncheck a > 0 and a < 10\nline 2 with a = 50")).toEqual(["= 1", "= ✓", "ERROR check failed: 50 is not less than 10"]);
		expect(doc("£900\n£300\ncheck line 1 > 0 and line 2 > 0\ntotal above")).toEqual(["= £900.00", "= £300.00", "= ✓", "= £1,200.00"]);
		expect(afterEdit(["a = 1", "check a > 0 and a < 10"], 1, "a = 50")).toEqual(["50", "ERROR check failed: 50 is not less than 10"]);
		// One line is one check, however many comparisons it joins.
		expect(newTrackedEngine().parseDocument("check 1 == 1 and 2 == 2\ncheck 1 == 1 and 2 == 3").checks).toEqual(
			expect.objectContaining({ passed: 1, failed: 1 }),
		);
	});

	test("realistic: an explanation of a joined check names no internal function", () => {
		let text: string;
		try {
			text = JSON.stringify(newTrackedEngine().explainLine("check 1 == 1 and 2 > 1"));
		} catch (e) {
			text = (e as Error).message;
		}
		expect(text).not.toMatch(/checkLink|checkComparison|checkBoth|\[object /);
	});

	test("edge: zero, negative zero, 2^53 and the infinities on both sides of the and", () => {
		expect(shown("check 0 == -0 and -0 == 0")).toBe("✓");
		expect(shown("check 2^53 + 1 > 2^53 and 2^53 > 2^53 - 1")).toBe("✓");
		expect(shown("check 1/0 > 0 and -1/0 < 0")).toBe("✓");
		expect(shown("check 1 == 1 and 0/0 == 0")).toBe("0 divided by 0 has no single answer: every number times 0 is 0, so no one quotient is right.");
	});

	test("edge: every numeric edge on each side of the and", () => {
		for (const line of fill("check X == X and X >= X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		for (const line of fill("check 1 == 1 and X != X + 1", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("edge: CRLF and a trailing newline around a joined check", () => {
		expect(doc("a = 1\r\ncheck a > 0 and a < 2\r\n")).toEqual(["= 1", "= ✓", ""]);
	});
});
