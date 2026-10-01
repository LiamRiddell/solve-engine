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
import { deserializeValue, snapshotValue } from "@solve-js/engine/EngineSnapshot";
import { valueInBase, wholeForBase } from "@solve-js/vm/ExactIntegers";
import { ValueType, bigIntValue, numberValue } from "@solve-js/vm/Value";

/**
 * Found bug: a fraction written in a base was dropped from the display and
 * kept in the value.
 *
 * `255.7 in hex` showed `0xFF`, as the number bases page says ("a fraction is
 * truncated"), yet `255.7 in hex == 255` was false, `(255.7 in hex) + 1` was
 * 256.70, and `check (0.5 in hex) == 0` failed with "0x0 is not equal to 0",
 * two sides that read alike. The page and the existing tests agree that the
 * display is right, so the conversion now cuts the fraction from the value as
 * well (`wholeForBase` in vm/ExactIntegers.ts): what the line shows and what it
 * holds are the same number.
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
		["255.7 in hex", "0xFF"],
		["255.7 in hex == 255", "true"],
		["255.7 in hex == 255.7", "false"],
		["(255.7 in hex) + 1", "256"],
		["hex(255.7) + 1", "256"],
		["(255.7 in hex) as number", "255"],
		["check (0.5 in hex) == 0", "✓"],
		["check 0.5 in hex == 0.5", "check failed: 0x0 is not equal to 0.50"],
		["check 255.7 in hex == 255", "✓"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("every base and both spellings cut the fraction from the value", () => {
		expect(shown("255.7 as octal")).toBe("0o377");
		expect(shown("(255.7 as octal) as number")).toBe("255");
		expect(shown("bin(2.5)")).toBe("0b10");
		expect(shown("bin(2.5) + 0")).toBe("2");
		expect(shown("255.7 in binary == 0xff")).toBe("true");
	});

	test("the reported document, through both passes", () => {
		expect(doc("A = 255.7\nB = A in hex\nB + 1\ncheck B == 255")).toEqual(["= 255.70", "= 0xFF", "= 256", "= ✓"]);
	});
});

describe("the forms beside it keep their meaning", () => {
	test.each([
		["255 in hex", "0xFF"],
		["hex(255) + 1", "256"],
		["(255 as binary) + 1", "256"],
		["hex(-255)", "-0xFF"],
		["(2^100 + 1) in hex", "0x10000000000000000000000001"],
		["(2^100 + 1) in hex as number", "1,267,650,600,228,229,401,496,703,205,377"],
		["255.7 + 1", "256.70"],
		["0xFF / 2", "127.50"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});
});

describe("wholeForBase, the part that changed", () => {
	test("ordinary: a fraction is cut toward zero", () => {
		expect(wholeForBase(255.7)).toBe(255);
		expect(wholeForBase(0.5)).toBe(0);
		expect(wholeForBase(-1.5)).toBe(-1);
		expect(wholeForBase(-255.7)).toBe(-255);
	});

	test("boundary: a fraction that leaves nothing is 0, not a negative zero", () => {
		expect(Object.is(wholeForBase(-0.5), 0)).toBe(true);
		expect(Object.is(wholeForBase(-0.0000001), 0)).toBe(true);
		expect(Object.is(wholeForBase(5e-324), 0)).toBe(true);
		expect(Object.is(wholeForBase(-0), -0)).toBe(true);
	});

	test("boundary: a whole number, 2^53 and the largest double are unchanged", () => {
		expect(wholeForBase(255)).toBe(255);
		expect(wholeForBase(2 ** 53)).toBe(2 ** 53);
		expect(wholeForBase(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
		expect(wholeForBase(Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
		expect(wholeForBase(-Number.MAX_VALUE)).toBe(-Number.MAX_VALUE);
	});

	test("hostile: a bigint, an infinity and a NaN pass through for the caller to refuse", () => {
		expect(wholeForBase(1267650600228229401496703205377n)).toBe(1267650600228229401496703205377n);
		expect(wholeForBase(-7n)).toBe(-7n);
		expect(wholeForBase(Infinity)).toBe(Infinity);
		expect(wholeForBase(-Infinity)).toBe(-Infinity);
		expect(Number.isNaN(wholeForBase(NaN))).toBe(true);
	});

	test("valueInBase holds the whole number it shows", () => {
		const hex = valueInBase(numberValue(255.7), "hex");
		expect(hex.type).toBe(ValueType.Hex);
		expect(hex.value).toBe(255);
		expect(valueInBase(numberValue(-0.5), "bin").value).toBe(0);
		expect(valueInBase(bigIntValue(1208925819614629174706176n), "oct").value).toBe(1208925819614629174706176n);
		expect(valueInBase(numberValue(Infinity), "hex").errorCode).toBe("BASE_NOT_FINITE");
		expect(valueInBase(numberValue(NaN), "hex").errorCode).toBe("BASE_NOT_FINITE");
	});

	test("a snapshot round trip keeps the whole number", () => {
		const value = newTrackedEngine().evaluateExpression("255.7 in hex");
		const restored = deserializeValue(snapshotValue(value, "test"));
		expect(restored.value).toBe(255);
		expect(formatValue(restored)).toBe("= 0xFF");
	});
});

describe("adversarial", () => {
	test("security: a word naming an inherited property holding a fraction, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word} in hex`);
				expectHonestLine(`255.7 in hex == ${word}`);
				expect(doc(`${word} = 255.7\n${word} in hex == 255`)).toEqual(["= 255.70", "= true"]);
			}
		});
	});

	test("security: look-alike digits and markup-shaped text are read as text", () => {
		for (const line of fill("X.7 in hex", TEXT_EDGES)) expectHonestLine(line);
		expect(shown("255.7​ in hex")).toBe("0xFF");
		expectHonestLine("٢٥٥.٧ in hex");
		expectHonestLine("２５５.７ in hex");
		expectHonestLine("<b>255.7</b> in hex");
	});

	test("security: a long sum, deep brackets and many lines with a fraction are answered in time", () => {
		expect(shown(`(${RESOURCE_PROBES.longSum(200)} + 0.5) in hex == 19900`)).toBe("true");
		expectHonestLine(`(${RESOURCE_PROBES.longSum(5_000)} + 0.5) in hex`);
		expectHonestLine(`${RESOURCE_PROBES.deepParens(500).replace("1", "1.5")} in hex`);
		expectHonestDocument(RESOURCE_PROBES.manyLines(1_000, "(prev + 0.5) in hex"));
	});

	test("realistic: a value from the line above, a check over it, a what-if and an edit", () => {
		expect(doc("price = 9.99\nprice in hex\ncheck line 2 == 9")).toEqual(["= 9.99", "= 0x9", "= ✓"]);
		expect(doc("a = 2.5\nb = a in binary\nline 2 with a = 7.9")).toEqual(["= 2.50", "= 0b10", "= 0b111"]);
		expect(afterEdit(["A = 255", "B = A in hex", "B + 1"], 1, "A = 255.7")).toEqual(["255.70", "0xFF", "256"]);
	});

	test("realistic: values written in a base, added by line number, add what they show", () => {
		expect(doc("1.5 in hex\n2.5 in hex\nline 1 + line 2")).toEqual(["= 0x1", "= 0x2", "= 3"]);
	});

	test("edge: zero, negative zero, negative fractions and 2^53 plus a half", () => {
		expect(shown("-0.5 in hex")).toBe("0x0");
		expect(shown("-0.5 in hex == 0")).toBe("true");
		expect(shown("-1.5 in hex")).toBe("-0x1");
		expect(shown("0.9999999999999999 in hex")).toBe("0x0");
		expect(shown("1/3 in hex == 0")).toBe("true");
		expect(shown("2^53 + 0.5 in hex")).toBe("0x20000000000000");
		expect(shown("1e308 in hex == 1e308")).toBe("true");
		expect(shown("5e-324 in hex")).toBe("0x0");
	});

	test("edge: every numeric edge plus a fraction, through each base", () => {
		for (const line of fill("(X + 0.5) in hex == X in hex", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		for (const line of fill("(X - 0.5) in binary", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("edge: CRLF and a trailing newline around the conversion", () => {
		expect(doc("A = 255.7\r\nA in hex\r\n")).toEqual(["= 255.70", "= 0xFF", ""]);
	});
});
