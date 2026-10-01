import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { decimalFromExponentLiteral, decimalToString, EXACT_EXPONENT_LIMIT } from "@solve-js/decimal/Decimal";
import { CURRENCY_SYMBOL_TYPES, isMoneyAmount } from "@solve-js/parser/MoneyAmountLiteral";
import { Lexer } from "@solve-js/lexer/Lexer";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import { NumberParselet } from "@solve-js/packages/arithmetic/parselets/NumberParselet";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { exponentLiteralValue } from "@solve-js/vm/VM";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `$1e-3` was shown as `$0.001`, while `$0.001` is `$0.00`, and
 * `$1.005e0` was `$1.00` where `$1.005` is `$1.01`.
 *
 * A literal written with a point keeps its exact base-ten value beside the
 * double (PUSH_DECIMAL), and money reads it to round to the currency's minor
 * unit, half away from zero. A literal written in exponent form was pushed as
 * the nearest double alone, so as an amount of money it was shown as a
 * converted amount is, with its small digits, and a half cent rounded the way
 * the double sitting just below it does. As the amount of money (after a
 * currency symbol, or before a currency written after it), an exponent-form
 * literal is now read exactly too: `1e-3` is 1/1000, built from its digits and
 * exponent with no double in between (`decimalFromExponentLiteral`). On its
 * own, scientific notation stays a double, as `FoundBug_wholeLiteralPastSafeRange`
 * and `FoundBug_decimalLiteralPastSafeRange` pin.
 */

/** A line's answer, or `THROWS <message>`. */
function shown(line: string, engine: ExpressionEngine = newTrackedEngine()): string {
	try {
		return formatValue(engine.evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** A document line's answer, or `THREW: <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "THREW: no line";
	if (line.error) return `THREW: ${line.error}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

/** Each line of a document, through both passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** A bare token, for the money-amount test. */
function token(type: string, text: string): Token {
	return new LexerToken(type, tokenTypeId(type), text, text, 0, text.length, 1, 1);
}

/** An exact decimal as text, or null. */
function exactly(text: string): string | null {
	const d = decimalFromExponentLiteral(text);
	return d === null ? null : decimalToString(d);
}

describe("the lines that exposed it", () => {
	test("an amount in exponent form rounds to the cent, as the same amount with a point does", () => {
		expect(shown("$1e-3")).toBe("$0.00");
		expect(shown("$0.001")).toBe("$0.00");
		expect(shown("$1e-320")).toBe("$0.00");
		expect(shown("$1.005e0")).toBe(shown("$1.005"));
		expect(shown("$1.005e0")).toBe("$1.01");
		expect(shown("$2.675e0")).toBe("$2.68");
	});

	test("the larger amounts the issue named, and the infinite one", () => {
		expect(shown("$1e3")).toBe("$1,000.00");
		expect(shown("$1.5e2")).toBe("$150.00");
		expect(shown("£2.5e-2")).toBe("£0.03");
		expect(shown("$1e21")).toBe("$1,000,000,000,000,000,000,000.00");
		expect(shown("$1e21")).toBe(shown("$1000000000000000000000"));
		// Past the largest double, as the same amount written out in full is.
		expect(shown("$1e400")).toBe("$∞");
		expect(shown(`$1${"0".repeat(400)}`)).toBe("$∞");
	});

	test("a currency written after the amount, a sign, and the other symbols", () => {
		expect(shown("1e-3 USD")).toBe("$0.00");
		expect(shown("1e-3 dollars")).toBe("$0.00");
		expect(shown("1e-3 usd")).toBe("$0.00");
		expect(shown("1e-3 €")).toBe("€0.00");
		expect(shown("$-1e-3")).toBe(shown("$-0.001"));
		expect(shown("-$1e-3")).toBe(shown("-$0.001"));
		expect(shown("US$1e-3")).toBe("$0.00");
		expect(shown("₹2.5e-3")).toBe("₹0.00");
		expect(shown("¥5e-1")).toBe("¥1");
		expect(shown("1.0005e0 BHD")).toBe("1.001 BHD");
		expect(shown("1e-9 BTC")).toBe(shown("0.000000001 BTC"));
	});

	test("the amount stays exact through arithmetic, as the point form does", () => {
		expect(shown("$1e-3 * 1000")).toBe("$1.00");
		expect(shown("$1e-3 + $1e-3")).toBe(shown("$0.001 + $0.001"));
		expect(shown("$1.0e-2 + $2e-2")).toBe("$0.03");
		expect(shown("$2.5e-3 * 2")).toBe("$0.01");
		expect(shown("$1e-3/kWh")).toBe("$0.001/kWh");
	});

	test("a plain number in exponent form is unchanged", () => {
		expect(shown("1e-3")).toBe("0.001");
		expect(shown("1e-320")).toBe("1e-320");
		expect(shown("1e16 + 1 - 1e16")).toBe("0");
		expect(shown("1e-3 km")).toBe("0.001 km");
		expect(newTrackedEngine().evaluateExpression("1e-3").exact).toBeUndefined();
		expect(newTrackedEngine().evaluateExpression("$1e-3").exact).toBeDefined();
	});

	test("through the three entry points", () => {
		expect(formatValue(newTrackedEngine().evaluateLine(1, "$1e-3"))).toBe("= $0.00");
		expect(both(["price = $1e-3", "price * 1000", "1e-3 USD", "$0.001"])).toEqual(["$0.00", "$1.00", "$0.00", "$0.00"]);
	});
});

describe("the parts: decimalFromExponentLiteral", () => {
	test("ordinary: the digits and the exponent, read with no double in between", () => {
		expect(exactly("1e-3")).toBe("0.001");
		expect(exactly("1.5e2")).toBe("150");
		expect(exactly("2.5E-2")).toBe("0.025");
		expect(exactly("1.005e0")).toBe("1.005");
		expect(exactly("-1e-3")).toBe("-0.001");
		expect(exactly("+1e+3")).toBe("1000");
		expect(exactly(".5e1")).toBe("5");
		expect(exactly("5.e-1")).toBe("0.5");
	});

	test("boundary: the limit either way, a zero and a leading-zero exponent", () => {
		expect(EXACT_EXPONENT_LIMIT).toBe(400);
		expect(decimalFromExponentLiteral("1e400")).toEqual({ coef: BigInt(`1${"0".repeat(400)}`), scale: 0 });
		expect(decimalFromExponentLiteral("1e-400")).toEqual({ coef: 1n, scale: 400 });
		expect(decimalFromExponentLiteral("1e401")).toBeNull();
		expect(decimalFromExponentLiteral("1e-401")).toBeNull();
		expect(decimalFromExponentLiteral("1e0400")).toEqual({ coef: BigInt(`1${"0".repeat(400)}`), scale: 0 });
		expect(exactly("0e0")).toBe("0");
		expect(exactly("0e-5")).toBe("0.00000");
		expect(exactly("12345678901234567890123456789012345e-35")).toBe("0.12345678901234567890123456789012345");
	});

	test("hostile: not an exponent literal, a huge exponent, prototype words", () => {
		for (const text of ["", "e", "e5", "1e", "1e+", "1.2.3e4", "1e3.5", "0x1e3", "1,000e3", "1e-3 ", " 1e-3", "１e3", "1e٣", "NaN", "Infinity", "1_000e3"]) {
			expect(decimalFromExponentLiteral(text)).toBeNull();
		}
		const started = Date.now();
		expect(decimalFromExponentLiteral("1e99999999")).toBeNull();
		expect(decimalFromExponentLiteral(`1e${"9".repeat(10_000)}`)).toBeNull();
		expect(decimalFromExponentLiteral(`1e-${"9".repeat(10_000)}`)).toBeNull();
		expect(Date.now() - started).toBeLessThan(1_000);
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(decimalFromExponentLiteral(word)).toBeNull();
		});
	});
});

describe("the parts: exponentLiteralValue", () => {
	test("ordinary: the nearest double with the exact decimal beside it", () => {
		const v = exponentLiteralValue("1e-3");
		expect(v.toNumber()).toBe(0.001);
		expect(v.exact).toEqual({ coef: 1n, scale: 3 });
	});

	test("boundary: an infinite or underflowed double keeps no exact value", () => {
		expect(exponentLiteralValue("1e309").toNumber()).toBe(Infinity);
		expect(exponentLiteralValue("1e309").exact).toBeUndefined();
		expect(exponentLiteralValue("1e-330").toNumber()).toBe(0);
		expect(exponentLiteralValue("1e-330").exact).toBeUndefined();
		expect(exponentLiteralValue("0e0").exact).toEqual({ coef: 0n, scale: 0 });
		expect(exponentLiteralValue("5e-324").exact).toEqual({ coef: 5n, scale: 324 });
	});

	test("hostile: past the limit, or text a hostile snapshot could carry, is the double alone", () => {
		expect(exponentLiteralValue("1e99999999").exact).toBeUndefined();
		expect(exponentLiteralValue("1e99999999").toNumber()).toBe(Infinity);
		expect(exponentLiteralValue("e").exact).toBeUndefined();
	});
});

describe("the parts: isMoneyAmount", () => {
	test("ordinary: a symbol before, or a currency after", () => {
		expect(isMoneyAmount(token("DOLLAR", "$"), undefined, undefined)).toBe(true);
		expect(isMoneyAmount(undefined, undefined, token("UNIT", "USD"))).toBe(true);
		expect(isMoneyAmount(undefined, undefined, token("UNIT", "dollars"))).toBe(true);
		expect(isMoneyAmount(undefined, undefined, token("UNIT", "€"))).toBe(true);
		for (const type of CURRENCY_SYMBOL_TYPES) expect(isMoneyAmount(token(type, "x"), undefined, undefined)).toBe(true);
	});

	test("boundary: a sign between the symbol and the amount, and nothing either side", () => {
		expect(isMoneyAmount(token("MINUS", "-"), token("POUND", "£"), undefined)).toBe(true);
		expect(isMoneyAmount(token("PLUS", "+"), token("EURO", "€"), undefined)).toBe(true);
		expect(isMoneyAmount(token("MINUS", "-"), undefined, undefined)).toBe(false);
		expect(isMoneyAmount(token("STAR", "*"), token("DOLLAR", "$"), undefined)).toBe(false);
		expect(isMoneyAmount(undefined, undefined, undefined)).toBe(false);
	});

	test("hostile: a unit that is not money, a word, and the prototype words", () => {
		expect(isMoneyAmount(undefined, undefined, token("UNIT", "km"))).toBe(false);
		expect(isMoneyAmount(undefined, undefined, token("IDENT", "USD"))).toBe(false);
		expect(isMoneyAmount(token("IDENT", "dollar"), undefined, undefined)).toBe(false);
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(isMoneyAmount(token(word, word), token(word, word), token("UNIT", word))).toBe(false);
			}
		});
	});
});

describe("the parts: the two parse tiers", () => {
	/** The opcode and pooled string NumberParselet emits for the number in `source`. */
	function tierTwo(source: string): { op: number; strings: string[] } {
		const lexer = new Lexer("en");
		lexer.reset(source);
		const tokens = Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE");
		const parser = new PrecedenceParser(new ParseletRegistry(), 50, "en");
		parser.load(tokens, false);
		let number: Token | undefined;
		while (parser.peek() !== undefined && number === undefined) {
			const t = parser.consume();
			if (t.type === "NUMBER") number = t;
		}
		const builder = new BytecodeBuilder();
		new NumberParselet().parse(parser, number!, builder);
		const program = builder.build();
		return { op: program.opcodes[0], strings: program.strings };
	}

	test("ordinary: the amount of money is pushed exactly, by its text", () => {
		expect(tierTwo("$1e-3")).toEqual({ op: OpCode.PUSH_DECIMAL, strings: ["1e-3"] });
		expect(tierTwo("1e-3 USD")).toEqual({ op: OpCode.PUSH_DECIMAL, strings: ["1e-3"] });
		expect(tierTwo("$-1e-3")).toEqual({ op: OpCode.PUSH_DECIMAL, strings: ["1e-3"] });
	});

	test("boundary: a plain number, a unit that is not money, and an exponent past the limit stay doubles", () => {
		expect(tierTwo("1e-3").op).toBe(OpCode.PUSH_NUMBER);
		expect(tierTwo("1e-3 km").op).toBe(OpCode.PUSH_NUMBER);
		expect(tierTwo("$1e999").op).toBe(OpCode.PUSH_NUMBER);
		expect(tierTwo("$1000").op).toBe(OpCode.PUSH_NUMBER);
	});

	test("hostile: a symbol two places back with an operator between is not the amount's", () => {
		expect(tierTwo("$5 * 1e-3").op).toBe(OpCode.PUSH_NUMBER);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`$1e-3 ${word}`, `1e-3 ${word}`, `${word} = $1e-3`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a huge exponent, a long sum of amounts and deep brackets are answered in time", () => {
		expectHonestLine("$1e99999999", { budgetMs: 2_000 });
		expectHonestLine(`$1e-${"9".repeat(5_000)}`, { budgetMs: 2_000 });
		expectHonestLine(Array.from({ length: 2_000 }, () => "$1e-3").join(" + "), { budgetMs: 5_000 });
		expectHonestLine(`${"(".repeat(200)}$1e-3${")".repeat(200)}`, { budgetMs: 5_000 });
		expectHonestDocument(RESOURCE_PROBES.manyLines(500, "prev + $1e-3"), { budgetMs: 10_000 });
	});

	test("look-alike digits and an invisible character are not read as the amount", () => {
		for (const line of ["$１e-3", "$1e-٣", "$1​e-3", "$1е-3"]) expectHonestLine(line);
		// A Cyrillic е in the exponent is no exponent.
		expect(shown("$1е-3")).not.toBe("$0.00");
	});

	test.each(fill("$1e-3 X", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after the amount: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text around the amount is read as text", () => {
		expectHonestLine("<b>$1e-3</b>");
		expectHonestLine("$1e-3<script>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo in the exponent is refused or read as written, never invented", () => {
		expectHonestLine("$1e-");
		expectHonestLine("$1ee-3");
		expectHonestLine("$1e--3");
		expect(shown("$5.e-3")).toMatch(/^THROWS /);
	});

	test("the amount from the line above, a check, a what-if and a conversion through it", () => {
		expect(both(["fee = $1e-3", "fee * 3000", "check fee * 1000 == $1"])).toEqual(["$0.00", "$3.00", "✓"]);
		expectHonestDocument("fee = $1e-3\ncount = 1000\nfee * count\nline 3 with count = 2000");
		expectHonestDocument("$1e-3 in EUR\n1e-3 USD in GBP");
	});

	test("a locale that writes the decimal with a comma reads the exponent form the same", () => {
		const de = newTrackedEngine({ locale: "de" });
		expect(shown("$1e-3", de)).toBe("$0.00");
		expect(shown("1e-3", de)).toBe("0.001");
	});

	test("a snapshot round trip keeps the exact amount", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("fee = $1e-3\nfee * 1000");
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())), { packages: BUILTIN_PACKAGES });
		try {
			expect(restored.parseDocument("fee = $1e-3\nfee * 1000").lines.map(read)).toEqual(["$0.00", "$1.00"]);
		} finally {
			restored.clear();
		}
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negative zero, the smallest double and the 34-digit limit", () => {
		expect(shown("$0e0")).toBe("$0.00");
		expect(shown("$-0e0")).toBe("$0.00");
		expect(shown("$5e-324")).toBe("$0.00");
		expect(shown("$1e-400")).toBe("$0.00");
		expect(shown("$12345678901234567890123456789012345e-33")).toBe(shown("$12.345678901234567890123456789012345"));
		expect(shown("$9007199254740993e0")).toBe(shown("$9007199254740993"));
		expect(shown("$1.7976931348623157e308")).toBe(shown("$1.7976931348623157e308 * 1"));
	});

	test.each(fill("$X", NUMERIC_EDGES))("a numeric edge as the amount: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("a CRLF line and a trailing newline through both passes", () => {
		expect(both(["$1e-3\r", "1e-3 USD\r", ""]).slice(0, 2)).toEqual(["$0.00", "$0.00"]);
	});
});
