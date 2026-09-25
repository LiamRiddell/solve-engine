import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, evaluateLine, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { NumberParselet } from "@solve-js/packages/arithmetic/parselets/NumberParselet";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { isDotDecimal, localeLiteralRefusal, unreadableInLocale } from "@solve-js/parser/LocaleNumberLiteral";
import { OpCode } from "@solve-js/parser/OpCode";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";

/**
 * Issue #654: under the `de` locale a dot decimal was read as a thousands
 * group. German groups thousands with `.`, and the parser stripped every `.`
 * from a literal whatever followed it, so `2.5` gave 25, `$9.99` gave $999.00
 * and `0.5` gave 5: wrong money, a hundred times too large, with nothing on the
 * line to say so. A dot that is not followed by exactly three digits is not a
 * German group, so such a literal is now refused with INVALID_NUMBER_LITERAL,
 * naming the locale, at both parse sites. `2.500` is still two thousand five
 * hundred, and a dotted date is still a date.
 */

/** A line through the single-expression path, as the reader sees it: the answer, or `CODE: message`. */
function show(line: string, locale = "de"): string {
	const outcome = evaluateLine(line, newTrackedEngine({ locale }));
	if (outcome.kind === "value") return outcome.text;
	if (outcome.kind === "crashed") return `CRASHED ${outcome.name}: ${outcome.message}`;
	return `${outcome.code}: ${outcome.message}`;
}

/** The refusal message the engine gives for `raw` under `de`. */
function refusal(raw: string): string {
	return `INVALID_NUMBER_LITERAL: "${raw}" is not a number in the de locale: "." groups thousands there, so it is followed by exactly three digits, as in 2.500 (two thousand five hundred).`;
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

describe("isDotDecimal", () => {
	test.each(["2.5", "0.5", ".5", ".500", "9.99", "1.0001", "3.14159", "12.30", "1,000.5", "1.5e3", "1.234.56", "0.0001"])(
		"%s holds a dot that is not a thousands group",
		(raw) => {
			expect(isDotDecimal(raw)).toBe(true);
		},
	);

	test.each(["2.500", "1.000", "0.000", "1.234.567", "1.000e3", "12345.678", "1000", "1,000", "0x1F", "", "7"])(
		"%s is not refused",
		(raw) => {
			expect(isDotDecimal(raw)).toBe(false);
		},
	);

	test("adversarial: a literal of a hundred thousand digits is settled in one pass", () => {
		const long = `1.${"5".repeat(100_000)}`;
		const grouped = `1${".000".repeat(30_000)}`;
		const started = performance.now();
		expect(isDotDecimal(long)).toBe(true);
		expect(isDotDecimal(grouped)).toBe(false);
		expect(performance.now() - started).toBeLessThan(500);
	});
});

describe("unreadableInLocale", () => {
	test("a dot decimal is caught only where the comma marks the decimal and the dot groups", () => {
		expect(unreadableInLocale("2.5", ",", ".")).toBe("dot-decimal");
		expect(unreadableInLocale("2.5", ".", ",")).toBeNull();
		expect(unreadableInLocale("2.5", ",", " ")).toBeNull();
		expect(unreadableInLocale("2.500", ",", ".")).toBeNull();
	});
});

describe("localeLiteralRefusal for a dot decimal", () => {
	test("a parsing error named INVALID_NUMBER_LITERAL, the tag kept in its context", () => {
		const error = localeLiteralRefusal("2.5", "de-AT", "dot-decimal", { start: 4, end: 7 });
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe("INVALID_NUMBER_LITERAL");
		expect(error.category).toBe("PARSING");
		expect(error.recoverable).toBe(true);
		expect(error.span).toEqual({ start: 4, end: 7 });
		expect(error.context).toEqual({ raw: "2.5", localeCode: "de-AT", separator: "." });
	});

	test("the message names the language pack, not the host's full tag", () => {
		expect(localeLiteralRefusal("2.5", "de-AT", "dot-decimal").message).toBe(refusal("2.5").replace("INVALID_NUMBER_LITERAL: ", ""));
	});

	test("adversarial: a tag of any length cannot swell the message", () => {
		const tag = `de-${"x".repeat(100_000)}`;
		const error = localeLiteralRefusal("2.5", tag, "dot-decimal");
		expect(error.message.length).toBeLessThan(200);
		expect(error.context?.localeCode).toBe(tag);
	});
});

describe("through the engine, under de", () => {
	test.each([
		["2.5", "2.5"],
		["$9.99", "9.99"],
		["1.5 km", "1.5"],
		["0.5", "0.5"],
		["3.14159", "3.14159"],
		["1.0001", "1.0001"],
		["12.5%", "12.5"],
		["9.99 EUR", "9.99"],
	])("%s is refused rather than read a hundred times too large", (line, raw) => {
		expect(show(line)).toBe(refusal(raw));
	});

	test.each([
		["2.500", "= 2,500"],
		["1.000", "= 1,000"],
		["1.234.567", "= 1,234,567"],
		["1.000 + 1", "= 1,001"],
		["€1.250", "= €1,250.00"],
		["1.000n", "= 1000"],
		["1.000e3", "= 1,000,000"],
	])("%s keeps its German reading", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("a dotted date is still a date", () => {
		expect(show("17.11.2025")).toBe("= Monday, November 17, 2025");
	});

	test("other locales are unchanged: en and fr read the dot as a decimal", () => {
		expect(show("2.5", "en")).toBe("= 2.50");
		expect(show("$9.99", "en")).toBe("= $9.99");
		expect(show("2.5", "fr")).toBe("= 2.50");
		expect(show("0.5 kg", "fr")).toBe("= 0.50 kg");
	});

	test("the refusal points at the literal, not the line", () => {
		const engine = newTrackedEngine({ locale: "de" });
		let thrown: unknown;
		try {
			engine.evaluateExpression("2.500 + 2.5");
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(EngineError);
		expect((thrown as EngineError).span).toMatchObject({ start: 8, end: 11 });
	});
});

describe("both parse tiers refuse together", () => {
	/** Tokens for a source string, with the whitespace the parser never sees. */
	function lex(source: string, locale: string): Token[] {
		const lexer = new Lexer(locale);
		lexer.reset(source);
		return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
	}

	/** NumberParselet on its own, the Tier-2 copy of the Tier-1 NUMBER case. */
	function tierTwo(source: string, locale: string) {
		const token = lex(source, locale)[0];
		const parser = new PrecedenceParser(new ParseletRegistry(), 50, locale);
		parser.load([], false);
		const builder = new BytecodeBuilder();
		new NumberParselet().parse(parser, token, builder);
		builder.emitOpcode(OpCode.HALT);
		return unwrapEvalResult(executeBytecode(builder.build(), createVM(sharedOpRegistry)));
	}

	test.each(["2.5", "9.99", "0.5", ".5", "1.0001", "1,000.5"])("%s", (source) => {
		expect(() => tierTwo(source, "de")).toThrow(EngineError);
		expect(() => tierTwo(source, "de")).toThrow(/is not a number in the de locale/);
		expect(() => newTrackedEngine({ locale: "de" }).evaluateExpression(source)).toThrow(/is not a number in the de locale/);
	});

	test("and agree on what they keep", () => {
		expect(tierTwo("2.500", "de").toNumber()).toBe(2500);
		expect(newTrackedEngine({ locale: "de" }).evaluateExpression("2.500").toNumber()).toBe(2500);
		expect(tierTwo("2.5", "en").toNumber()).toBe(2.5);
	});
});

describe("whole documents under de", () => {
	const text = "preis = 9.99\npreis * 2\nsumme = 2.500\nsumme * 2";

	test("both passes refuse the dot decimal and agree line for line", () => {
		const batch = lines(newTrackedEngine({ locale: "de" }).parseDocument(text));
		const incremental = lines(evaluateDocument(newTrackedEngine({ locale: "de" }), text));
		expect(batch[0]).toBe(`ERROR ${refusal("9.99").replace("INVALID_NUMBER_LITERAL: ", "")}`);
		expect(batch[1]).toMatch(/^ERROR /);
		expect(batch[2]).toBe("= 2,500");
		expect(batch[3]).toBe("= 5,000");
		expect(incremental).toEqual(batch);
	});

	test("a snapshot round trip keeps the locale and so the refusal", () => {
		const engine = newTrackedEngine({ locale: "de" });
		const restored = ExpressionEngine.fromJSON(engine.toJSON(), { packages: BUILTIN_PACKAGES });
		try {
			expect(() => restored.evaluateExpression("2.5")).toThrow(/is not a number in the de locale/);
			expect(restored.evaluateExpression("2.500").toNumber()).toBe(2500);
		} finally {
			restored.clear();
		}
	});
});

describe("adversarial", () => {
	test("a prototype-named variable given a dot decimal is refused, and Object.prototype is untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const outcome = evaluateLine(`${word} = 2.5`, newTrackedEngine({ locale: "de" }));
				expect(outcome.kind).toBe("thrown");
				if (outcome.kind === "thrown") expect(outcome.code).toBe("INVALID_NUMBER_LITERAL");
			}
		});
	});

	test.each(["-2.5", "(2.5)", "max(2.5, 3)", "[2.5, 1]", "2.500 * 0.5", "12.30 Uhr"])("%s is refused wherever the literal sits", (line) => {
		expect(show(line)).toMatch(/^INVALID_NUMBER_LITERAL: "[0-9.]+" is not a number in the de locale/);
	});

	test("a fraction as long as a line may be is refused within budget, not read as one enormous integer", () => {
		// 2,000 characters is the default expression limit; past it the length
		// check refuses first, which is its own test's business.
		const line = `1.${"5".repeat(1_990)}`;
		const started = performance.now();
		expect(show(line)).toMatch(/^INVALID_NUMBER_LITERAL: /);
		expect(performance.now() - started).toBeLessThan(2_000);
	});

	test("digits from other scripts and zero-width characters are not read as a German number", () => {
		for (const line of ["٢.٥", "2​.5", "２.５"]) {
			const outcome = evaluateLine(line, newTrackedEngine({ locale: "de" }));
			expect(outcome.kind).not.toBe("crashed");
			if (outcome.kind === "value") expect(outcome.text).not.toMatch(/25/);
		}
	});

	test("zero and a three-zero group are still read", () => {
		expect(show("0")).toBe("= 0");
		expect(show("0.000")).toBe("= 0");
		expect(show("1.000.000")).toBe("= 1,000,000");
	});
});
