import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import type { Token } from "@solve-js/lexer/Token";
import { spreadOperatorBefore } from "@solve-js/normalizer/ValuePosition";
import { isCalendarLength, readCompoundQuantity } from "@solve-js/uom/CompoundQuantity";
import { compoundQuantityNormalizerRule } from "@solve-js/packages/uom/normalizer/CompoundQuantityNormalizerRule";
import { compoundDateOffsetNormalizerRule, connectorAt, dateOffsetNormalizerRule, DATE_OFFSET_PART_TYPE } from "@solve-js/packages/datetime/normalizer/DateOffsetNormalizerRule";

/**
 * Found bug: `2026-01-31 + 1 month 1 day` answered March 3, where
 * `2026-01-31 + 1 month + 1 day` answers March 1. A length written in several
 * units was summed into its smallest unit before it reached the date, at the
 * unit table's 30-day month, so the month was 30 days rather than a step of the
 * month field (January 31 to February 28, clamped), and the date moved 31 days.
 * `1 month 1 day after 2026-01-31` had the same fault, and `1 day 2 hours`
 * across a change of clocks was 26 elapsed hours rather than a calendar day
 * and two hours.
 *
 * A length led by a day or longer is now applied a part at a time, largest
 * first, on the right of a `+` or `-` (`uom/CompoundQuantity.ts`, the spread in
 * `CompoundQuantityNormalizerRule`) and in front of `from`, `after` and `before`
 * (`compoundDateOffsetNormalizerRule`), the way an ISO 8601 duration such as
 * `P1M1D` already was. The boundary: a length in brackets or in a variable is
 * one length, summed as before, and the parts must be written largest first.
 */

/** The line's answer through `evaluateExpression`, without the leading `= `, or its refusal. */
function show(line: string, engine = newTrackedEngine()): string {
	try {
		const value = engine.evaluateExpression(line);
		return value.isError() ? `${String(value.errorCode)}: ${String(value.errorMessage)}` : engine.formatValue(value).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).name}: ${(e as Error).message}`;
	}
}

/** The line's answer through `evaluateLine`, the single-expression host path. */
function showLine(line: string): string {
	const engine = newTrackedEngine();
	const value = engine.evaluateLine(1, line);
	return value.isError() ? `${String(value.errorCode)}: ${String(value.errorMessage)}` : engine.formatValue(value).replace(/^=\s*/, "");
}

/** The lexer's tokens for a line, without the end marker. */
function tokensOf(line: string): Token[] {
	const lexer = new ExpressionLexer();
	lexer.reset(line);
	return lexer.tokenizeAll().filter((t) => t.type !== "EOF");
}

/** What a rule leaves in place of the tokens at `pos`, as `consumed: TYPE(value) ...`, or null when it declines. */
function ruleAt(rule: { match: (tokens: Token[], pos: number, env: object) => { consumed: number; replacement: Token[] } | null }, line: string, pos: number): string | null {
	const match = rule.match(tokensOf(line), pos, {});
	return match === null ? null : `${match.consumed}: ${match.replacement.map((t) => `${t.type}(${t.value})`).join(" ")}`;
}

/** The index of the first token whose text is `text`. */
function indexOf(line: string, text: string): number {
	return tokensOf(line).findIndex((t) => t.text === text);
}

describe("the lines that exposed it", () => {
	test.each([
		["2026-01-31 + 1 month 1 day", "Sunday, March 1, 2026"],
		["2024-01-31 + 1 month 1 day", "Friday, March 1, 2024"],
		["2026-03-31 - 1 month 1 day", "Friday, February 27, 2026"],
		["2024-02-29 + 1 year 1 day", "Saturday, March 1, 2025"],
		["2024-02-29 - 1 year 1 day", "Monday, February 27, 2023"],
		["2026-01-31 + 1 year 1 month 1 day", "Monday, March 1, 2027"],
		["2026-05-31 + 1 month 1 week", "Tuesday, July 7, 2026"],
		["2026-01-31 + 1 decade 1 month", "Friday, February 29, 2036"],
		["31/01/2026 + 1 month 1 day", "Sunday, March 1, 2026"],
		["31 January 2026 + 1 month 1 day", "Sunday, March 1, 2026"],
		["2026-01-31 + 1mo 1d", "Sunday, March 1, 2026"],
		["1 month 1 day after 2026-01-31", "Sunday, March 1, 2026"],
		["1 month 1 day from 2026-01-31", "Sunday, March 1, 2026"],
		["1 month 1 day before 2026-03-31", "Friday, February 27, 2026"],
		["1 year 1 month 1 day after 2024-01-31", "Saturday, March 1, 2025"],
	])("%s is %s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("the compound form agrees with the chained form on every month end of a leap and a common year", () => {
		for (const year of [2024, 2026]) {
			for (let month = 1; month <= 12; month++) {
				const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
				const date = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
				for (const [compound, chained] of [
					["1 month 1 day", "1 month + 1 day"],
					["2 months 3 days", "2 months + 3 days"],
					["1 year 1 month 1 day", "1 year + 1 month + 1 day"],
					["1 month 2 weeks", "1 month + 2 weeks"],
				]) {
					expect({ date, plus: show(`${date} + ${compound}`) }).toEqual({ date, plus: show(`${date} + ${chained}`) });
					expect({ date, minus: show(`${date} - ${compound}`) }).toEqual({ date, minus: show(`${date} - ${chained.replace(/\+/g, "-")}`) });
					expect({ date, after: show(`${compound} after ${date}`) }).toEqual({ date, after: show(`${date} + ${chained}`) });
				}
			}
		}
	});

	test("a length on its own, and between two lengths, is the sum it always was", () => {
		expect(show("1 month 1 day")).toBe("31 days");
		expect(show("1 month 1 day in days")).toBe("31 days");
		expect(show("5 days + 1 week 2 days")).toBe("14 days");
		expect(show("10 days - 1 week 2 days")).toBe("1 day");
		expect(show("5 hours + 1 day 2 hours")).toBe("31 hours");
		expect(show("3h 5m 10s")).toBe("11,110.00 s");
	});

	test("the three entry points give one answer", () => {
		const lines = ["2026-01-31 + 1 month 1 day", "2026-03-31 - 1 month 1 day", "1 month 1 day after 2026-01-31", "2024-02-29 + 1 year 1 day"];
		const single = lines.map(showLine);
		expect(single).toEqual(["Sunday, March 1, 2026", "Friday, February 27, 2026", "Sunday, March 1, 2026", "Saturday, March 1, 2025"]);
		const { batch, incremental } = expectHonestDocument(lines.join("\n"));
		expect(batch).toEqual(single.map((s) => `= ${s}`));
		expect(incremental).toEqual(batch);
	});
});

describe("a day across a change of clocks is a calendar day, then the hours", () => {
	test("London springs forward on 31 March 2024: a day and two hours from noon is 2pm", () => {
		const london = newTrackedEngine({ calendar: dateCalendarInZone("Europe/London") });
		expect(show("2024-03-30 12:00 + 1 day 2 hours", london)).toBe("Sunday, March 31, 2024, 2:00:00 PM");
		expect(show("2024-03-30 12:00 + 1 day 2 hours", london)).toBe(show("2024-03-30 12:00 + 1 day + 2 hours", london));
		// Twenty-six elapsed hours is still the other answer, and is still how it is written.
		expect(show("2024-03-30 12:00 + 26 hours", london)).toBe("Sunday, March 31, 2024, 3:00:00 PM");
	});

	test("New York falls back on 3 November 2024, on every host zone", () => {
		for (const zone of ["UTC", "Europe/London", "America/New_York", "Pacific/Auckland"]) {
			const engine = newTrackedEngine({ calendar: dateCalendarInZone(zone) });
			expect({ zone, answer: show("2024-11-02 12:00 in New York + 1 day 2 hours", engine) }).toEqual({ zone, answer: "Sunday, November 3, 2024, 2:00:00 PM" });
		}
	});

	test("both document passes agree in a zone with a change of clocks", () => {
		const calendar = dateCalendarInZone("Europe/London");
		const doc = "start = 2024-03-30 12:00\nstart + 1 day 2 hours\n1 day 2 hours after start";
		const engine = newTrackedEngine({ calendar });
		const batch = engine.parseDocument(doc).lines.map((l) => (l.result ? formatValue(l.result, { calendar }) : String(l.error)));
		const incremental = evaluateDocument(newTrackedEngine({ calendar }), doc).lines.map((l) => (l.result ? formatValue(l.result, { calendar }) : String(l.error)));
		expect(batch.slice(1)).toEqual(["= Sunday, March 31, 2024, 2:00:00 PM", "= Sunday, March 31, 2024, 2:00:00 PM"]);
		expect(incremental).toEqual(batch);
	});
});

describe("readCompoundQuantity", () => {
	test("ordinary: the parts in the order written, with their ratios", () => {
		const reading = readCompoundQuantity(tokensOf("1 month 1 day"), 0)!;
		expect(reading.parts.map((p) => [p.amount, p.spelling, p.ratio])).toEqual([["1", "month", 2_592_000], ["1", "day", 86_400]]);
		expect(reading.consumed).toBe(4);
		expect(readCompoundQuantity(tokensOf("3h 5m 10s"), 0)!.parts.map((p) => p.spelling)).toEqual(["h", "minutes", "s"]);
	});

	test("boundary: one part, rising units, mixed measures and a signed part are not compound", () => {
		expect(readCompoundQuantity(tokensOf("1 month"), 0)).toBeNull();
		expect(readCompoundQuantity(tokensOf("1 day 1 month"), 0)).toBeNull();
		expect(readCompoundQuantity(tokensOf("1 day 1 day"), 0)).toBeNull();
		expect(readCompoundQuantity(tokensOf("3 hours 5 metres"), 0)).toBeNull();
		expect(readCompoundQuantity(tokensOf("3 hours -5 minutes"), 0)).toBeNull();
		expect(readCompoundQuantity(tokensOf("0 months 0 days"), 0)!.consumed).toBe(4);
		// It stops at the first part that breaks the run, and reads what came before.
		expect(readCompoundQuantity(tokensOf("1 year 2 months 5 years"), 0)!.consumed).toBe(4);
	});

	test("hostile: a start that is not a number, a prototype word after a number, and the end of the line", () => {
		expect(readCompoundQuantity(tokensOf("month 1 day"), 0)).toBeNull();
		expect(readCompoundQuantity(tokensOf("0x10 months 1 day"), 0)).toBeNull();
		expect(readCompoundQuantity(tokensOf("1e3 months 1 day"), 0)).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(readCompoundQuantity(tokensOf(`1 month 1 ${word}`), 0)).toBeNull();
		expect(readCompoundQuantity([], 0)).toBeNull();
		expect(readCompoundQuantity(tokensOf("1 month 1 day"), 99)).toBeNull();
	});
});

describe("isCalendarLength", () => {
	test("ordinary and boundary: led by a day or longer, of time", () => {
		expect(isCalendarLength(readCompoundQuantity(tokensOf("1 month 1 day"), 0)!)).toBe(true);
		expect(isCalendarLength(readCompoundQuantity(tokensOf("1 day 2 hours"), 0)!)).toBe(true);
		expect(isCalendarLength(readCompoundQuantity(tokensOf("1 week 1 day"), 0)!)).toBe(true);
		expect(isCalendarLength(readCompoundQuantity(tokensOf("23 hours 59 minutes"), 0)!)).toBe(false);
		expect(isCalendarLength(readCompoundQuantity(tokensOf("1 hour 30 minutes"), 0)!)).toBe(false);
	});

	test("hostile: a length of another measure is never a calendar length", () => {
		expect(isCalendarLength(readCompoundQuantity(tokensOf("5 km 30 m"), 0)!)).toBe(false);
		expect(isCalendarLength(readCompoundQuantity(tokensOf("1 kg 500 g"), 0)!)).toBe(false);
	});
});

describe("spreadOperatorBefore", () => {
	test("ordinary: the binary plus or minus before the length, with nothing tighter after", () => {
		const plus = "d + 1 month 1 day";
		expect(spreadOperatorBefore(tokensOf(plus), indexOf(plus, "1"), 4)?.type).toBe("PLUS");
		const minus = "d - 1 month 1 day + 2";
		expect(spreadOperatorBefore(tokensOf(minus), indexOf(minus, "1"), 4)?.type).toBe("MINUS");
		const bracket = "(d + 1 month 1 day)";
		expect(spreadOperatorBefore(tokensOf(bracket), indexOf(bracket, "1"), 4)?.type).toBe("PLUS");
	});

	test("boundary: a unary minus, the start of the line, and a tighter operator after", () => {
		expect(spreadOperatorBefore(tokensOf("1 month 1 day"), 0, 4)).toBeNull();
		expect(spreadOperatorBefore(tokensOf("-1 month 1 day"), 1, 4)).toBeNull();
		const times = "2 * -1 month 1 day";
		expect(spreadOperatorBefore(tokensOf(times), indexOf(times, "1"), 4)).toBeNull();
		const scaled = "d + 1 month 1 day * 2";
		expect(spreadOperatorBefore(tokensOf(scaled), indexOf(scaled, "1"), 4)).toBeNull();
		const converted = "d + 1 month 1 day in days";
		expect(spreadOperatorBefore(tokensOf(converted), indexOf(converted, "1"), 4)).toBeNull();
	});

	test("hostile: positions off either end of the line", () => {
		expect(spreadOperatorBefore([], 0, 4)).toBeNull();
		expect(spreadOperatorBefore(tokensOf("+"), 1, 4)).toBeNull();
		expect(spreadOperatorBefore(tokensOf("d +"), 2, 0)?.type).toBe("PLUS");
	});
});

describe("compoundQuantityNormalizerRule", () => {
	test("ordinary: a calendar length after a binary plus or minus is spread, largest first", () => {
		const line = "d + 1 month 1 day";
		expect(ruleAt(compoundQuantityNormalizerRule(), line, indexOf(line, "1"))).toBe("4: NUMBER(1) UNIT(month) PLUS(+) NUMBER(1) UNIT(day)");
		const back = "d - 1 year 2 months 3 days";
		expect(ruleAt(compoundQuantityNormalizerRule(), back, indexOf(back, "1"))).toBe("6: NUMBER(1) UNIT(year) MINUS(-) NUMBER(2) UNIT(months) MINUS(-) NUMBER(3) UNIT(days)");
	});

	test("boundary: a fixed length, or one with no sum before it, is summed into its smallest unit", () => {
		const fixed = "d + 1 hour 30 minutes";
		expect(ruleAt(compoundQuantityNormalizerRule(), fixed, indexOf(fixed, "1"))).toBe("4: NUMBER(90) UNIT(minutes)");
		expect(ruleAt(compoundQuantityNormalizerRule(), "1 month 1 day", 0)).toBe("4: NUMBER(31) UNIT(day)");
		const scaled = "d + 1 month 1 day * 2";
		expect(ruleAt(compoundQuantityNormalizerRule(), scaled, indexOf(scaled, "1"))).toBe("4: NUMBER(31) UNIT(day)");
		expect(ruleAt(compoundQuantityNormalizerRule(), "1 month", 0)).toBeNull();
	});

	test("hostile: the corrected minute spelling survives the spread, and prototype words decline", () => {
		const line = "d + 1d 2h 5m";
		expect(ruleAt(compoundQuantityNormalizerRule(), line, indexOf(line, "1"))).toBe("6: NUMBER(1) UNIT(d) PLUS(+) NUMBER(2) UNIT(h) PLUS(+) NUMBER(5) UNIT(minutes)");
		for (const word of PROTOTYPE_WORDS) expect(ruleAt(compoundQuantityNormalizerRule(), `d + 1 ${word} 1 day`, 2)).toBeNull();
	});
});

describe("connectorAt and compoundDateOffsetNormalizerRule", () => {
	test("connectorAt: the three words, and nothing a plain lookup would have inherited", () => {
		const [from, after, before] = [tokensOf("from")[0], tokensOf("after")[0], tokensOf("before")[0]];
		expect([connectorAt(from), connectorAt(after), connectorAt(before)]).toEqual(["DATE_OFFSET_AFTER", "DATE_OFFSET_AFTER", "DATE_OFFSET_BEFORE"]);
		expect(connectorAt(undefined)).toBeUndefined();
		expect(connectorAt(tokensOf("to")[0])).toBeUndefined();
		for (const word of PROTOTYPE_WORDS) expect(connectorAt(tokensOf(word)[0])).toBeUndefined();
	});

	test("ordinary: the first part becomes the offset, each further part a part token", () => {
		expect(ruleAt(compoundDateOffsetNormalizerRule(), "1 month 1 day after d", 0)).toBe(`5: NUMBER(1) DATE_OFFSET_AFTER(month) ${DATE_OFFSET_PART_TYPE}(1 day)`);
		expect(ruleAt(compoundDateOffsetNormalizerRule(), "1 year 2 months 3 days before d", 0)).toBe(`7: NUMBER(1) DATE_OFFSET_BEFORE(year) ${DATE_OFFSET_PART_TYPE}(2 months) ${DATE_OFFSET_PART_TYPE}(3 days)`);
	});

	test("boundary: nothing after the connector, a fixed length, and no connector are declined", () => {
		expect(ruleAt(compoundDateOffsetNormalizerRule(), "1 month 1 day after", 0)).toBeNull();
		expect(ruleAt(compoundDateOffsetNormalizerRule(), "1 hour 30 minutes from d", 0)).toBeNull();
		expect(ruleAt(compoundDateOffsetNormalizerRule(), "1 month 1 day to d", 0)).toBeNull();
		expect(ruleAt(compoundDateOffsetNormalizerRule(), "1 month after d", 0)).toBeNull();
	});

	test("hostile: a prototype word where the connector goes is declined by both offset rules", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(ruleAt(compoundDateOffsetNormalizerRule(), `1 month 1 day ${word} 3`, 0)).toBeNull();
			expect(ruleAt(dateOffsetNormalizerRule(), `5 days ${word} 3`, 1)).toBeNull();
		}
	});
});

describe("the boundary", () => {
	test("a length in brackets or in a variable is one length, summed as before", () => {
		expect(show("2026-01-31 + (1 month 1 day)")).toBe("Tuesday, March 3, 2026");
		const { batch } = expectHonestDocument("span = 1 month 1 day\n2026-01-31 + span");
		expect(batch).toEqual(["= 31 days", "= Tuesday, March 3, 2026"]);
	});

	test("a length scaled or converted before it is added is the sum, scaled or converted", () => {
		expect(show("2026-01-31 + 2 months 1 day * 2")).toBe("Tuesday, June 2, 2026");
		expect(show("2026-01-31 + 1 month 1 day in days")).toBe("Tuesday, March 3, 2026");
	});

	test("the parts are written largest first; smallest first is refused, not reordered", () => {
		expect(show("2026-01-31 + 1 day 1 month")).toMatch(/^THROWS EngineError: /);
	});
});

describe("adversarial", () => {
	test("security: prototype words as the date's name and as the connector, markup beside the length, long chains", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch } = expectHonestDocument(`${word} = 2026-01-31\n${word} + 1 month 1 day\n1 month 1 day after ${word}\n5 days ${word} 3`);
				expect(batch.slice(1, 3)).toEqual(["= Sunday, March 1, 2026", "= Sunday, March 1, 2026"]);
				expect(batch[3]).toMatch(/^ERROR /);
			}
		});
		// The connector lookup used to hand `constructor` the inherited Object function as a token type.
		expect(show("5 days constructor 3")).toMatch(/^THROWS EngineError: /);
		expect(show("5 days __proto__ 3")).toMatch(/^THROWS EngineError: /);
		for (const line of fill("2026-01-31 + 1 month 1 day + X", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
		for (const line of fill("X + 1 month 1 day", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
		expectHonestLine(`2026-01-31 ${Array.from({ length: 2_000 }, () => "+ 1 month 1 day").join(" ")}`, { budgetMs: 10_000 });
		expectHonestLine(`2026-01-31 + ${Array.from({ length: 1_000 }, (_, i) => `1 ${["year", "month", "week", "day", "hour", "minute", "second"][i % 7]}`).join(" ")}`, { budgetMs: 10_000 });
		expectHonestDocument(RESOURCE_PROBES.manyLines(1_000, "2026-01-31 + 1 month 1 day"), { budgetMs: 20_000 });
	});

	test("realistic: a date on the line above, a check, a what-if, a total and a tag, through both passes", () => {
		const { batch, incremental } = expectHonestDocument(
			"start = 31/01/2026\ndue = start + 1 month 1 day\ncheck due == start + 1 month + 1 day\nline 2 with start = 31/03/2026\n1 month 1 day before due\ndue - start",
		);
		expect(batch.slice(1)).toEqual(["= Sunday, March 1, 2026", "= ✓", "= Friday, May 1, 2026", "= Saturday, January 31, 2026", "= 29 days"]);
		expect(incremental).toEqual(batch);
		expect(show("2026-01-31 + 1 month 1 day > 2026-02-28")).toBe("true");
		expect(show("2026-01-31 + 1 month 1 day + 1 week")).toBe("Sunday, March 8, 2026");
		expect(show("2024-01-31 12:00 in Tokyo + 1 month 1 day")).toBe("Friday, March 1, 2024, 12:00:00 PM");
		// A typo in the unit is an honest refusal, not a sum.
		expectHonestLine("2026-01-31 + 1 mnth 1 day");
	});

	test("edge: zero parts, leap days, year ends, and day counts past 2^53", () => {
		expect(show("2026-01-31 + 0 months 0 days")).toBe("Saturday, January 31, 2026");
		expect(show("2026-12-31 + 1 month 1 day")).toBe("Monday, February 1, 2027");
		expect(show("2024-02-29 + 4 years 1 day")).toBe("Wednesday, March 1, 2028");
		expect(show("2023-01-29 + 1 month 1 day")).toBe("Wednesday, March 1, 2023");
		expect(show("2026-01-31 + 0.5 months 1 day")).toMatch(/^(?!THROWS)/);
		for (const line of fill("2026-01-31 + 1 month 1 day + X days", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		for (const line of fill("2026-01-31 + 1 month 1 day * X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		expectHonestLine("2026-01-31 + 9007199254740992 months 1 day");
		expectHonestLine("2026-01-31 + 1 month 9007199254740993 days");
		expectHonestDocument("2026-01-31 + 1 month 1 day\r\n2026-03-31 - 1 month 1 day\r\n");
	});

	// A date pushed past the calendar's range showed `Invalid Date`, as a
	// single-unit length did (`2026-01-31 + 9007199254740992 days`); #832
	// refuses such a date where it is made, with DATE_OUT_OF_RANGE.
	test("a compound length that pushes a date past the calendar's range is refused by name (#832)", () => {
		expect(show("2026-01-31 + 9007199254740992 months 1 day")).toMatch(/^DATE_OUT_OF_RANGE: /);
	});
});
