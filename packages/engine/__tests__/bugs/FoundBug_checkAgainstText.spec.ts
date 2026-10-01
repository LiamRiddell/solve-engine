import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { checkComparison, kindOfSide, quotedText, textCheck } from "@solve-js/packages/conditionals/CheckFunctions";
import {
	ValueType,
	Value,
	boolValue,
	colourValue,
	datetimeValue,
	hexValue,
	numberValue,
	percentageValue,
	stringValue,
	uomValue,
} from "@solve-js/vm/Value";

/**
 * Found bug: a check between a number and text that reads the same
 * contradicted itself.
 *
 * `check (255 in hex) == "0xFF"` said "check failed: 0xFF is not equal to
 * 0xFF", and `check 255 == "255"` "255 is not equal to 255". A number and a
 * piece of text are two kinds of thing, and the check was right not to pass
 * them, but it showed both sides alike and so gave no reason. It now refuses
 * the pair by name, as it refuses a colour or an address beside a number,
 * saying which side is text and what the other is, and how to read the text as
 * a number when it is one (`textCheck` in CheckFunctions.ts). Text is quoted in
 * every check message, so two texts that differ only by a space no longer read
 * alike either.
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

const op = (s: string): Value => stringValue(s);

describe("the lines that exposed it", () => {
	test.each([
		[
			"check (255 in hex) == \"0xFF\"",
			"check: \"0xFF\" on the right is text and 0xFF is a number, so they cannot be compared. To read the text as a number, write \"0xFF\" as number",
		],
		[
			"check 255 == \"255\"",
			"check: \"255\" on the right is text and 255 is a number, so they cannot be compared. To read the text as a number, write \"255\" as number",
		],
		[
			"check \"255\" == 255",
			"check: \"255\" on the left is text and 255 is a number, so they cannot be compared. To read the text as a number, write \"255\" as number",
		],
		[
			"check 255 != \"255\"",
			"check: \"255\" on the right is text and 255 is a number, so they cannot be compared. To read the text as a number, write \"255\" as number",
		],
		["check \"a\" == 1", "check: \"a\" on the left is text and 1 is a number, so they cannot be compared"],
		["check true == \"true\"", "check: \"true\" on the right is text and true is a true or false answer, so they cannot be compared"],
		["check $5 == \"5\"", "check: \"5\" on the right is text and $5.00 is an amount, so they cannot be compared"],
		["check #ff0000 == \"#ff0000\"", "check: \"#ff0000\" on the right is text and #ff0000 is a colour, so they cannot be compared"],
		["check \"x\" < 1", "check: \"x\" on the left is text and 1 is a number, so they cannot be compared"],
	])("%s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("the suggested conversion works", () => {
		expect(shown("check \"255\" as number == 255")).toBe("✓");
		expect(shown("check (255 in hex) == \"255\" as number")).toBe("✓");
	});

	test("two pieces of text are quoted, so a failure never reads as two equal sides", () => {
		expect(shown("check \"a \" == \"a\"")).toBe("check failed: \"a \" is not equal to \"a\"");
		expect(shown("check \"abc\" != \"abc\"")).toBe("check failed: \"abc\" is equal to \"abc\"");
		expect(shown("check 0.5 as fraction == \"3/4\"")).toBe("check failed: \"1/2\" is not equal to \"3/4\"");
	});

	test("text that matches still passes", () => {
		expect(shown("check \"abc\" == \"abc\"")).toBe("✓");
		expect(shown("check 0.75 as fraction == \"3/4\"")).toBe("✓");
		expect(shown("check 2024 in roman == \"MMXXIV\"")).toBe("✓");
		expect(shown("check \"a\" != \"b\"")).toBe("✓");
		expect(shown("check \"a\" > \"b\"")).toBe("check: text can only be compared with == or !=, not >");
	});

	test("the reported document, through both passes", () => {
		expect(doc("A = \"255\"\ncheck A == 255\ncheck A as number == 255")).toEqual([
			"= 255",
			"ERROR check: \"255\" on the left is text and 255 is a number, so they cannot be compared. To read the text as a number, write \"255\" as number",
			"= ✓",
		]);
	});
});

describe("kindOfSide names each kind in the reader's words", () => {
	test.each<[string, Value, string]>([
		["a number", numberValue(5), "a number"],
		["a number in a base", hexValue(255), "a number"],
		["an amount", uomValue(5, "m"), "an amount"],
		["a percentage", percentageValue(0.5), "a percentage"],
		["a boolean", boolValue(true), "a true or false answer"],
		["a date", datetimeValue(0), "a date"],
		["text", stringValue("x"), "text"],
		["a colour", colourValue({ r: 255, g: 0, b: 0, a: 1, format: "hex" }), "a colour"],
	])("%s", (_name, value, kind) => {
		expect(kindOfSide(value)).toBe(kind);
	});

	test("never an internal type name", () => {
		for (const type of Object.values(ValueType).filter((t): t is ValueType => typeof t === "number")) {
			const kind = kindOfSide(new Value(type, 0));
			expect(kind).not.toMatch(/ValueType|undefined|\d/);
			expect(kind.length).toBeGreaterThan(0);
		}
	});
});

describe("quotedText", () => {
	test("ordinary and boundary: quoted whole, empty and a lone space included", () => {
		expect(quotedText("0xFF")).toBe("\"0xFF\"");
		expect(quotedText("")).toBe("\"\"");
		expect(quotedText(" ")).toBe("\" \"");
		expect(quotedText("a".repeat(60))).toBe(`"${"a".repeat(60)}"`);
	});

	test("hostile: a long text is cut short, by character and not by code unit", () => {
		expect(quotedText("a".repeat(100_000))).toBe(`"${"a".repeat(60)}..."`);
		expect(quotedText("🙂".repeat(61))).toBe(`"${"🙂".repeat(60)}..."`);
	});

	test("hostile: prototype words and markup are quoted as they are", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(quotedText(word)).toBe(`"${word}"`);
		});
		expect(quotedText("<script>")).toBe("\"<script>\"");
	});
});

describe("textCheck, the part that changed", () => {
	test("ordinary: two texts, equal and not", () => {
		expect(textCheck(stringValue("a"), stringValue("a"), "==").value).toBe("✓");
		expect(textCheck(stringValue("a"), stringValue("b"), "!=").value).toBe("✓");
		expect(textCheck(stringValue("a"), stringValue("b"), "==").errorCode).toBe("CHECK_FAILED");
		expect(textCheck(stringValue("a"), stringValue("a"), "<").errorCode).toBe("CHECK_INCOMPARABLE");
	});

	test("ordinary: text beside anything else is refused, under every comparison", () => {
		for (const comparison of ["==", "!=", "<", "<=", ">", ">=", "≈"]) {
			expect(textCheck(numberValue(1), stringValue("1"), comparison).errorCode).toBe("CHECK_INCOMPARABLE");
			expect(textCheck(stringValue("1"), boolValue(false), comparison).errorCode).toBe("CHECK_INCOMPARABLE");
		}
	});

	test("boundary: the conversion is suggested only for text as number reads, beside a number", () => {
		const hint = (text: string, other: Value = numberValue(1)): boolean => formatValue(textCheck(other, stringValue(text), "==")).includes("as number");
		expect(hint("255")).toBe(true);
		expect(hint(" 255 ")).toBe(true);
		expect(hint("1,000")).toBe(true);
		expect(hint("1e3")).toBe(true);
		expect(hint("-3")).toBe(true);
		// `as number` reads a base prefix (FoundBug_baseTextAsNumber), so the hint is offered for it too.
		expect(hint("0xFF")).toBe(true);
		expect(hint("0xZZ")).toBe(false);
		expect(hint("")).toBe(false);
		expect(hint("abc")).toBe(false);
		expect(hint("255", uomValue(5, "m"))).toBe(false);
		expect(hint("255", boolValue(true))).toBe(false);
	});

	test("hostile: look-alike digits and invisible characters are not offered as a number", () => {
		const hint = (text: string): boolean => formatValue(textCheck(numberValue(255), stringValue(text), "==")).includes("as number");
		expect(hint("٢٥٥")).toBe(false);
		expect(hint("２５５")).toBe(false);
		expect(hint("255​")).toBe(false);
		expect(hint("‮255")).toBe(false);
	});

	test("checkComparison sends text either side through it", () => {
		expect(checkComparison([numberValue(255), stringValue("255"), op("==")]).errorCode).toBe("CHECK_INCOMPARABLE");
		expect(checkComparison([stringValue("x"), stringValue("x"), op("==")]).value).toBe("✓");
	});
});

describe("adversarial", () => {
	test("security: text naming an inherited property, as a side and as a variable, with the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(shown(`check "${word}" == "${word}"`)).toBe("✓");
				expect(shown(`check "${word}" == 5`)).toBe(`check: "${word}" on the left is text and 5 is a number, so they cannot be compared`);
				expectHonestDocument(`${word} = "5"\ncheck ${word} == 5`);
			}
		});
	});

	test("security: markup- and injection-shaped text is quoted, not acted on", () => {
		expect(shown("check \"<script>alert(1)</script>\" == 1")).toBe(
			"check: \"<script>alert(1)</script>\" on the left is text and 1 is a number, so they cannot be compared",
		);
		for (const line of fill("check \"X\" == 5", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("check 5 == \"X\"", TEXT_EDGES)) expectHonestLine(line);
	});

	test("security: a long text and many check lines are answered in time", () => {
		const long = shown(`check ${RESOURCE_PROBES.longText(1_900)} == 1`);
		expect(long.length).toBeLessThan(250);
		expect(long).toContain("...\" on the left is text");
		expectHonestDocument(RESOURCE_PROBES.manyLines(1_000, "check \"1\" == prev"));
	});

	test("realistic: the number held as text in a line above, a what-if over it, and the check count", () => {
		expect(doc("code = \"0xFF\"\ncheck code == 255")[1]).toBe("ERROR check: \"0xFF\" on the left is text and 255 is a number, so they cannot be compared. To read the text as a number, write \"0xFF\" as number");
		expect(doc("n = 255\ncheck n == \"255\"\nline 2 with n = 7")[2]).toBe(
			"ERROR check: \"255\" on the right is text and 7 is a number, so they cannot be compared. To read the text as a number, write \"255\" as number",
		);
		// A refusal is not a failed check, so the host's count leaves it out.
		expect(newTrackedEngine().parseDocument("check 255 == \"255\"\ncheck 1 == 1").checks).toEqual(expect.objectContaining({ passed: 1, failed: 0 }));
	});

	test("edge: empty text, a space, zero and negative zero as text", () => {
		expect(shown("check \"\" == 0")).toBe("check: \"\" on the left is text and 0 is a number, so they cannot be compared");
		expect(shown("check \"\" == \" \"")).toBe("check failed: \"\" is not equal to \" \"");
		expect(shown("check -0 == \"-0\"")).toBe(
			"check: \"-0\" on the right is text and 0 is a number, so they cannot be compared. To read the text as a number, write \"-0\" as number",
		);
	});

	test("edge: CRLF and a trailing newline around the check", () => {
		expect(doc("A = \"x\"\r\ncheck A == \"x\"\r\n")).toEqual(["= x", "= ✓", ""]);
	});
});
