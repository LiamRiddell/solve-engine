import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { RecordingCalendar } from "@tools/recordingCalendar";
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
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import {
	Value,
	bigIntValue,
	boolValue,
	datetimeValue,
	errorValue,
	hexValue,
	matrixValue,
	numberValue,
	pendingValue,
	percentageValue,
	rangeValue,
	stringValue,
	uomValue,
} from "@solve-js/vm/Value";
import { inflationYear, isYear } from "@solve-js/packages/finance/data/InflationAmount";
import {
	inflationFromYearToPresentHandler,
	inflationToYearFromPresentHandler,
	inflationToYearInCurrencyHandler,
} from "@solve-js/packages/finance/parselets/InflationPluginFunctions";
import { parseInflationYear, worthInRefusal } from "@solve-js/packages/finance/parselets/InflationQueryParselet";

/**
 * Found bug: `what is $100 from 1990 + $5` answered `$217.31`, the figure for
 * 1995. The year after `from` was read to the end of the line, so the `+ $5`
 * joined the year, and the year's number was then taken whatever it was:
 * money added to a year, `$1990` and `1990 kg` read as 1990, and `1990.5`
 * looked up as 1990, each answered with a confident figure.
 *
 * Two changes. The year is one factor, as the target of a conversion `in` is
 * one term, so an operator after it is the line's: `what is $100 from 1990 +
 * $5` is the answer plus $5, as `$100 in 1990 dollars + $5` and `5 km in m +
 * 3 m` are. And a year that is not a plain whole number is refused by name,
 * `INFLATION_EXPECTED_YEAR`, in every inflation form.
 */

const NOW_2026 = Date.UTC(2026, 2, 11, 12, 0, 0);

/** An engine whose clock reads March 2026, so a `from` form's present year is fixed. */
function engine2026(): ReturnType<typeof newTrackedEngine> {
	return newTrackedEngine({ calendar: new RecordingCalendar(NOW_2026, dateCalendarInZone("UTC")) });
}

/** One line through evaluateLine, as the reader sees it. */
function shown(line: string): string {
	const outcome = evaluateLine(line, engine2026());
	if (outcome.kind === "value") return outcome.text.replace(/^=\s*/, "");
	if (outcome.kind === "crashed") return `CRASHED ${outcome.name}`;
	return `ERROR ${outcome.code}: ${outcome.message}`;
}

/** The code a line answers with, or "value" when it answers. */
function codeOf(line: string): string {
	const outcome = evaluateLine(line, engine2026());
	return outcome.kind === "value" ? "value" : outcome.kind === "crashed" ? `CRASHED ${outcome.name}` : outcome.code;
}

/** Both document passes on the 2026 clock, each line as the reader sees it. */
function both(text: string): { batch: string[]; incremental: string[] } {
	const lines = (result: ReturnType<ReturnType<typeof newTrackedEngine>["parseDocument"]>): string[] =>
		result.lines.map((l) => {
			if (l.result == null) return l.error ? `ERROR ${l.error}` : "";
			if (l.result.isError()) return `ERROR ${String(l.result.errorCode)}`;
			return formatValue(l.result).replace(/^=\s*/, "");
		});
	return { batch: lines(engine2026().parseDocument(text)), incremental: lines(evaluateDocument(engine2026(), text)) };
}

/** The lexer's tokens for a line, without spaces. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
}

/** parseInflationYear on a bare parser: the operators it emitted and where it stopped. */
function yearOf(source: string): { ops: number[]; next: string | undefined } | string {
	const parser = new PrecedenceParser(new ParseletRegistry(), 50, "en");
	parser.load(lex(source), false);
	const builder = new BytecodeBuilder(new Map());
	parser.setBuilder(builder);
	try {
		parseInflationYear(parser, builder);
	} catch (e) {
		return e instanceof EngineError ? `refused ${e.code}` : `crashed ${(e as Error).constructor.name}`;
	}
	const wanted: number[] = [OpCode.ADD, OpCode.SUB, OpCode.MUL, OpCode.DIV, OpCode.EXP];
	const ops = Array.from(builder.build().opcodes).filter((op) => wanted.indexOf(op) >= 0);
	return { ops, next: parser.peek()?.type };
}

/** The code of a refusal Value, or the year read. */
function yearCode(value: Value | undefined): number | string {
	const year = inflationYear(value);
	return isYear(year) ? year : String(year.errorCode);
}

describe("the line that exposed it", () => {
	test("money after the year is added to the answer, never to the year, through every entry point", () => {
		expect(shown("what is $100 from 1990")).toBe("$253.39");
		expect(shown("what is $100 from 1990 + $5")).toBe("$258.39");
		expect(shown("what is $100 from 1990 + $5")).toBe(shown("(what is $100 from 1990) + $5"));
		expect(shown("what is $100 from 1990 + $5")).not.toBe(shown("what is $100 from 1995"));
		const { batch, incremental } = both("what is $100 from 1990 + $5\n(what is $100 from 1990) + $5\nwhat is $100 from 1995");
		expect(batch).toEqual(["$258.39", "$258.39", "$217.31"]);
		expect(incremental).toEqual(batch);
	});

	test("the other forms bind the same way: what was, both named years, and in <year> dollars", () => {
		expect(shown("what was $100 worth in 1990 + $5")).toBe("$44.46");
		expect(shown("$100 in 1990 dollars + $5")).toBe("$44.46");
		expect(shown("what is $100 in 1990 worth in 2010 + $5")).toBe("$171.84");
		expect(shown("what is $100 in 1990 worth in 2010")).toBe("$166.84");
	});

	test("the decisions the found bug asked for", () => {
		// A bare number after the year is the line's too: the answer plus 5.
		expect(shown("what is $100 from 1990 + 5")).toBe("$258.39");
		// A year worked out goes in brackets.
		expect(shown("what is $100 from (1990 + 5)")).toBe(shown("what is $100 from 1995"));
		expect(shown("what is $100 in (1990 + 5) worth in 2010")).toBe("$143.08");
		// A fraction is not a year.
		expect(shown("what is $100 from 1990.5")).toBe("ERROR INFLATION_EXPECTED_YEAR: the year of an inflation question is a plain whole number, such as 1990, and 1990.5 is not a whole number");
		// A whole number outside the index is a year the index does not hold.
		expect(codeOf("what is $100 from -1990")).toBe("INFLATION_YEAR_OUT_OF_RANGE");
		expect(codeOf("what is $100 from 1e9")).toBe("INFLATION_YEAR_OUT_OF_RANGE");
		// A year from the line above.
		const { batch, incremental } = both("year = 1990\nwhat is $100 from year\nwhat is $100 from year + $5");
		expect(batch).toEqual(["1,990", "$253.39", "$258.39"]);
		expect(incremental).toEqual(batch);
	});

	test("a year that is money, a quantity, a date or text is refused by name in every form", () => {
		for (const line of [
			"what is $100 from $1990",
			"what is $100 from 1990 kg",
			"what is $100 from today",
			"what is $100 from \"1990\"",
			"what is $100 from 1990%",
			"what was $100 worth in 1990.5",
			"what was $100 worth in £1990",
			"what is $100 in 1990.5 worth in 2010",
			"what is $100 in 1990 worth in 2010 m",
			"$100 in 1990.5 dollars",
			"inflationAdjust($100, 1990.5, 2010)",
			"inflationAdjust($100, 1990, $2010)",
		]) {
			expect({ line, code: codeOf(line) }).toEqual({ line, code: "INFLATION_EXPECTED_YEAR" });
		}
		expect(shown("what is $100 from $1990")).toMatch(/and this one is money$/);
		expect(shown("what is $100 from 1990 kg")).toMatch(/and this one is a mass$/);
	});

	test("a sum written as the first of two years is refused in plain words, pointing at the brackets", () => {
		const line = shown("what is $100 in 1990 + 5 worth in 2010");
		expect(line).toMatch(/^ERROR INFLATION_EXPECTED_FROM_OR_IN: /);
		expect(line).toContain("(1990 + 5)");
		expect(line).not.toMatch(/Expected|WORTH_IN/);
	});

	test("what was right stays right", () => {
		expect(shown("what is $100 from 1990")).toBe("$253.39");
		expect(shown("what was $500 worth in 1965")).toBe("$47.56");
		expect(shown("what is $500 in 1990 worth in 2010")).toBe("$834.19");
		expect(shown("inflationAdjust($100, 1990, 2020)")).toBe("$198.02");
		expect(shown("$100 in 1965 dollars")).toBe("$9.51");
		expect(shown("what is $300 + $50 from 2003")).toBe(shown("what is $350 from 2003"));
		expect(shown("what is $100 from 0x7C6")).toBe("$253.39");
	});
});

// ── The parts ─────────────────────────────────────────────────────────────

describe("inflationYear", () => {
	test("ordinary: a plain whole number, in any of the number types", () => {
		expect(yearCode(numberValue(1990))).toBe(1990);
		expect(yearCode(hexValue(1990))).toBe(1990);
		expect(yearCode(bigIntValue(BigInt(1990)))).toBe(1990);
		expect(yearCode(numberValue(-1990))).toBe(-1990);
	});

	test("boundary: negative zero is the year 0, and a huge whole number is still a year for the index to refuse", () => {
		expect(Object.is(inflationYear(numberValue(-0)), 0)).toBe(true);
		expect(yearCode(numberValue(2 ** 53))).toBe(2 ** 53);
		expect(yearCode(numberValue(1e308))).toBe(1e308);
		expect(yearCode(numberValue(1990.0000001))).toBe("INFLATION_EXPECTED_YEAR");
		expect(yearCode(numberValue(Number.MIN_VALUE))).toBe("INFLATION_EXPECTED_YEAR");
	});

	test("hostile: nothing, no finite number, and every value that is not a number", () => {
		expect(yearCode(undefined)).toBe("INFLATION_EXPECTED_YEAR");
		for (const n of [Infinity, -Infinity, NaN]) {
			const refused = inflationYear(numberValue(n));
			expect(isYear(refused) ? refused : refused.errorMessage).toMatch(/not a finite number$/);
		}
		const notYears: Array<[Value, string]> = [
			[uomValue(1990, "USD"), "money"],
			[uomValue(1990, "kg"), "a mass"],
			[percentageValue(19.9), "a percentage"],
			[datetimeValue(NOW_2026), "a date or time"],
			[stringValue("1990"), "text"],
			[boolValue(true), "true or false"],
			[matrixValue(1, 1, [1990]), "a list"],
			[rangeValue(1990, 1995), "a range"],
		];
		for (const [value, what] of notYears) {
			const refused = inflationYear(value);
			expect(isYear(refused)).toBe(false);
			expect(isYear(refused) ? "" : refused.errorCode).toBe("INFLATION_EXPECTED_YEAR");
			expect(isYear(refused) ? "" : String(refused.errorMessage)).toContain(`this one is ${what}`);
		}
	});

	test("a fault or a pending value is handed back as it is", () => {
		const fault = errorValue("SOMETHING_ELSE", "an earlier failure");
		expect(inflationYear(fault)).toBe(fault);
		const pending = pendingValue("q");
		expect(inflationYear(pending)).toBe(pending);
	});
});

describe("the handlers refuse a year that is not one", () => {
	test("from, to and in <year> <currency>, after the amount's own check", () => {
		expect(inflationFromYearToPresentHandler([uomValue(100, "USD"), uomValue(1990, "USD")]).errorCode).toBe("INFLATION_EXPECTED_YEAR");
		expect(inflationToYearFromPresentHandler([uomValue(100, "USD"), numberValue(1990.5)]).errorCode).toBe("INFLATION_EXPECTED_YEAR");
		expect(inflationToYearInCurrencyHandler([uomValue(100, "USD"), numberValue(1990.5), stringValue("USD")]).errorCode).toBe("INFLATION_EXPECTED_YEAR");
		// The amount is judged first, so a yen amount with a bad year names the yen.
		expect(inflationFromYearToPresentHandler([uomValue(100, "JPY"), numberValue(1990.5)]).errorCode).toBe("INFLATION_NO_INDEX");
		// A year that is a fault carries the fault.
		const fault = errorValue("UNDEFINED_VARIABLE", "Undefined variable: y");
		expect(inflationFromYearToPresentHandler([uomValue(100, "USD"), fault])).toBe(fault);
	});
});

describe("parseInflationYear", () => {
	test("ordinary: a number and a bracketed sum (a name is read by the engine's own parselets, above)", () => {
		expect(yearOf("1990")).toEqual({ ops: [], next: undefined });
		expect(yearOf("-1990")).toEqual({ ops: [], next: undefined });
		expect(yearOf("(1990 + 5)")).toEqual({ ops: [OpCode.ADD], next: undefined });
	});

	test("boundary: it stops before +, -, *, / and in, and reads a power as part of the year", () => {
		expect(yearOf("1990 + 5")).toEqual({ ops: [], next: "PLUS" });
		expect(yearOf("1990 - 5")).toEqual({ ops: [], next: "MINUS" });
		expect(yearOf("1990 * 2")).toEqual({ ops: [], next: "STAR" });
		expect(yearOf("1990 / 2")).toEqual({ ops: [], next: "SLASH" });
		expect(yearOf("1990 in 2010")).toEqual({ ops: [], next: "IN" });
		expect(yearOf("2^11")).toEqual({ ops: [OpCode.EXP], next: undefined });
	});

	test("hostile: nothing to read is refused by the parser, never a crash; deep brackets stay within the limit", () => {
		expect(yearOf("")).toMatch(/^refused /);
		expect(yearOf("+")).toMatch(/^refused /);
		expect(String(yearOf(RESOURCE_PROBES.deepParens(40)))).not.toMatch(/^crashed/);
		expect(String(yearOf(RESOURCE_PROBES.deepParens(5_000)))).not.toMatch(/^crashed/);
	});
});

describe("worthInRefusal", () => {
	test("names what came after the first year, or the end of the line, and points at the brackets", () => {
		const plus = lex("+")[0];
		expect(worthInRefusal(plus)).toBe(
			"an inflation question between two years reads what is <amount> in <year> worth in <year>, and here \"+\" comes after the first year: a year is one number or name, so a year worked out goes in brackets, as in (1990 + 5)",
		);
		expect(worthInRefusal(undefined)).toContain("the line ends after the first year");
	});

	test("hostile: markup and invisible characters in the token are shown as text", () => {
		const message = worthInRefusal({ text: "<script>‮", value: "<script>‮" } as unknown as Token);
		expect(message).not.toContain("‮");
		expect(message).toContain("comes after the first year");
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words as the year, sized years, look-alike digits and markup text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`what is $100 from ${word}`);
				expectHonestLine(`what is $100 from 1990 + ${word}`);
				const { batch } = expectHonestDocument(`${word} = 1990\nwhat is $100 from ${word}`);
				expect(batch[1]).not.toBe("= $217.31");
			}
		});
		expectHonestLine(`what is $100 from (${RESOURCE_PROBES.longSum(2_000)})`, { budgetMs: 5_000 });
		expectHonestLine(`what is $100 from 1990 ${"+ $1 ".repeat(2_000)}`, { budgetMs: 5_000 });
		expectHonestLine(`what is $100 from ${RESOURCE_PROBES.deepParens(500)}`, { budgetMs: 5_000 });
		expect(codeOf(`what is $100 from ${RESOURCE_PROBES.hugePower()}`)).toBe("INFLATION_EXPECTED_YEAR");
		for (const year of ["١٩٩٠", "𝟏𝟗𝟗𝟎", "1990​", "‮1990", "<b>1990</b>", "${1990}"]) expectHonestLine(`what is $100 from ${year}`);
		for (const line of fill("what is $100 from 1990 X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a typo, a check, a what-if through a name, the other entry points, CRLF", () => {
		expect(codeOf("what is $100 from 199O")).not.toBe("value");
		const { batch, incremental } = expectHonestDocument(
			"y = 1990\nprice = what is $100 from y + $5\ncheck price == (what is $100 from y) + $5\ny = $1990\nwhat is $100 from y",
		);
		expect(batch[2]).toBe("= ✓");
		expect(batch[4]).toMatch(/^ERROR /);
		expect(incremental).toEqual(batch);
		const crlf = both("what is $100 from 1990 + $5\r\nwhat is $100 from 1990.5\r\n");
		expect(crlf.batch.slice(0, 2)).toEqual(["$258.39", "ERROR INFLATION_EXPECTED_YEAR"]);
		expect(crlf.incremental).toEqual(crlf.batch);
	});

	test("edge: the numeric edges as each year, never a figure for a year that is not one", () => {
		for (const line of fill("what is $100 from X", NUMERIC_EDGES)) expectHonestLine(line, { engine: engine2026(), allowNaN: true });
		for (const line of fill("what was $100 worth in X", NUMERIC_EDGES)) expectHonestLine(line, { engine: engine2026(), allowNaN: true });
		for (const line of fill("inflationAdjust($100, 1990, X)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		// 0/0 has no answer of its own, and its refusal is what the line carries.
		expect(codeOf("inflationAdjust($100, (0/0), 2010)")).toBe("QUOTIENT_UNDEFINED");
		for (const year of ["0.5", "-0.5", "1/3", "0.1 + 0.2", "1e-320", "1/0", "-1/0"]) {
			expect({ year, code: codeOf(`inflationAdjust($100, (${year}), 2010)`) }).toEqual({ year, code: "INFLATION_EXPECTED_YEAR" });
		}
		for (const year of ["0", "-0", "-1", "2^53", "1e308", "12345678901234567890123456789012345"]) {
			expect({ year, code: codeOf(`inflationAdjust($100, (${year}), 2010)`) }).toEqual({ year, code: "INFLATION_YEAR_OUT_OF_RANGE" });
		}
	});
});
