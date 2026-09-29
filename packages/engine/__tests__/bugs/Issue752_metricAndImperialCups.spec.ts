import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EXTENDED_UNITS, MULTI_WORD_EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { canConvert, convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { isKnownUnit } from "@solve-js/lexer/units";
import { multiWordUnitNormalizerRule } from "@solve-js/packages/uom/normalizer/MultiWordUnitNormalizerRule";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";

/**
 * Issue #752: `cup` is the US customary cup, and a recipe from Australia, New
 * Zealand or Canada means the metric cup (250 ml), an older British one the
 * imperial cup (half an imperial pint). Neither could be written: `1 metric cup
 * in ml` was an undefined variable. `metric cup`, `imperial cup` and `US cup`
 * are now qualified spellings, joined by the multi-word unit rule as `imperial
 * pint` already was, and a bare `cup` stays the US cup.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text, { inputType: "markdown" }).lines.map((line) =>
		line.error ? `ERROR ${line.error}` : line.result ? formatValue(line.result).replace(/^=\s*/, "") : "");
}

describe("each cup reads as its own size", () => {
	test.each([
		["1 metric cup in ml", "250.00 ml"],
		["2 metric cups in ml", "500.00 ml"],
		["1 imperial cup in ml", "284.13 ml"],
		["2 imperial cups in ml", "568.26 ml"],
		["1 US cup in ml", "236.59 ml"],
		["2 US cups in ml", "473.18 ml"],
		["1 cup in ml", "236.59 ml"],
		["1 metric cup in cups", "1.06 cups"],
		["250 ml in metric cups", "1.00 metric cups"],
		["1 imperial pint in imperial cups", "2.00 imperial cups"],
		["1 cup in US cups", "1.00 US cups"],
		["4 metric cups in litres", "1.00 litres"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("two imperial cups are an imperial pint, exactly", () => {
		expect(show("2 imperial cups in imperial pints")).toBe("1.00 imperial pints");
		expect(convertUnit(2, "imperial cup", "imperial pint")).toBeCloseTo(1, 12);
	});
});

describe("the ingredient conversions work with each cup", () => {
	test.each([
		["2 metric cups flour in grams", "265.00 grams"],
		["2 imperial cups flour in grams", "301.18 grams"],
		["2 US cups flour in grams", "250.78 grams"],
		["2 cups flour in grams", "250.78 grams"],
		["300g butter in metric cups", "1.25 metric cups"],
		["1 1/2 metric cups in ml", "375.00 ml"],
		["1 1/2 metric cups flour in grams", "198.75 grams"],
		["½ metric cup in ml", "125.00 ml"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});
});

describe("what it must not break", () => {
	test.each([
		["1 metric ton in kg", "1,000.00 kg"],
		["1 imperial pint in ml", "568.26 ml"],
		["1 US legal cup in ml", "240.00 ml"],
		["1 cup in c", "1.00 c"],
		["2 cups sugar in grams", "399.83 grams"],
		["5 imperial gallons in litres", "22.73 litres"],
	])("%s is still %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("metric and imperial stay ordinary words, and names", () => {
		expect(doc("metric = 5\nmetric * 2")).toEqual(["5", "10"]);
		expect(doc("imperial = 3\n2 imperial")).toEqual(["3", "6"]);
		// Prose answers no number, exactly as the same sentence without the word.
		expect(doc("The metric system is simpler.\nAn imperial cup is bigger.\nI used 2 metric cups of flour.")).toEqual(
			doc("The decimal system is simpler.\nAn ordinary cup is bigger.\nI used 2 cups of flour.").map((line) =>
				line.replace(/"decimal"/, '"metric"').replace(/"ordinary"/, '"imperial"'))
		);
	});

	test("the lower-case us is not the US cup, as us is an English word", () => {
		expect(show("1 us cup in ml")).toBe("THROWS Undefined variable: us");
	});
});

describe("the parts", () => {
	test("each cup is a volume stated in cubic metres", () => {
		for (const [spelling, ml] of [["metric cup", 250], ["metric cups", 250], ["imperial cup", 284.130625], ["imperial cups", 284.130625], ["US cup", 236.5882365], ["US cups", 236.5882365]] as const) {
			expect(EXTENDED_UNITS[spelling].measure).toBe("volume");
			expect(EXTENDED_UNITS[spelling].toBase).toBeCloseTo(ml / 1e6, 15);
			expect(getMeasure(spelling)).toBe("volume");
			expect(canConvert(spelling, "ml")).toBe(true);
			expect(convertUnit(1, spelling, "ml")).toBeCloseTo(ml, 9);
		}
	});

	test("the US cup is the table's own cup, not a second figure", () => {
		expect(EXTENDED_UNITS["US cup"].toBase).toBe(UNIT_TABLE.cup[1]);
	});

	test("none of the spellings is already in the generated table", () => {
		for (const spelling of MULTI_WORD_EXTENDED_UNITS) expect(UNIT_TABLE[spelling]).toBeUndefined();
	});

	test("the multi-word list holds every spaced spelling and nothing else", () => {
		expect(MULTI_WORD_EXTENDED_UNITS).toEqual(expect.arrayContaining(["metric cup", "metric cups", "imperial cup", "imperial cups", "US cup", "US cups"]));
		for (const spelling of MULTI_WORD_EXTENDED_UNITS) expect(spelling).toContain(" ");
		for (const spelling of Object.keys(EXTENDED_UNITS)) {
			expect(MULTI_WORD_EXTENDED_UNITS.includes(spelling)).toBe(spelling.includes(" "));
		}
	});

	test("a spaced spelling is not a lexer unit, since it cannot be one token", () => {
		for (const spelling of MULTI_WORD_EXTENDED_UNITS) expect(isKnownUnit(spelling)).toBe(false);
		expect(isKnownUnit("metric")).toBe(false);
		expect(isKnownUnit("imperial")).toBe(false);
	});

	describe("the multi-word rule", () => {
		const rule = multiWordUnitNormalizerRule();
		const tokens = (text: string) => {
			const lexer = new ExpressionLexer();
			lexer.reset(text);
			return lexer.tokenizeAll().filter((t) => t.type !== "EOF");
		};

		test("joins a cup after a number, and after in", () => {
			const after = rule.match(tokens("2 metric cups"), 0);
			expect(after?.consumed).toBe(3);
			expect(after?.replacement.map((t) => [t.type, t.value])).toEqual([["NUMBER", "2"], ["UNIT", "metric cups"]]);
			const target = tokens("250 ml in metric cups");
			const at = target.findIndex((t) => t.type === "IN");
			expect(rule.match(target, at)?.replacement[1].value).toBe("metric cups");
		});

		test("needs the words exactly one space apart, in the table's case", () => {
			expect(rule.match(tokens("2 metric  cups"), 0)).toBeNull();
			expect(rule.match(tokens("2 Metric cups"), 0)).toBeNull();
			expect(rule.match(tokens("2 us cups"), 0)).toBeNull();
			expect(rule.match(tokens("2 metric"), 0)).toBeNull();
		});

		test("does not join a cup that follows a name", () => {
			expect(rule.match(tokens("x metric cups"), 0)).toBeNull();
		});

		test("does not read an inherited property as a spelling", () => {
			for (const word of PROTOTYPE_WORDS) expect(rule.match(tokens(`2 ${word} cups`), 0)).toBeNull();
		});
	});
});

describe("adversarial", () => {
	test("security: a prototype word in the qualifier's place is an unknown word", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`1 ${word} cup in ml`);
				expectHonestLine(`250 ml in ${word} cups`);
				expectHonestDocument(`${word} = 2\n${word} metric cups in ml`, { agree: true });
			}
		});
	});

	test("security: look-alike characters are not the spelling", () => {
		// A zero-width space between the words, and a Cyrillic "с" in "cup".
		// The lexer separates words at a zero-width space as it does at a space,
		// so the new spellings read the way the table's own two-word units do.
		expect(show("1 metric\u200Bcup in ml")).toBe("250.00 ml");
		expect(show("1 imperial\u200Bpint in ml")).toBe("568.26 ml");
		expect(show("1 metric \u0441up in ml")).toMatch(/^THROWS/);
		for (const edge of TEXT_EDGES) expectHonestLine(`${edge} metric cups in ml`);
	});

	test("security: markup-shaped text around a cup is read as text", () => {
		expectHonestLine("<b>2 metric cups</b> in ml");
		expectHonestDocument("<script>2 metric cups</script>\n2 metric cups in ml");
	});

	test("security: a long run of cups is answered in time", () => {
		expectHonestLine(Array.from({ length: 2_000 }, () => "1 metric cup").join(" + "), { budgetMs: 5_000 });
	});

	test("realistic: a value from the line above, a check and a what-if", () => {
		expect(doc(":flour = 2 metric cups\nflour in ml\ncheck flour == 500 ml")).toEqual(["2.00 metric cups", "500.00 ml", "✓"]);
		expect(doc(":cups = 2\ncups metric cups in ml")).toEqual(["2", expect.stringMatching(/^ERROR|^$/)]);
		expectHonestDocument(":flour = 2 metric cups\nflour in ml\nline 2 with flour = 3 metric cups");
	});

	test("realistic: a cup meets arithmetic with the other cups", () => {
		expect(show("(1 metric cup + 1 cup) in ml")).toBe("486.59 ml");
		expect(show("(1 imperial cup - 1 metric cup) in ml")).toBe("34.13 ml");
		// `in` binds tighter than `+`, so the sum takes the first value's unit.
		expect(show("1 metric cup + 1 cup in ml")).toBe("1.95 metric cup");
		expect(show("1 metric cup in kg")).toMatch(/volume/);
	});

	test("edge: the numeric edges before a cup stay honest", () => {
		for (const line of fill("X metric cups in ml", NUMERIC_EDGES)) {
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		}
		expect(show("0 metric cups in ml")).toBe("0.00 ml");
		expect(show("-1 metric cup in ml")).toBe("-250.00 ml");
	});

	test("edge: CRLF, a trailing newline and blank lines", () => {
		expect(doc("1 metric cup in ml\r\n2 metric cups in ml\n")).toEqual(["250.00 ml", "500.00 ml", ""]);
		expectHonestDocument("\n\n1 imperial cup in ml\n\n");
	});
});
