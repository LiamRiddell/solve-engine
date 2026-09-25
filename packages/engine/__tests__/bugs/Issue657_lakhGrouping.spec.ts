import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, evaluateLine, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { lakhGroupEnd, rupeeMarked } from "@solve-js/lexer/LakhGrouping";
import { numberFormatFor, scanNumbers } from "@solve-js/packages/text/TextExtraction";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Issue #657: in India one lakh (a hundred thousand) is written `1,00,000`, a
 * final group of three digits with groups of two before it. The lexer and text
 * extraction read a thousands group only as exactly three digits, so
 * `₹1,00,000` was refused at its first comma and `amounts in "₹1,00,000"`
 * answered `[1]`, a confident wrong answer for one lakh. Indian grouping is now
 * read beside a rupee marker (`₹` before the number, `INR` after it), and
 * everywhere in an Indian-region engine (`en-IN`). A bare `12,34,567` in an
 * English engine stays refused, and a comma in a call or a bracket stays a
 * separator.
 */

/** A line through the single-expression path: the answer, or `CODE: message`. */
function show(line: string, locale = "en"): string {
	const outcome = evaluateLine(line, newTrackedEngine({ locale }));
	if (outcome.kind === "value") return outcome.text;
	if (outcome.kind === "crashed") return `CRASHED ${outcome.name}: ${outcome.message}`;
	return `${outcome.code}: ${outcome.message}`;
}

/** Each line's answer or error, from a document result. */
function lines(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		const v = line.result;
		const failed = line.error ?? (v?.isError() ? String(v.errorMessage) : null);
		if (failed !== null) return `ERROR ${failed}`;
		return v ? formatValue(v) : "";
	});
}

describe("lakhGroupEnd", () => {
	test.each([
		["1,00,000", 1, 8],
		["12,34,567", 2, 9],
		["1,23,45,678", 1, 11],
		["10,00,000", 2, 9],
		["1,00,000.50", 1, 8],
		["₹1,00,000 rent", 2, 9],
	])("%s from %i ends at %i", (text, commaAt, end) => {
		expect(lakhGroupEnd(text, commaAt)).toBe(end);
	});

	test.each([
		["1,000", 1, "a single group of three is ordinary thousands grouping"],
		["1,00", 1, "no final group of three"],
		["1,00,00", 1, "no final group of three"],
		["1,00,0000", 1, "a final group of four"],
		["1,0,000", 1, "a group of one"],
		["1,00,000,000", 1, "the two conventions mixed"],
		["1,00,000", 0, "not at a comma"],
		["1,00,000", 99, "past the end"],
		["1, 00,000", 1, "a space inside the number"],
		["1,​00,000", 1, "a zero-width space inside the number"],
		["1,٠٠,٠٠٠", 1, "digits from another script"],
	])("%s from %i is not lakh grouping: %s", (text, commaAt) => {
		expect(lakhGroupEnd(text, commaAt)).toBe(-1);
	});

	test("adversarial: a long run of pairs is read in one pass", () => {
		const text = `1${",00".repeat(50_000)},000`;
		const started = performance.now();
		expect(lakhGroupEnd(text, 1)).toBe(text.length);
		expect(performance.now() - started).toBeLessThan(200);
	});
});

describe("rupeeMarked", () => {
	test("the rupee sign before the number, touching or spaced", () => {
		expect(rupeeMarked("₹1,00,000", 1, 9, Infinity)).toBe(true);
		expect(rupeeMarked("₹ 1,00,000", 2, 10, 1)).toBe(true);
		expect(rupeeMarked("₹ 1,00,000", 2, 10, 1)).toBe(true);
		expect(rupeeMarked("₹   1,00,000", 4, 12, Infinity)).toBe(true);
	});

	test("with a minus between the sign and the digits", () => {
		expect(rupeeMarked("₹-1,00,000", 2, 10, Infinity)).toBe(true);
		expect(rupeeMarked("₹−1,00,000", 2, 10, 1)).toBe(true);
	});

	test("the code INR after the number and any fraction", () => {
		expect(rupeeMarked("1,00,000 INR", 0, 8, 1)).toBe(true);
		expect(rupeeMarked("1,00,000INR", 0, 8, 1)).toBe(true);
		expect(rupeeMarked("1,00,000.50 INR", 0, 8, 1)).toBe(true);
		expect(rupeeMarked("1,00,000 INR.", 0, 8, 1)).toBe(true);
	});

	test.each([
		["1,00,000", 0, 8, Infinity, "no marker"],
		["$1,00,000", 1, 9, Infinity, "another currency"],
		["1,00,000 USD", 0, 8, Infinity, "another code"],
		["1,00,000 inr", 0, 8, Infinity, "a lower-case code the engine does not read"],
		["1,00,000 INRs", 0, 8, Infinity, "a longer word"],
		["₹  1,00,000", 3, 11, 1, "two spaces where pasted text allows one"],
		["₹5 - 1,00,000", 5, 13, Infinity, "a sign belonging to another number"],
		["₹\n1,00,000", 2, 10, Infinity, "a line break"],
	])("%s is not marked: %s", (text, start, end, gap) => {
		expect(rupeeMarked(text, start, end, gap)).toBe(false);
	});
});

describe("through the engine, English", () => {
	test.each([
		["₹1,00,000", "= ₹100,000.00"],
		["12,34,567 INR", "= ₹1,234,567.00"],
		["1,00,000 INR", "= ₹100,000.00"],
		["₹12,34,567.89", "= ₹1,234,567.89"],
		["₹ 10,00,000", "= ₹1,000,000.00"],
		["₹1,23,45,678", "= ₹12,345,678.00"],
		["-₹1,00,000", "= -₹100,000.00"],
		["₹-1,00,000", "= -₹100,000.00"],
		["₹1,00,000 + ₹50,000", "= ₹150,000.00"],
		["₹1,00,000 / 4", "= ₹25,000.00"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("the western spelling is unchanged", () => {
		expect(show("₹100,000")).toBe("= ₹100,000.00");
		expect(show("1,000,000")).toBe("= 1,000,000");
	});

	test.each(["12,34,567", "1,00,000", "$1,00,000", "1,00,000 USD", "₹1,00,000,000", "₹1,00,00"])(
		"%s is still refused: outside the convention a group of two is not a group",
		(line) => {
			expect(show(line)).toMatch(/^UNEXPECTED_TRAILING_TOKEN: /);
		},
	);

	test("a comma in a bracket or a call stays a separator", () => {
		expect(show("[₹1,00,000]")).not.toBe("= [₹100,000.00]");
		expect(show("max(₹1,00,000, 5)")).toBe("= 5");
	});
});

describe("through the engine, en-IN", () => {
	test.each([
		["12,34,567", "= 1,234,567"],
		["1,00,000", "= 100,000"],
		["1,00,000.25", "= 100,000.25"],
		["1,000,000", "= 1,000,000"],
		["1,00,000 * 2", "= 200,000"],
	])("%s is read without a rupee marker", (line, expected) => {
		expect(show(line, "en-IN")).toBe(expected);
	});

	test("a bracket, a call and a mixed grouping still refuse or separate", () => {
		expect(show("[1,00,000]", "en-IN")).toBe("= [1, 0, 0]");
		expect(show("max(1,00,000, 5)", "en-IN")).toBe("= 5");
		expect(show("1,00,000,000", "en-IN")).toMatch(/^UNEXPECTED_TRAILING_TOKEN: /);
	});

	test("hi-IN, which falls back to English, reads it too", () => {
		expect(show("12,34,567", "hi-IN")).toBe("= 1,234,567");
	});

	test("a German engine does not read Indian grouping, even beside a rupee sign", () => {
		// A German engine reads `1,000` as one (the comma is its decimal mark),
		// so reading `1,00,000` as lakhs there would be a guess.
		expect(show("₹1,00,000", "de")).toMatch(/^UNEXPECTED_TRAILING_TOKEN: /);
		expect(show("1,00,000", "de-IN")).toMatch(/^UNEXPECTED_TRAILING_TOKEN: /);
	});
});

describe("text extraction", () => {
	test("the issue's lines", () => {
		expect(show('amounts in "₹1,00,000"')).toBe("= [100,000]");
		expect(show('numbers in "₹1,00,000"')).toBe("= [100,000]");
		expect(show('amounts in "rent ₹12,34,567.89"')).toBe("= [1,234,567.89]");
	});

	test("a total keeps the currency", () => {
		expect(show('total of amounts in "rent ₹12,34,567.89, deposit ₹1,00,000"')).toBe("= ₹1,334,567.89");
	});

	test("the code after the amount marks it too", () => {
		expect(show('amounts in "paid 1,00,000 INR today"')).toBe("= [100,000]");
	});

	test("without a marker an English engine reads the digits as before, an en-IN engine as lakhs", () => {
		expect(show('numbers in "12,34,567"')).toBe("= [12, 34,567]");
		expect(show('numbers in "12,34,567"', "en-IN")).toBe("= [1,234,567]");
	});

	test("a currency two spaces away does not belong to the number, so its grouping is not read", () => {
		expect(show('numbers in "₹  1,00,000"')).toBe("= [1, 0]");
	});

	test("numberFormatFor marks an Indian-region engine", () => {
		expect(numberFormatFor("en-IN")).toEqual({ decimal: ".", groups: [","], lakhs: true });
		expect(numberFormatFor("en")).toEqual({ decimal: ".", groups: [","] });
		expect(numberFormatFor("de-DE")).toEqual({ decimal: ",", groups: ["."] });
	});

	test("scanNumbers attaches the rupee to the whole amount", () => {
		expect(scanNumbers("₹1,00,000 and ₹-12,34,567", numberFormatFor("en"), 10)).toEqual([
			{ value: 100000, currency: "INR" },
			{ value: -1234567, currency: "INR" },
		]);
	});
});

describe("whole documents", () => {
	test("both passes read it and agree", () => {
		const text = "rent = ₹12,34,567\nrent * 2\nlakh = 1,00,000 INR\nrent + lakh";
		const batch = lines(newTrackedEngine().parseDocument(text));
		const incremental = lines(evaluateDocument(newTrackedEngine(), text));
		expect(batch).toEqual(["= ₹1,234,567.00", "= ₹2,469,134.00", "= ₹100,000.00", "= ₹1,334,567.00"]);
		expect(incremental).toEqual(batch);
	});

	test("an en-IN document reads bare lakhs in both passes", () => {
		const text = "a = 12,34,567\na + 1,00,000";
		const batch = lines(newTrackedEngine({ locale: "en-IN" }).parseDocument(text));
		const incremental = lines(evaluateDocument(newTrackedEngine({ locale: "en-IN" }), text));
		expect(batch).toEqual(["= 1,234,567", "= 1,334,567"]);
		expect(incremental).toEqual(batch);
	});

	test("an en-IN host that formats with en-IN sees its own grouping back", () => {
		const settings = { ...DEFAULT_FORMATTING_SETTINGS, numberResult: { decimalSeparatorLocale: "en-IN" } };
		expect(formatValue(newTrackedEngine({ locale: "en-IN" }).evaluateExpression("₹12,34,567.89"), settings)).toBe("= ₹12,34,567.89");
	});
});

describe("adversarial", () => {
	test("prototype-named variables holding lakhs leave Object.prototype alone", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word} = ₹1,00,000`);
				expectHonestLine(`${word} = 1,00,000`, { engine: newTrackedEngine({ locale: "en-IN" }) });
			}
		});
	});

	test("a lakh number as long as a line may be is read or refused within budget", () => {
		const line = `₹1${",00".repeat(600)},000`;
		expectHonestLine(line, { budgetMs: 2_000 });
		expectHonestLine(`amounts in "${line}"`, { budgetMs: 2_000 });
	});

	test.each(["₹१,००,०००", "₹١,٠٠,٠٠٠", "₹1,​00,000", "₹1,00,‮000", "1,00,000​ INR"])(
		"%s, with look-alike or invisible characters, is answered honestly",
		(line) => {
			expectHonestLine(line);
			expect(show(line)).not.toBe("= ₹100,000.00");
		},
	);

	test("markup-shaped text around a lakh amount is read as text", () => {
		expect(show('amounts in "<b>₹1,00,000</b>"')).toBe("= [100,000]");
	});
});
