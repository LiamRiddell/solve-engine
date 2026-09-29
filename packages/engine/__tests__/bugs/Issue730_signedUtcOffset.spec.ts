import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { ValueType, datetimeValue } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import type { Token } from "@solve-js/lexer/Token";
import {
	MAX_UTC_OFFSET_MINUTES, MIN_UTC_OFFSET_MINUTES, clockTokenIsHoursMinutes, offsetRefusal,
	resolveUtcOffsetName, tryReadUtcOffset, utcOffsetMinutes, utcOffsetName, type OffsetTokenCursor,
} from "@solve-js/calendar/UtcOffset";
import { resolveZoneName } from "@solve-js/calendar/ZoneNames";
import {
	decodeFixedOffsetMinutes, encodeFixedOffset, encodeNamedOffset, isFixedOffset, isNamedOffset,
} from "@solve-js/calendar/IntlZone";
import { formatTimeInZone, zoneLabel } from "@solve-js/packages/time/timezones/ZoneMath";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

/**
 * Issue #730: after a date, `in UTC-5` read `UTC` as the zone and then
 * subtracted a bare 5 from the answer, so `3pm in UTC-5` gave 2:59:59 PM (and,
 * once a date and a bare number were refused, an error about lengths of time),
 * `UTC-05:00` became a clock time and the line a span, and `UTC-5:30` a
 * negative span of thousands of hours. The `in` target now reads the signed
 * offset the time package's conversion form already read, through one shared
 * reader, and the date is read and shown on that fixed clock as a named zone's
 * is. An offset no clock keeps is refused by name.
 *
 * Every expectation is either on a written date, or on today with the clock
 * pinned at an instant that is the same calendar day in all three zones
 * `npm run test:temporal` runs this suite in.
 */

/** 10:00 UTC on 25 September 2026: 11:00 in London, 06:00 in New York, 22:00 in Auckland, all on the 25th. */
const PINNED = "2026-09-25T10:00:00Z";

function show(line: string): string {
	try {
		const value = newTrackedEngine().evaluateLine(1, line);
		const shown = formatValue(value).replace(/^=\s*/, "");
		return value.type === ValueType.Error ? `ERROR ${String(value.value)} ${shown}` : shown;
	} catch (e) {
		return `THROWS ${String((e as { code?: string }).code)} ${(e as Error).message}`;
	}
}

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const shown = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${shown}` : shown;
	});
}

const batch = (text: string): string[] => read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
const incremental = (text: string): string[] => read(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }));

const OUT_OF_RANGE = (written: string): string =>
	`ERROR TIME_ZONE_OFFSET_OUT_OF_RANGE "${written}" is not an offset a clock keeps: write whole hours and minutes from UTC-12 to UTC+14, as in "UTC-5" or "UTC+5:45"`;

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(new Date(PINNED));
});

afterEach(() => {
	jest.useRealTimers();
});

describe("the lines in the issue", () => {
	test.each([
		["3pm in UTC-5", "3:00:00 PM"],
		["2026-04-03T15:00 in UTC-5", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in GMT-5", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in GMT+9", "Friday, April 3, 2026, 3:00:00 PM"],
		["3pm in UTC-05:00", "3:00:00 PM"],
		["2026-04-03T15:00 in UTC-5:30", "Friday, April 3, 2026, 3:00:00 PM"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("a signed offset reads as a named zone reads: the wall clock kept, on that clock", () => {
		expect(show("2026-04-03T15:00 in UTC-5")).toBe(show("2026-04-03T15:00 in Tokyo"));
		// The instant behind it is 15:00 five hours behind UTC, 20:00 UTC.
		expect(show("check 2026-04-03T15:00 in UTC-5 == 2026-04-03T20:00Z")).toBe("✓");
		expect(show("2026-04-03T15:00 in UTC-5 - 2026-04-03T20:00Z")).toBe("0:00");
	});

	test("the value carries the offset as a named zone, and is an instant", () => {
		const value = newTrackedEngine().evaluateLine(1, "2026-04-03T15:00 in UTC-5");
		expect(value.type).toBe(ValueType.Datetime);
		expect(value.zone).toBe(encodeNamedOffset(-300));
		expect(value.grain).toBe("instant");
		expect(value.toNumber()).toBe(Date.UTC(2026, 3, 3, 20, 0));
	});
});

describe("each spelling the issue lists", () => {
	test.each([
		["2026-04-03T15:00 in UTC+14", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in UTC-12", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in UTC+5:45", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in utc-5", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in gmt+9", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in UTC -5", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in UTC- 5", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in UTC - 5", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in GMT - 5", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in UTC+14:00", "Friday, April 3, 2026, 3:00:00 PM"],
		["2026-04-03T15:00 in UTC-12:00", "Friday, April 3, 2026, 3:00:00 PM"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("a date grain is that day on the offset's clock", () => {
		expect(show("2026-04-03 in UTC-5")).toBe("Friday, April 3, 2026");
		expect(show("2026-04-03 in UTC-05:00")).toBe("Friday, April 3, 2026");
		expect(newTrackedEngine().evaluateLine(1, "2026-04-03 in UTC-5").toNumber()).toBe(Date.UTC(2026, 3, 3, 5, 0));
	});

	test("an instant is moved to the offset's clock, since the moment is fixed", () => {
		expect(show("now in UTC-5")).toBe("Friday, September 25, 2026, 5:00:00 AM");
		expect(show("now in UTC+5:45")).toBe("Friday, September 25, 2026, 3:45:00 PM");
		expect(show("2026-04-03T15:00Z in UTC-5")).toBe("Friday, April 3, 2026, 10:00:00 AM");
	});

	test.each([
		["2026-04-03T15:00 in UTC+25", OUT_OF_RANGE("UTC+25")],
		["2026-04-03T15:00 in UTC-5:60", OUT_OF_RANGE("UTC-5:60")],
		["2026-04-03T15:00 in UTC+14:01", OUT_OF_RANGE("UTC+14:01")],
		["2026-04-03T15:00 in UTC-12:30", OUT_OF_RANGE("UTC-12:30")],
		["2026-04-03T15:00 in UTC+5.5", OUT_OF_RANGE("UTC+5.5")],
		["2026-04-03T15:00 in UTC+005", OUT_OF_RANGE("UTC+005")],
	])("%s is refused by name", (line, refusal) => {
		expect(show(line)).toBe(refusal);
	});

	test("a time of day after the sign is refused as not an offset", () => {
		expect(show("2026-04-03T15:00 in UTC+11am")).toBe(
			`ERROR TIME_ZONE_OFFSET_OUT_OF_RANGE "UTC+" takes an offset in hours and minutes, as in "UTC-5" or "UTC+5:45", not a time of day`,
		);
	});
});

describe("the boundary the issue names", () => {
	test("a spaced minus followed by a unit stays arithmetic", () => {
		expect(show("2026-04-03T15:00 in UTC - 5 hours")).toBe("Friday, April 3, 2026, 10:00:00 AM");
		expect(show("2026-04-03T15:00 in UTC-5 hours")).toBe("Friday, April 3, 2026, 10:00:00 AM");
		expect(show("2026-04-03T15:00 in UTC-5h")).toBe("Friday, April 3, 2026, 10:00:00 AM");
	});

	test("bare in UTC is unchanged: the zone named UTC", () => {
		expect(show("2026-04-03T15:00 in UTC")).toBe("Friday, April 3, 2026, 3:00:00 PM");
		expect(newTrackedEngine().evaluateLine(1, "2026-04-03T15:00 in UTC").zone).toBe("UTC");
	});

	test("an offset an ISO literal carried still displays in the engine's zone", () => {
		const carried = newTrackedEngine().evaluateLine(1, "2026-04-03T15:00Z");
		expect(carried.zone).toBe(encodeFixedOffset(0));
		expect(isNamedOffset(carried.zone!)).toBe(false);
	});

	test("after anything but a date, in UTC-5 asks for a unit, as in Tokyo does", () => {
		expect(show("5 in UTC-5")).toBe(`ERROR UNKNOWN_UNIT "UTC-5" is not a unit.`);
		expect(show("5 in Tokyo")).toBe(`ERROR UNKNOWN_UNIT "Tokyo" is not a unit.`);
	});

	test("the time package's forms read the same spellings and refuse the same offsets", () => {
		expect(show("3pm London in UTC-5")).toBe("9:00 AM");
		expect(show("3pm UTC+5:45 in London")).toBe("10:15 AM");
		expect(show("3pm London in UTC+14")).toBe("4:00 AM (+1 day)");
		expect(show("time in UTC+25")).toBe(
			`THROWS TIME_ZONE_OFFSET_OUT_OF_RANGE "UTC+25" is not an offset a clock keeps: write whole hours and minutes from UTC-12 to UTC+14, as in "UTC-5" or "UTC+5:45"`,
		);
		expect(show("3pm London in UTC-5:60")).toMatch(/^THROWS TIME_ZONE_OFFSET_OUT_OF_RANGE "UTC-5:60"/);
	});
});

describe("the three entry points agree", () => {
	const DOC = [
		"2026-04-03T15:00 in UTC-5",
		"2026-04-03 in GMT+9",
		"2026-04-03T15:00 in UTC+5:45",
		"2026-04-03T15:00 in UTC - 5 hours",
		"2026-04-03T15:00 in UTC+25",
	].join("\n");

	test("parseDocument and evaluateDocument answer every line alike", () => {
		expect(batch(DOC)).toEqual(incremental(DOC));
		expect(batch(DOC)).toEqual([
			"Friday, April 3, 2026, 3:00:00 PM",
			"Friday, April 3, 2026",
			"Friday, April 3, 2026, 3:00:00 PM",
			"Friday, April 3, 2026, 10:00:00 AM",
			`ERROR "UTC+25" is not an offset a clock keeps: write whole hours and minutes from UTC-12 to UTC+14, as in "UTC-5" or "UTC+5:45"`,
		]);
	});

	test("evaluateLine gives each line's answer on its own", () => {
		const lines = DOC.split("\n");
		expect(lines.map(show).map((s) => s.replace(/^ERROR TIME_ZONE_OFFSET_OUT_OF_RANGE /, "ERROR "))).toEqual(batch(DOC));
	});
});

describe("unit: utcOffsetMinutes", () => {
	test.each([
		[false, 5, 0, 300],
		[true, 5, 0, -300],
		[false, 5, 45, 345],
		[true, 12, 0, MIN_UTC_OFFSET_MINUTES],
		[false, 14, 0, MAX_UTC_OFFSET_MINUTES],
		[false, 0, 0, 0],
	])("negative %s, %i h %i min is %i", (negative, hours, minutes, expected) => {
		expect(utcOffsetMinutes(negative, hours, minutes)).toBe(expected);
	});

	test("minus zero is zero, not negative zero", () => {
		expect(Object.is(utcOffsetMinutes(true, 0, 0), 0)).toBe(true);
	});

	test.each([
		[false, 14, 1], [true, 12, 1], [false, 25, 0], [false, 5, 60], [false, -1, 0], [false, 5, -1],
		[false, 5.5, 0], [false, 5, 0.5], [false, Number.NaN, 0], [false, Number.POSITIVE_INFINITY, 0], [false, 2 ** 53, 0],
	])("negative %s, %s h %s min is refused", (negative, hours, minutes) => {
		expect(utcOffsetMinutes(negative, hours, minutes)).toBeNull();
	});
});

describe("unit: utcOffsetName", () => {
	test.each([
		[-300, "UTC-5"], [300, "UTC+5"], [345, "UTC+5:45"], [-330, "UTC-5:30"], [0, "UTC+0"], [-0, "UTC+0"], [840, "UTC+14"], [-720, "UTC-12"], [5, "UTC+0:05"],
	])("%i is %s", (minutes, name) => {
		expect(utcOffsetName(minutes)).toBe(name);
	});
});

describe("unit: resolveUtcOffsetName", () => {
	test.each([
		["UTC-5", encodeNamedOffset(-300)],
		["utc-5", encodeNamedOffset(-300)],
		["GMT+9", encodeNamedOffset(540)],
		["UTC+5:45", encodeNamedOffset(345)],
		["UTC-05:00", encodeNamedOffset(-300)],
		["UTC - 5", encodeNamedOffset(-300)],
		[" UTC+14 ", encodeNamedOffset(840)],
		["UTC-0", encodeNamedOffset(0)],
	])("%s resolves to %s", (name, zone) => {
		expect(resolveUtcOffsetName(name)).toBe(zone);
	});

	test.each([
		"UTC+25", "UTC-5:60", "UTC+5.5", "UTC+", "UTC-5:5", "UTC+005", "UTC+14:01", "UTC-12:01",
		"XTC-5", "UTC--5", "UTC-5 hours", "UTC", "Tokyo", "", "constructor-5", "__proto__", "UTC-5​", "UTC-５",
	])("%j resolves to nothing", (name) => {
		expect(resolveUtcOffsetName(name)).toBeNull();
	});

	test("resolveZoneName still owns every other name, and leaves the offset spelling alone", () => {
		expect(resolveZoneName("UTC")).toBe("UTC");
		expect(resolveZoneName("Tokyo")).toBe("Asia/Tokyo");
		expect(resolveZoneName("UTC-5")).toBeNull();
	});
});

describe("unit: offsetRefusal", () => {
	test("an offset's shape gets the range", () => {
		expect(offsetRefusal("UTC+25")).toBe(OUT_OF_RANGE("UTC+25").replace(/^ERROR TIME_ZONE_OFFSET_OUT_OF_RANGE /, ""));
		expect(offsetRefusal("gmt-99")).toMatch(/^"gmt-99" is not an offset a clock keeps/);
	});

	test("a sign with nothing kept after it gets the spelling", () => {
		expect(offsetRefusal("UTC+")).toBe(`"UTC+" takes an offset in hours and minutes, as in "UTC-5" or "UTC+5:45", not a time of day`);
	});

	test.each(["Atlantis", "UTC", "", "constructor", "<b>UTC</b>-5", "5-UTC"])("%j is not an offset's shape", (name) => {
		expect(offsetRefusal(name)).toBeNull();
	});
});

/** A cursor over hand-built tokens, the shape the parser presents to the reader. */
function cursorOver(tokens: Array<Partial<Token> & { type: string; value: string }>): OffsetTokenCursor & { position: number } {
	const list = tokens.map((t, i) => ({ typeId: 0, text: t.value, offset: t.offset ?? i * 10, lineBreaks: 0, line: 1, col: 1, ...t }) as Token);
	return {
		position: 0,
		peek() { return list[this.position]; },
		peekAt(offset: number) { return list[this.position + offset]; },
		consume() { return list[this.position++]; },
	};
}

describe("unit: tryReadUtcOffset", () => {
	const UTC = { type: "IDENT", value: "UTC" };
	const MINUS = { type: "MINUS", value: "-" };
	const PLUS = { type: "PLUS", value: "+" };

	test("sign and hours: consumes three tokens", () => {
		const cursor = cursorOver([UTC, MINUS, { type: "NUMBER", value: "5" }, { type: "IN", value: "in" }]);
		expect(tryReadUtcOffset(cursor)).toEqual({ minutes: -300, name: "UTC-5" });
		expect(cursor.position).toBe(3);
	});

	test("sign, hours, colon and minutes: consumes five tokens", () => {
		const cursor = cursorOver([UTC, PLUS, { type: "NUMBER", value: "5" }, { type: "COLON", value: ":" }, { type: "NUMBER", value: "45" }]);
		expect(tryReadUtcOffset(cursor)).toEqual({ minutes: 345, name: "UTC+5:45" });
		expect(cursor.position).toBe(5);
	});

	test("a fused clock time written as hours and minutes", () => {
		// `05:00` is five characters of source, fused into 300 minutes.
		const cursor = cursorOver([UTC, MINUS, { type: "CLOCK_TIME", value: "300", offset: 4, sourceEnd: 9 }]);
		expect(tryReadUtcOffset(cursor)).toEqual({ minutes: -300, name: "UTC-5" });
	});

	test("a number followed by a unit is arithmetic, and nothing is consumed", () => {
		const cursor = cursorOver([UTC, MINUS, { type: "NUMBER", value: "5" }, { type: "UNIT", value: "hours" }]);
		expect(tryReadUtcOffset(cursor)).toBeNull();
		expect(cursor.position).toBe(0);
	});

	test.each([
		["no sign", [UTC, { type: "NUMBER", value: "5" }]],
		["a sign and nothing", [UTC, MINUS]],
		["a sign and a word", [UTC, MINUS, { type: "IDENT", value: "five" }]],
		["nothing at all", []],
	])("%s: null, nothing consumed", (_name, tokens) => {
		const cursor = cursorOver(tokens as Array<{ type: string; value: string }>);
		expect(tryReadUtcOffset(cursor)).toBeNull();
		expect(cursor.position).toBe(0);
	});

	test.each([
		[[UTC, PLUS, { type: "NUMBER", value: "25" }], "UTC+25"],
		[[UTC, MINUS, { type: "NUMBER", value: "5" }, { type: "COLON", value: ":" }, { type: "NUMBER", value: "60" }], "UTC-5:60"],
		[[UTC, PLUS, { type: "NUMBER", value: "5.5" }], "UTC+5.5"],
		[[UTC, PLUS, { type: "NUMBER", value: "1e308" }], "UTC+1e308"],
		[[UTC, MINUS, { type: "NUMBER", value: "5" }, { type: "COLON", value: ":" }, { type: "NUMBER", value: "5" }], "UTC-5:5"],
	])("an impossible offset is consumed and returned without minutes: %j", (tokens, name) => {
		const cursor = cursorOver(tokens as Array<{ type: string; value: string }>);
		expect(tryReadUtcOffset(cursor)).toEqual({ minutes: null, name });
		expect(cursor.position).toBe(tokens.length);
	});

	test("a time of day after the sign is refused with the sign alone", () => {
		// `11am` is four characters, fused into 660 minutes; `11:00` would be five.
		const cursor = cursorOver([UTC, PLUS, { type: "CLOCK_TIME", value: "660", offset: 4, sourceEnd: 8 }]);
		expect(tryReadUtcOffset(cursor)).toEqual({ minutes: null, name: "UTC+" });
	});

	test("the base name is upper-cased in what a refusal quotes", () => {
		const cursor = cursorOver([{ type: "IDENT", value: "gmt" }, PLUS, { type: "NUMBER", value: "99" }]);
		expect(tryReadUtcOffset(cursor)).toEqual({ minutes: null, name: "GMT+99" });
	});
});

describe("unit: clockTokenIsHoursMinutes", () => {
	const clock = (value: string, length: number | undefined): Token =>
		({ type: "CLOCK_TIME", typeId: 0, value, text: value, offset: 10, lineBreaks: 0, line: 1, col: 1, sourceEnd: length === undefined ? undefined : 10 + length }) as Token;

	test.each([
		["5:30", "330", 4, true],
		["05:00", "300", 5, true],
		["12:45", "765", 5, true],
		["0:00", "0", 4, true],
		["11am", "660", 4, false],
		["5pm", "1020", 3, false],
		["5:30pm", "1050", 6, false],
		["5:5", "305", 3, false],
	])("%s", (_written, value, length, expected) => {
		expect(clockTokenIsHoursMinutes(clock(value, length))).toBe(expected);
	});

	test("a token with no source span, or a value that is not a number, is not", () => {
		expect(clockTokenIsHoursMinutes(clock("330", undefined))).toBe(false);
		expect(clockTokenIsHoursMinutes(clock("constructor", 4))).toBe(false);
	});
});

describe("unit: the named-offset encoding", () => {
	test("is a fixed offset, and named", () => {
		const zone = encodeNamedOffset(-330);
		expect(isFixedOffset(zone)).toBe(true);
		expect(isNamedOffset(zone)).toBe(true);
		expect(decodeFixedOffsetMinutes(zone)).toBe(-330);
	});

	test("the carried encoding is fixed and not named", () => {
		const zone = encodeFixedOffset(540);
		expect(isFixedOffset(zone)).toBe(true);
		expect(isNamedOffset(zone)).toBe(false);
		expect(decodeFixedOffsetMinutes(zone)).toBe(540);
	});

	test.each(["UTC", "Asia/Tokyo", "", "UTCNAMED", "utcnamed:5", "constructor"])("%j is neither", (zone) => {
		expect(isNamedOffset(zone)).toBe(false);
		if (zone !== "UTCNAMED") expect(isFixedOffset(zone)).toBe(false);
	});

	test("the zone math reads it as the offset it is", () => {
		const at = Date.UTC(2026, 3, 3, 20, 0);
		expect(formatTimeInZone(at, encodeNamedOffset(-300), DATE_CALENDAR)).toBe("3:00 PM");
		expect(zoneLabel(encodeNamedOffset(345))).toBe("UTC+5:45");
	});
});

describe("unit: formatValue shows a named offset on its clock", () => {
	test.each([
		[-300, "= Friday, April 3, 2026, 3:00:00 PM"],
		[540, "= Saturday, April 4, 2026, 5:00:00 AM"],
		[840, "= Saturday, April 4, 2026, 10:00:00 AM"],
		[-720, "= Friday, April 3, 2026, 8:00:00 AM"],
		[0, "= Friday, April 3, 2026, 8:00:00 PM"],
	])("20:00 UTC at %i minutes", (minutes, shown) => {
		expect(formatValue(datetimeValue(Date.UTC(2026, 3, 3, 20, 0), "instant", encodeNamedOffset(minutes)))).toBe(shown);
	});

	test("midnight on the offset's clock shows the day alone", () => {
		expect(formatValue(datetimeValue(Date.UTC(2026, 3, 3, 5, 0), "instant", encodeNamedOffset(-300)))).toBe("= Friday, April 3, 2026");
	});

	test("the numeric formats read the offset's fields too", () => {
		const value = datetimeValue(Date.UTC(2026, 3, 3, 20, 0), "instant", encodeNamedOffset(-300));
		expect(formatValue(value, { ...DEFAULT_FORMATTING_SETTINGS, dateResult: { format: "iso" } })).toBe("= 2026-04-03T15:00:00");
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("%s in the base name's place is an unknown zone", (word) => {
		expectPrototypeUntouched(() => {
			expect(show(`2026-04-03T15:00 in ${word}-5`)).toMatch(/^ERROR DATETIME_ZONE_UNKNOWN|^THROWS|^ERROR/);
			expectHonestLine(`2026-04-03T15:00 in ${word}-5`);
			expectHonestLine(`2026-04-03 in UTC-5 in ${word}`);
		});
	});

	test("an offset sized to exhaust the reader is refused by name, quickly", () => {
		const line = `2026-04-03T15:00 in UTC-${"9".repeat(10_000)}`;
		// Refused by the number reader or by the offset reader; never answered.
		const outcome = expectHonestLine(line, { budgetMs: 2_000 });
		expect(outcome.kind).not.toBe("value");
	});

	test("thousands of offset lines are answered in time", () => {
		const text = Array.from({ length: 2_000 }, (_, i) => `2026-04-03T15:00 in UTC${i % 2 ? "+" : "-"}${i % 13}`).join("\n");
		const started = performance.now();
		const lines = batch(text);
		expect(performance.now() - started).toBeLessThan(10_000);
		expect(lines.every((l) => l === "Friday, April 3, 2026, 3:00:00 PM")).toBe(true);
	});

	test("a minus sign from another script reads as the minus it is, and look-alike digits are not digits", () => {
		expect(show("2026-04-03T15:00 in UTC−5")).toBe("Friday, April 3, 2026, 3:00:00 PM");
		expect(show("2026-04-03T15:00 in UTC-​5")).toBe("Friday, April 3, 2026, 3:00:00 PM");
		// A fullwidth five is not a digit, so there is no offset and nothing is answered.
		expectHonestLine("2026-04-03T15:00 in UTC-５");
		expect(show("2026-04-03T15:00 in UTC-５")).not.toMatch(/PM|AM/);
	});

	test("markup around the offset is text, not an offset", () => {
		expectHonestLine("2026-04-03T15:00 in UTC-<b>5</b>");
		expectHonestLine("2026-04-03T15:00 in <script>UTC-5</script>");
		expect(show("2026-04-03T15:00 in UTC-<b>5</b>")).not.toMatch(/PM|AM/);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a date from the line above", () => {
		const text = "meeting = 2026-04-03T15:00\nmeeting in UTC-5\nmeeting in UTC-5 + 2 hours";
		expect(batch(text)).toEqual(incremental(text));
		expect(batch(text).slice(1)).toEqual(["Friday, April 3, 2026, 3:00:00 PM", "Friday, April 3, 2026, 5:00:00 PM"]);
	});

	test("the answer goes on to arithmetic and another zone", () => {
		// June, clear of every host zone's clock change: a day is stepped on the
		// host's calendar, whatever zone the date is read in, which is its own
		// question and not this one's.
		expect(show("(2026-06-03T15:00 in UTC-5) + 1 day")).toBe("Thursday, June 4, 2026, 3:00:00 PM");
		expect(show("2026-04-03T15:00 in UTC-5 in Tokyo")).toBe("Saturday, April 4, 2026, 5:00:00 AM");
		expect(show("2026-04-03T15:00 in UTC-5 frozen")).toBe("Friday, April 3, 2026, 3:00:00 PM");
	});

	test("a typo in the base name is an unknown zone, not an offset", () => {
		expect(show("2026-04-03T15:00 in UTX-5")).toMatch(/^ERROR DATETIME_ZONE_UNKNOWN "UTX"/);
	});

	test("an edit from a city to an offset and back", () => {
		const engine = newTrackedEngine();
		expect(formatValue(evaluateDocument(engine, "2026-04-03T15:00 in Tokyo", { inputType: "markdown" }).lines[0].result!)).toBe("= Friday, April 3, 2026, 3:00:00 PM");
		expect(formatValue(evaluateDocument(engine, "2026-04-03T15:00 in UTC-5", { inputType: "markdown" }).lines[0].result!)).toBe("= Friday, April 3, 2026, 3:00:00 PM");
		expect(evaluateDocument(engine, "2026-04-03T15:00 in UTC-5", { inputType: "markdown" }).lines[0].result!.zone).toBe(encodeNamedOffset(-300));
	});

	test("a snapshot round trip keeps the offset and its display", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("t = 2026-04-03T15:00 in UTC-5", { inputType: "markdown" });
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())), { packages: BUILTIN_PACKAGES });
		try {
			const value = restored.evaluateExpression("t");
			expect(value.zone).toBe(encodeNamedOffset(-300));
			expect(formatValue(value)).toBe("= Friday, April 3, 2026, 3:00:00 PM");
		} finally {
			restored.clear();
		}
	});
});

describe("adversarial: edge cases", () => {
	test("the ends of the range, zero and negative zero", () => {
		expect(show("2026-04-03T15:00 in UTC+0")).toBe("Friday, April 3, 2026, 3:00:00 PM");
		expect(show("2026-04-03T15:00 in UTC-0")).toBe("Friday, April 3, 2026, 3:00:00 PM");
		expect(newTrackedEngine().evaluateLine(1, "2026-04-03T15:00 in UTC-0").zone).toBe(encodeNamedOffset(0));
	});

	test("a leap day and a month end on the far offsets", () => {
		expect(show("2028-02-29T23:30 in UTC+14")).toBe("Tuesday, February 29, 2028, 11:30:00 PM");
		expect(show("2026-04-30T23:30 in UTC-12")).toBe("Thursday, April 30, 2026, 11:30:00 PM");
		expect(show("2026-12-31T23:59 in UTC+14")).toBe("Thursday, December 31, 2026, 11:59:00 PM");
	});

	test("an empty offset after the sign is not an offset", () => {
		expectHonestLine("2026-04-03T15:00 in UTC-");
		expectHonestLine("2026-04-03T15:00 in UTC+ ");
	});

	test("a trailing newline and CRLF leave the answer alone", () => {
		expect(batch("2026-04-03T15:00 in UTC-5\n")[0]).toBe("Friday, April 3, 2026, 3:00:00 PM");
		expect(batch("2026-04-03T15:00 in UTC-5\r\n2026-04-03 in UTC+9")).toEqual(["Friday, April 3, 2026, 3:00:00 PM", "Friday, April 3, 2026"]);
	});
});
