import { describe, expect, test } from "@jest/globals";
import { DOCUMENT_EDGES, NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, evaluateLine, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { stringValue, numberValue, uomValue, uomValueExact, errorValue, ValueType } from "@solve-js/vm/Value";
import { decimalFromLiteral } from "@solve-js/decimal";
import { inYearMoneyNormalizerRule, inYearTokenTypeFor } from "@solve-js/packages/finance/normalizer/InYearMoneyNormalizerRule";
import { InYearMoneyParselet } from "@solve-js/packages/finance/parselets/InYearMoneyParselet";
import { inYearCurrencyRefused, inflationToYearInCurrencyHandler } from "@solve-js/packages/finance/parselets/InflationPluginFunctions";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import type { Parser } from "@solve-js/parser/Parser";

/**
 * Found bug: `£100 in 1990 pounds` and `€100 in 2000 euros` were parse errors
 * (`Expected an operator or the end of the line, but found "1990"`), while
 * `$100 in 1990 dollars` answered. The interest and inflation page describes
 * adjusting an amount into a past year's money for all three currencies it
 * bundles an index for, and the dollar spelling was the only one with a
 * normaliser rule: `in <year> dollars` was fused into one token, and nothing
 * fused `in <year> pounds` or `in <year> euros`, so the conversion `in` took
 * the bare year and stranded it.
 *
 * The rule (`inYearMoneyNormalizerRule`) now fuses the pound and euro words as
 * well, one token per currency, and `InYearMoneyParselet` hands the currency
 * to `inflationToYearInCurrency`, which reads the amount's own index (UK CDKO
 * for pounds, the euro-area HICP for euros) and refuses an amount in another
 * currency by name (`inYearCurrencyRefused`). `€100 in 2000 euros` still
 * refuses, by the euro index's last year: it starts from today's money, and the
 * euro-area series ends with 2025.
 */

/** A line's answer or its refusal, as the reader sees it. */
function shown(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	return `${o.kind === "crashed" ? "CRASH" : "ERROR"} ${o.message}`;
}

/** The code a line answers with, or the kind of answer. */
function code(line: string): string {
	const o = evaluateLine(line);
	return o.kind === "error" || o.kind === "thrown" ? o.code : o.kind;
}

const EURO_ENDS = "ERROR Year 2026 is outside the bundled euro-area price index's range (1999-2025): the series it is built from ends with 2025, so name a year up to 2025 to adjust to";

describe("the lines that exposed it", () => {
	test.each([
		["£100 in 1990 pounds", "£30.53"],
		["£100 in 1990 pound", "£30.53"],
		["£100 in 1990 Pounds", "£30.53"],
		["100 GBP in 1990 pounds", "£30.53"],
		["$100 in 1990 dollars", "$39.46"],
		["€100 in 2000 euros", EURO_ENDS],
		["€100 in 2010 euro", EURO_ENDS],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("each spelling answers what the long form answers, through its own index", () => {
		expect(shown("£100 in 1990 pounds")).toBe(shown("what was £100 worth in 1990"));
		expect(shown("$100 in 1990 dollars")).toBe(shown("what was $100 worth in 1990"));
		expect(shown("€100 in 2010 euros")).toBe(shown("what was €100 worth in 2010"));
		expect(shown("£100 in 1990 pounds")).not.toBe(shown("$100 in 1990 dollars").split("$").join("£"));
	});

	test("an amount in another currency is refused by name, with the form that reads its own index", () => {
		expect(shown("$100 in 1990 pounds")).toBe("ERROR in 1990 pounds asks for pounds sterling, and this amount is in USD: ask what it was worth in 1990 instead, which reads the US consumer price index (BLS CPI-U)");
		expect(shown("£100 in 1990 euros")).toBe("ERROR in 1990 euros asks for euros, and this amount is in GBP: ask what it was worth in 1990 instead, which reads the UK price index (ONS CDKO)");
		expect(shown("£100 in 1990 dollars")).toBe("ERROR in 1990 dollars asks for US dollars, and this amount is in GBP: ask what it was worth in 1990 instead, which reads the UK price index (ONS CDKO)");
		expect(code("$100 in 1990 pounds")).toBe("INFLATION_EXPECTED_CURRENCY");
		expect(code("£100 in 1990 euros")).toBe("INFLATION_EXPECTED_CURRENCY");
		expect(code("£100 in 1990 dollars")).toBe("INFLATION_EXPECTED_USD");
	});

	test("the boundary: no year, no currency, a bare number, a weight", () => {
		expect(shown("5 kg in pounds")).toBe("11.02 pounds");
		expect(shown("100 in 1990 pounds")).toContain("this amount has none");
		expect(shown("100 kg in 1990 pounds")).toContain("kg is a mass");
		expect(shown("£100 in 1799 pounds")).toContain("Year 1799 is outside the bundled UK price index's range (1800-2026)");
		expect(shown("¥100 in 1990 pounds")).toContain("no price index for JPY is bundled");
	});

	test("the three entry points agree", () => {
		const { batch, incremental } = expectHonestDocument("£100 in 1990 pounds\n$100 in 1990 dollars\n$100 in 1990 pounds");
		expect(batch).toEqual(["= £30.53", "= $39.46", "ERROR in 1990 pounds asks for pounds sterling, and this amount is in USD: ask what it was worth in 1990 instead, which reads the US consumer price index (BLS CPI-U)"]);
		expect(incremental).toEqual(batch);
	});
});

describe("inYearTokenTypeFor", () => {
	test("ordinary: each currency word in either number and any case", () => {
		expect(inYearTokenTypeFor("dollars")).toBe("IN_YEAR_DOLLARS");
		expect(inYearTokenTypeFor("Dollar")).toBe("IN_YEAR_DOLLARS");
		expect(inYearTokenTypeFor("pounds")).toBe("IN_YEAR_POUNDS");
		expect(inYearTokenTypeFor("POUND")).toBe("IN_YEAR_POUNDS");
		expect(inYearTokenTypeFor("euros")).toBe("IN_YEAR_EUROS");
		expect(inYearTokenTypeFor("euro")).toBe("IN_YEAR_EUROS");
	});

	test("boundary and hostile: other words, empty, not a string, prototype words", () => {
		for (const word of ["yen", "GBP", "sterling", "", " pounds", "pounds "]) expect(inYearTokenTypeFor(word)).toBeUndefined();
		expect(inYearTokenTypeFor(undefined as unknown as string)).toBeUndefined();
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(inYearTokenTypeFor(word)).toBeUndefined();
		});
	});
});

describe("inYearMoneyNormalizerRule", () => {
	const rule = inYearMoneyNormalizerRule();
	function tok(type: string, value: string, offset = 0): Token {
		return new LexerToken(type, tokenTypeId(type), value, value, offset, 0, 1, offset + 1);
	}

	test("ordinary: in, a year and a currency word fuse into one token carrying the year", () => {
		const m = rule.match([tok("IN", "in"), tok("NUMBER", "1990", 3), tok("UNIT", "pounds", 8)], 0);
		expect(m?.consumed).toBe(3);
		expect(m?.replacement[0].type).toBe("IN_YEAR_POUNDS");
		expect(m?.replacement[0].value).toBe("1990");
		expect(rule.match([tok("IN", "in"), tok("NUMBER", "2010"), tok("IDENT", "euros")], 0)?.replacement[0].type).toBe("IN_YEAR_EUROS");
		expect(rule.match([tok("IN", "in"), tok("NUMBER", "1965"), tok("UNIT", "dollars")], 0)?.replacement[0].type).toBe("IN_YEAR_DOLLARS");
	});

	test("boundary and hostile: no year, another word, a short stream, prototype words", () => {
		expect(rule.match([tok("IN", "in"), tok("UNIT", "pounds")], 0)).toBeNull();
		expect(rule.match([tok("IN", "in"), tok("NUMBER", "1990"), tok("UNIT", "kg")], 0)).toBeNull();
		expect(rule.match([tok("IN", "in"), tok("NUMBER", "1990")], 0)).toBeNull();
		expect(rule.match([tok("IN", "in")], 0)).toBeNull();
		expect(rule.match([tok("FROM", "from"), tok("NUMBER", "1990"), tok("UNIT", "pounds")], 0)).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(rule.match([tok("IN", "in"), tok("NUMBER", "1990"), tok("IDENT", word)], 0)).toBeNull();
	});
});

describe("InYearMoneyParselet", () => {
	test("emits the year, the currency and the call, in that order", () => {
		const builder = new BytecodeBuilder(new Map([["inflationToYearInCurrency", 7]]));
		new InYearMoneyParselet("GBP").parse({} as Parser, {} as Token, { type: "IN_YEAR_POUNDS", value: "1990" } as Token, builder);
		const program = builder.build();
		expect(program.strings).toContain("GBP");
		expect(Array.from(program.numbers ?? [])).toContain(1990);
	});

	test("hostile: a year token that is not a number still emits the currency", () => {
		const builder = new BytecodeBuilder(new Map([["inflationToYearInCurrency", 7]]));
		new InYearMoneyParselet("EUR").parse({} as Parser, {} as Token, { type: "IN_YEAR_EUROS", value: "constructor" } as Token, builder);
		expect(builder.build().strings).toContain("EUR");
	});
});

describe("inYearCurrencyRefused and inflationToYearInCurrencyHandler", () => {
	const pounds = uomValueExact(100, "GBP", decimalFromLiteral("100"));

	test("ordinary: an amount in the named currency is not refused, and is adjusted", () => {
		expect(inYearCurrencyRefused("GBP", "GBP", "the UK price index (ONS CDKO)", 1990)).toBeNull();
		const v = inflationToYearInCurrencyHandler([pounds, numberValue(1990), stringValue("GBP")]);
		expect(v.type).toBe(ValueType.Uom);
		expect(v.unit).toBe("GBP");
		expect(v.toNumber()).toBeLessThan(100);
	});

	test("a mismatch names both currencies, and the dollar phrase keeps its code", () => {
		const usd = inYearCurrencyRefused("USD", "GBP", "the UK price index (ONS CDKO)", 1990)!;
		expect(usd.errorCode).toBe("INFLATION_EXPECTED_USD");
		expect(usd.errorMessage).toBe("in 1990 dollars asks for US dollars, and this amount is in GBP: ask what it was worth in 1990 instead, which reads the UK price index (ONS CDKO)");
		const eur = inYearCurrencyRefused("EUR", "USD", "the US index", 2010)!;
		expect(eur.errorCode).toBe("INFLATION_EXPECTED_CURRENCY");
		expect(eur.errorMessage).toContain("in 2010 euros asks for euros");
	});

	test("boundary and hostile: an unknown code, a fault as the amount, no currency argument, prototype words", () => {
		expect(inYearCurrencyRefused("XYZ", "GBP", "x", 1990)?.errorMessage).toContain("in 1990 XYZ asks for XYZ");
		const fault = errorValue("SOMETHING", "a fault");
		expect(inflationToYearInCurrencyHandler([fault, numberValue(1990), stringValue("GBP")])).toBe(fault);
		expect(inflationToYearInCurrencyHandler([uomValue(5, "kg"), numberValue(1990), stringValue("GBP")]).errorCode).toBe("INFLATION_NO_INDEX");
		expect(inflationToYearInCurrencyHandler([uomValue(100, "USD"), numberValue(1990)]).type).toBe(ValueType.Uom);
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(inYearCurrencyRefused(word, "GBP", "x", 1990)?.errorCode).toBe("INFLATION_EXPECTED_CURRENCY");
				expect(inflationToYearInCurrencyHandler([pounds, numberValue(1990), stringValue(word)]).errorCode).toBe("INFLATION_EXPECTED_CURRENCY");
			}
		});
	});
});

describe("adversarial", () => {
	test("security: prototype words before and after the year, huge and deep amounts, look-alike and markup text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`£100 in 1990 ${word}`);
				expectHonestLine(`${word} in 1990 pounds`);
				expectHonestDocument(`${word} = £100\n${word} in 1990 pounds`);
			}
		});
		expectHonestLine(`${RESOURCE_PROBES.deepParens(200)} * £1 in 1990 pounds`, { budgetMs: 5_000 });
		expectHonestLine(`(${RESOURCE_PROBES.longSum(500)}) * £1 in 1990 pounds`, { budgetMs: 5_000 });
		expectHonestLine("£100 in 1990 pounds in 1990 pounds");
		for (const line of fill("£100 in 1990 X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("£100 in X pounds", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: the line above as the amount, a check over it, the long form, a what-if, the other pass", () => {
		const { batch, incremental } = expectHonestDocument("rent = £500\nrent in 1990 pounds\ncheck rent in 1990 pounds < rent\nwhat was rent worth in 1990");
		expect(batch[1]).toBe(batch[3]);
		expect(batch[2]).toBe("= ✓");
		expect(incremental).toEqual(batch);
		expect(shown("£100 in 1990 poundz")).not.toBe("£30.53");
		expect(shown("£100 in 1990 pounds in USD")).not.toContain("CRASH");
	});

	test("edge: every numeric edge as the year and the amount, and the document edges around it", () => {
		for (const line of fill("£100 in X pounds", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("£X in 1990 pounds", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("€X in 2010 euros", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("£100 in 2026 pounds")).toBe("£100.00");
		for (const doc of DOCUMENT_EDGES) expectHonestDocument(`${doc}\n£100 in 1990 pounds`);
		expectHonestDocument("£100 in 1990 pounds\r\n€100 in 2010 euros\r\n");
	});
});
