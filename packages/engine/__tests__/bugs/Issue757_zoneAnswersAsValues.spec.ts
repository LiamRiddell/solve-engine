import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { FormattingOverrides } from "@solve-js/format/FormattingSettings";
import { localClockTime, localDayShift, localDuration, localZoneDifference } from "@solve-js/format/LocaleWords";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { Value, ValueType, copyZoneDifference, datetimeValue, stringValue, uomValue } from "@solve-js/vm/Value";
import {
	clockInZone, dayShiftOf, dayShiftWords, describeMinutes, fieldsShownIn, isZoneTime, noonOnDay, shownZone,
	zoneAnswerEqualsText, zoneAnswerJoinedText, zoneAnswerText, zoneDifferenceMinutes, zoneDifferenceText, zoneTimeText,
} from "@solve-js/vm/ZoneAnswers";
import { zoneTimeValue } from "@solve-js/packages/time/parselets/TimezonePluginFunctions";
import { serializeValue } from "@solve-js/worker/serialize";

/**
 * Issue #757 (the zone part): a time in another zone and a time difference
 * were finished English text, so a formatter could not localise them and
 * arithmetic refused them as text.
 *
 *     expression                                        before (de)                          now (de)
 *     10:00 London in Tokyo on 2026-03-10               7:00 PM [String]                      19:00 [Datetime]
 *     time difference between London and Tokyo         Tokyo is 8 hours ahead of London      Tokyo: London + 8 Stunden [Uom]
 *     (10:00 London in Tokyo on 2026-03-10) + 1 hour    TEXT_ARITHMETIC                       20:00
 *
 * A time in a zone is a Datetime of the time-of-day grain (the representation
 * of #708, pull request #832: `grain: "time"` and `timeAnchor`), read in the
 * zone and written to the minute (`timePrecision`). A difference is a signed
 * duration in hours carrying its two places (`zoneDifference`). Under an
 * English locale both read exactly as the text did, and a comparison or a join
 * with that text keeps its answer.
 *
 * The undated forms read the clock, so it is pinned: 10:00 UTC on the day under
 * test is the same calendar day in London, New York and Auckland, the three
 * zones `npm run test:temporal` runs in, and the spec runs on both backends.
 */

const SUMMER = "2026-07-15T10:00:00Z";
const WINTER = "2026-01-15T10:00:00Z";

function pin(at: string): void {
	jest.useFakeTimers();
	jest.setSystemTime(new Date(at));
}

beforeEach(() => pin(SUMMER));
afterEach(() => {
	jest.useRealTimers();
});

const under = (tag: string, extra: FormattingOverrides = {}): FormattingOverrides => ({ ...extra, numberResult: { decimalSeparatorLocale: tag } });
const de = under("de");

function value(line: string, engine = newTrackedEngine()): Value {
	return engine.evaluateExpression(line);
}

function shown(line: string, settings?: FormattingOverrides, engine = newTrackedEngine()): string {
	return formatValue(value(line, engine), settings);
}

describe("the issue's lines", () => {
	test.each([
		["10:00 London in Tokyo on 2026-03-10", "= 7:00 PM", "= 19:00"],
		["time difference between London and Tokyo", "= Tokyo is 8 hours ahead of London", "= Tokyo: London + 8 Stunden"],
		["(10:00 London in Tokyo on 2026-03-10) + 1 hour", "= 8:00 PM", "= 20:00"],
	])("%s: %s in English, %s under de", (line, english, german) => {
		expect(shown(line)).toBe(english);
		expect(shown(line, de)).toBe(german);
		expect(shown(line, under("de-DE"))).toBe(german);
		expect(shown(line, under("de", { wordsResult: { spelling: "engine" } }))).toBe(english);
	});

	test("a time in a zone is a time of day in that zone, written to the minute", () => {
		const v = value("10:00 London in Tokyo on 2026-03-10");
		expect(v.type).toBe(ValueType.Datetime);
		expect(v.grain).toBe("time");
		expect(v.zone).toBe("Asia/Tokyo");
		expect(v.timePrecision).toBe("minute");
		expect(v.toNumber()).toBe(Date.UTC(2026, 2, 10, 10));
		expect(v.timeAnchor).toBe(Date.UTC(2026, 2, 10, 3));
	});

	test("a zone difference is a signed duration in hours that names its two places", () => {
		const v = value("time difference between London and Tokyo");
		expect(v.type).toBe(ValueType.Uom);
		expect(v.unit).toBe("hours");
		expect(v.toNumber()).toBe(8);
		expect(v.zoneDifference).toEqual({ from: "London", to: "Tokyo" });
		expect(value("time difference between Tokyo and London").toNumber()).toBe(-8);
	});

	test("English tags write exactly what the text was", () => {
		for (const tag of ["en", "en-US", "en-GB", "en-IN", "xx"]) {
			expect(shown("10:00 London in Tokyo on 2026-03-10", under(tag))).toBe("= 7:00 PM");
			expect(shown("11pm London in Tokyo on 2026-03-10", under(tag))).toBe("= 8:00 AM (+1 day)");
			expect(shown("time difference between London and Delhi", under(tag))).toBe("= Delhi is 4 hours 30 minutes ahead of London");
		}
	});
});

describe("a German formatter renders each answer", () => {
	test.each([
		["10:00 London in Tokyo on 2026-03-10", "= 19:00"],
		["11pm London in Tokyo on 2026-03-10", "= 8:00 (+1 Tag)"],
		["9am Tokyo on 23 September 2026 in San Francisco", "= 17:00 (-1 Tag)"],
		["3pm London in GMT+8", "= 22:00"],
		["3pm London in UTC-5:30", "= 8:30"],
		["time in Tokyo", "= 19:00"],
		["time difference between London and Tokyo", "= Tokyo: London + 8 Stunden"],
		["time difference between Tokyo and London", "= London: Tokyo - 8 Stunden"],
		["time difference between London and Delhi", "= Delhi: London + 4 Stunden 30 Minuten"],
		["time difference between London and UTC+5:45", "= UTC+5:45: London + 4 Stunden 45 Minuten"],
		["time difference between London and Lisbon", "= Lisbon: London ± 0 Minuten"],
		["time difference between London and Tokyo in hours", "= 8 Stunden"],
	])("%s is %s", (line, german) => {
		expect(shown(line, de)).toBe(german);
	});

	test("other languages take their own clock and words", () => {
		expect(shown("11pm London in Tokyo on 2026-03-10", under("fr"))).toBe("= 8:00 (+1 jour)");
		expect(shown("time difference between London and Tokyo", under("fr"))).toBe("= Tokyo: London + 8 heures");
		expect(shown("10:00 London in Tokyo on 2026-03-10", under("ja"))).toBe("= 19:00");
	});

	test("the numeric date formats write the time on a 24-hour clock", () => {
		expect(shown("10:00 London in Tokyo on 2026-03-10", { dateResult: { format: "iso" } })).toBe("= 19:00");
		expect(shown("11pm London in Tokyo on 2026-03-10", { dateResult: { format: "dmy" } })).toBe("= 08:00 (+1 day)");
	});

	test("a list of several zones is still text, in English", () => {
		const v = value("3pm London on 23 September 2026 in Tokyo, New York and Sydney");
		expect(v.type).toBe(ValueType.String);
		expect(formatValue(v, de)).toBe("= Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day)");
	});
});

describe("arithmetic on a zone time", () => {
	test.each([
		["(10:00 London in Tokyo on 2026-03-10) + 1 hour", "= 8:00 PM"],
		["(10:00 London in Tokyo on 2026-03-10) - 30 minutes", "= 6:30 PM"],
		["(10:00 London in Tokyo on 2026-03-10) + 90 minutes", "= 8:30 PM"],
		["1 hour + (10:00 London in Tokyo on 2026-03-10)", "= 8:00 PM"],
		["(10:00 London in Tokyo on 2026-03-10) + 1 day", "= 7:00 PM (+1 day)"],
		["(10:00 London in Tokyo on 2026-03-10) in Paris", "= 11:00 AM"],
		["(11pm London in Tokyo on 2026-03-10) in Honolulu", "= 1:00 PM"],
		["(10:00 London in Tokyo on 2026-03-10) - (9:00 London in Tokyo on 2026-03-10)", "= 1:00"],
	])("%s is %s", (line, english) => {
		expect(shown(line)).toBe(english);
	});

	test("a duration keeps it a time in the zone, to the minute", () => {
		const v = value("(10:00 London in Tokyo on 2026-03-10) + 1 hour");
		expect(v.grain).toBe("time");
		expect(v.zone).toBe("Asia/Tokyo");
		expect(v.timePrecision).toBe("minute");
		expect(v.timeAnchor).toBe(value("10:00 London in Tokyo on 2026-03-10").timeAnchor);
	});

	test("a zone difference converts, adds and compares as a duration", () => {
		expect(shown("time difference between London and Tokyo in hours")).toBe("= 8 hours");
		expect(shown("time difference between London and Tokyo in minutes")).toBe("= 480 minutes");
		expect(shown("time difference between Tokyo and London in hours")).toBe("= -8 hours");
		expect(shown("time difference between London and Delhi in hours")).toBe("= 4.50 hours");
		expect(shown("(time difference between London and Tokyo) + 1 hour")).toBe("= 9 hours");
		expect(shown("(time difference between London and Tokyo) * 2")).toBe("= 16 hours");
		expect(value("(time difference between London and Tokyo) == 8 hours").value).toBe(true);
		expect(value("(time difference between London and Tokyo) > 7 hours").value).toBe(true);
	});

	test("a zone difference moves a zone time onto the other clock", () => {
		expect(shown("(10:00 London in London on 2026-07-10) + (time difference between London and Tokyo)")).toBe("= 6:00 PM");
	});

	test("a variable holds a zone time and converts it on", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("t = 3pm London in Tokyo on 2026-03-10");
		expect(shown("t", undefined, engine)).toBe("= 12:00 AM (+1 day)");
		expect(shown("t + 1 hour", undefined, engine)).toBe("= 1:00 AM (+1 day)");
		// The time's own wall clock, midnight in Tokyo, read as London's on that day.
		expect(shown("t London in Paris", undefined, engine)).toBe("= 1:00 AM");
	});
});

describe("a midnight crossing", () => {
	test.each([
		["11pm London in Tokyo on 2026-03-10", "= 8:00 AM (+1 day)"],
		["9am Tokyo on 23 September 2026 in San Francisco", "= 5:00 PM (-1 day)"],
		["(11pm London in Tokyo on 2026-03-10) - 10 hours", "= 10:00 PM"],
		["(10pm London in London on 2026-03-10) + 3 hours", "= 1:00 AM (+1 day)"],
		["(10:00 London in Tokyo on 2026-03-10) + 2 days", "= 7:00 PM (+2 days)"],
		["(10:00 London in Tokyo on 2026-03-10) - 1 day", "= 7:00 PM (-1 day)"],
		["3pm GMT+14 in GMT-11", "= 2:00 PM (-1 day)"],
		["11pm London in Tokyo on 2026-12-31", "= 8:00 AM (+1 day)"],
		["11pm London in Tokyo on 2028-02-28", "= 8:00 AM (+1 day)"],
	])("%s is %s", (line, english) => {
		expect(shown(line)).toBe(english);
	});

	test("the shift is counted from the day the reader named, not the day it is shown", () => {
		const v = value("11pm London in Tokyo on 2026-03-10");
		pin("2030-01-01T10:00:00Z");
		expect(formatValue(v)).toBe("= 8:00 AM (+1 day)");
	});
});

describe("daylight saving gaps and overlaps", () => {
	test("a reading the clocks skip or repeat is still refused by name", () => {
		expect(value("1:30am London in Tokyo on 2026-03-29").value).toBe("TIME_ZONE_SKIPPED_TIME");
		expect(value("1:30am London in Tokyo on 2026-10-25").value).toBe("TIME_ZONE_REPEATED_TIME");
	});

	test("an hour added across the gap lands an hour later on the clock that jumped", () => {
		expect(shown("12:30am UTC in London on 2026-03-29")).toBe("= 12:30 AM");
		expect(shown("(12:30am UTC in London on 2026-03-29) + 1 hour")).toBe("= 2:30 AM");
	});

	test("an hour added across the overlap shows the repeated hour", () => {
		expect(shown("12:30am UTC in London on 2026-10-25")).toBe("= 1:30 AM");
		expect(shown("(12:30am UTC in London on 2026-10-25) + 1 hour")).toBe("= 1:30 AM");
		expect(value("(12:30am UTC in London on 2026-10-25) + 1 hour").toNumber() - value("12:30am UTC in London on 2026-10-25").toNumber()).toBe(3_600_000);
	});

	test("the difference follows the clocks on the day it is asked", () => {
		expect(shown("time difference between London and Tokyo")).toBe("= Tokyo is 8 hours ahead of London");
		expect(shown("time difference between London and New York")).toBe("= London is 5 hours ahead of New York");
		pin(WINTER);
		expect(shown("time difference between London and Tokyo")).toBe("= Tokyo is 9 hours ahead of London");
		expect(value("time difference between London and Tokyo").toNumber()).toBe(9);
	});
});

describe("half-hour and 45-minute zones", () => {
	test.each([
		["time difference between London and Delhi", "= Delhi is 4 hours 30 minutes ahead of London", 4.5],
		["time difference between London and UTC+5:45", "= UTC+5:45 is 4 hours 45 minutes ahead of London", 4.75],
		["time difference between Delhi and Karachi", "= Delhi is 30 minutes ahead of Karachi", -0.5],
		["time difference between UTC+5:45 and Delhi", "= UTC+5:45 is 15 minutes ahead of Delhi", -0.25],
		["time difference between London and Adelaide", "= Adelaide is 8 hours 30 minutes ahead of London", 8.5],
	])("%s is %s", (line, english, hours) => {
		expect(shown(line)).toBe(english);
		expect(value(line).toNumber()).toBe(hours);
	});

	test.each([
		["3pm GMT+5:45 in UTC", "= 9:15 AM"],
		["3pm Delhi in Tokyo", "= 6:30 PM"],
		["3pm London in GMT+12:45", "= 2:45 AM (+1 day)"],
		["(3pm GMT+5:45 in UTC) + 45 minutes", "= 10:00 AM"],
	])("%s is %s", (line, english) => {
		expect(shown(line)).toBe(english);
	});
});

describe("a difference of zero", () => {
	test("two places on one clock share it, in English and in German", () => {
		expect(shown("time difference between London and Lisbon")).toBe("= Lisbon and London currently share the same UTC offset");
		expect(shown("time difference between London and London")).toBe("= London and London currently share the same UTC offset");
		expect(shown("time difference between London and Lisbon", de)).toBe("= Lisbon: London ± 0 Minuten");
		expect(value("time difference between London and Lisbon").toNumber()).toBe(0);
		expect(shown("time difference between London and Lisbon in hours")).toBe("= 0 hours");
	});

	test("a negative zero has no direction", () => {
		const v = uomValue(-0, "hours");
		v.zoneDifference = { from: "London", to: "Lisbon" };
		expect(formatValue(v)).toBe("= Lisbon and London currently share the same UTC offset");
		expect(zoneDifferenceMinutes(v)).toBe(0);
		expect(Object.is(zoneDifferenceMinutes(v), -0)).toBe(false);
	});
});

describe("must not break: a comparison against the old text", () => {
	test.each([
		['(10:00 London in Tokyo on 2026-03-10) == "7:00 PM"', true],
		['"7:00 PM" == (10:00 London in Tokyo on 2026-03-10)', true],
		['(10:00 London in Tokyo on 2026-03-10) != "7:00 PM"', false],
		['(10:00 London in Tokyo on 2026-03-10) == "19:00"', false],
		['(11pm London in Tokyo on 2026-03-10) == "8:00 AM (+1 day)"', true],
		['(time difference between London and Tokyo) == "Tokyo is 8 hours ahead of London"', true],
		['(time difference between London and Lisbon) == "Lisbon and London currently share the same UTC offset"', true],
		['(time difference between London and Tokyo) == "8 hours"', false],
		['(2026-03-10 as weekday) == "Tuesday"', true],
	])("%s is %s", (line, answer) => {
		expect(value(line).value).toBe(answer);
	});

	test("text joined to a zone answer reads its English text", () => {
		expect(shown('"at " + (10:00 London in Tokyo on 2026-03-10)', de)).toBe("= at 7:00 PM");
		expect(shown('(10:00 London in Tokyo on 2026-03-10) + " there"')).toBe("= 7:00 PM there");
		expect(shown('"gap: " + (time difference between London and Tokyo)')).toBe("= gap: Tokyo is 8 hours ahead of London");
	});

	test("an order against text is still refused, and other dates are not text", () => {
		expect(value('(10:00 London in Tokyo on 2026-03-10) < "8:00 PM"').value).toBe("TEXT_COMPARISON");
		expect(value('2026-03-10 == "March 10, 2026"').value).toBe(false);
		expect(value('"at " + 2026-03-10').type).toBe(ValueType.Error);
	});
});

describe("the host surface", () => {
	test("toJSON carries the new fields as plain JSON", () => {
		expect(value("10:00 London in Tokyo on 2026-03-10").toJSON()).toEqual({
			type: ValueType.Datetime, value: Date.UTC(2026, 2, 10, 10), grain: "time", zone: "Asia/Tokyo",
			timeAnchor: Date.UTC(2026, 2, 10, 3), timePrecision: "minute",
		});
		expect(value("time difference between London and Tokyo").toJSON()).toEqual({
			type: ValueType.Uom, value: 8, unit: "hours", zoneDifference: { from: "London", to: "Tokyo" },
		});
	});

	test("toJSON keeps the day a dated gap was measured on", () => {
		expect(value("time difference between London and Tokyo on 2026-03-10").toJSON()).toEqual({
			type: ValueType.Uom, value: 9, unit: "hours", zoneDifference: { from: "London", to: "Tokyo", on: "March 10, 2026" },
		});
	});

	test("copyZoneDifference keeps the day only when there is one, and shares nothing", () => {
		const dated = { from: "London", to: "Tokyo", on: "March 10, 2026" };
		const copy = copyZoneDifference(dated);
		expect(copy).toEqual(dated);
		expect(copy).not.toBe(dated);
		expect(Object.keys(copyZoneDifference({ from: "London", to: "Tokyo" }))).toEqual(["from", "to"]);
		expect(Object.keys(copyZoneDifference({ from: "London", to: "Tokyo", on: undefined }))).toEqual(["from", "to"]);
		expect(copyZoneDifference({ from: "", to: "", on: "" })).toEqual({ from: "", to: "", on: "" });
		expectPrototypeUntouched(() => {
			expect(copyZoneDifference({ from: "__proto__", to: "constructor", on: "toString" })).toEqual({ from: "__proto__", to: "constructor", on: "toString" });
		});
	});

	test.each([
		["10:00 London in Tokyo on 2026-03-10", "= 19:00"],
		["11pm London in Tokyo on 2026-03-10", "= 8:00 (+1 Tag)"],
		["time in Tokyo", "= 19:00"],
		["time difference between London and Tokyo", "= Tokyo: London + 8 Stunden"],
		["time difference between London and Lisbon", "= Lisbon: London ± 0 Minuten"],
	])("the worker DTO carries %s with its fields and its text", (line, german) => {
		const engine = newTrackedEngine();
		const v = value(line, engine);
		const dto = serializeValue(v, { ...engine.getFormattingSettings(), numberResult: { decimalSeparatorLocale: "de" } });
		expect(dto.text).toBe(german);
		expect(dto.grain).toBe(v.grain);
		expect(dto.zone).toBe(v.zone);
		expect(dto.timeAnchor).toBe(v.timeAnchor);
		expect(dto.timePrecision).toBe(v.timePrecision);
		expect(dto.zoneDifference).toEqual(v.zoneDifference);
		expect(structuredClone(dto)).toEqual(dto);
		expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
		expect(serializeValue(v).text).toBe(formatValue(v));
	});

	test("a snapshot round trip keeps both shapes, and a malformed one is refused by name", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("t = 11pm London in Tokyo on 2026-03-10\ngap = time difference between London and Tokyo");
		const json = JSON.stringify(engine.toJSON());
		expect(json).toContain('"tp":"minute"');
		expect(json).toContain('"zd":{"from":"London","to":"Tokyo"}');
		const restored = ExpressionEngine.fromJSON(JSON.parse(json), { packages: BUILTIN_PACKAGES });
		try {
			expect(formatValue(restored.evaluateExpression("t"))).toBe("= 8:00 AM (+1 day)");
			expect(formatValue(restored.evaluateExpression("t"), de)).toBe("= 8:00 (+1 Tag)");
			expect(formatValue(restored.evaluateExpression("gap"))).toBe("= Tokyo is 8 hours ahead of London");
			expect(restored.evaluateExpression('t == "8:00 AM (+1 day)"').value).toBe(true);
		} finally {
			restored.clear();
		}
		const bad: [RegExp, string][] = [
			[/"tp":"minute"/, '"tp":"second"'],
			[/"zd":\{[^}]*\}/, '"zd":{"from":5,"to":"Tokyo"}'],
			[/"zd":\{[^}]*\}/, '"zd":"Tokyo"'],
			[/"g":"time"/, '"g":"hour"'],
		];
		for (const [find, replacement] of bad) {
			const hostile = JSON.parse(json.replace(find, replacement));
			expect(() => ExpressionEngine.fromJSON(hostile, { packages: BUILTIN_PACKAGES })).toThrow(/\.(tp|zd|g)/);
		}
	});

	test("a snapshot written before the fields existed restores as it was", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("d = 2026-04-03 in Tokyo");
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())), { packages: BUILTIN_PACKAGES });
		try {
			expect(formatValue(restored.evaluateExpression("d"))).toBe("= Friday, April 3, 2026");
		} finally {
			restored.clear();
		}
	});
});

describe("both document passes agree", () => {
	const doc = [
		"meet = 10:00 London in Tokyo on 2026-03-10",
		"meet + 1 hour",
		"late = 11pm London in Tokyo on 2026-03-10",
		"gap = time difference between London and Tokyo",
		"gap in hours",
		"meet == \"7:00 PM\"",
		"\"at \" + meet",
		"late in Honolulu",
	].join("\n");

	test.each([["en", undefined], ["de", de]] as const)("under %s", (_tag, settings) => {
		const render = (result: Value | null | undefined) => (result ? formatValue(result, settings) : "");
		const batch = newTrackedEngine().parseDocument(doc).lines.map((line) => render(line.result));
		const live = evaluateDocument(newTrackedEngine(), doc).lines.map((line) => render(line.result));
		expect(live).toEqual(batch);
		expect(batch).toEqual(settings === undefined
			? ["= 7:00 PM", "= 8:00 PM", "= 8:00 AM (+1 day)", "= Tokyo is 8 hours ahead of London", "= 8 hours", "= true", "= at 7:00 PM", "= 1:00 PM"]
			: ["= 19:00", "= 20:00", "= 8:00 (+1 Tag)", "= Tokyo: London + 8 Stunden", "= 8 Stunden", "= true", "= at 7:00 PM", "= 13:00"]);
	});

	test("a CRLF document and an edit agree too", () => {
		const crlf = doc.replace(/\n/g, "\r\n");
		const batch = newTrackedEngine().parseDocument(crlf).lines.map((line) => (line.result ? formatValue(line.result) : ""));
		const live = evaluateDocument(newTrackedEngine(), crlf).lines.map((line) => (line.result ? formatValue(line.result) : ""));
		expect(live).toEqual(batch);
		const edited = doc.replace("10:00 London", "11:00 London");
		expect(newTrackedEngine().parseDocument(edited).lines.map((line) => (line.result ? formatValue(line.result) : "")).slice(0, 2))
			.toEqual(["= 8:00 PM", "= 9:00 PM"]);
	});
});

describe("the parts", () => {
	test("describeMinutes and dayShiftWords", () => {
		expect(describeMinutes(0)).toBe("0 minutes");
		expect(describeMinutes(1)).toBe("1 minute");
		expect(describeMinutes(60)).toBe("1 hour");
		expect(describeMinutes(270)).toBe("4 hours 30 minutes");
		expect(describeMinutes(1500)).toBe("25 hours");
		expect(dayShiftWords(0)).toBe("");
		expect(dayShiftWords(1)).toBe(" (+1 day)");
		expect(dayShiftWords(-1)).toBe(" (-1 day)");
		expect(dayShiftWords(400)).toBe(" (+400 days)");
		expect(dayShiftWords(NaN)).toBe("");
		expect(dayShiftWords(Infinity)).toBe("");
	});

	test("shownZone records a typed offset as one the reader named", () => {
		expect(shownZone("Asia/Tokyo")).toBe("Asia/Tokyo");
		expect(shownZone("UTCOFFSET:480")).toBe("UTCNAMED:480");
		expect(shownZone("UTCOFFSET:-330")).toBe("UTCNAMED:-330");
		expect(shownZone("UTCNAMED:60")).toBe("UTCNAMED:60");
		for (const word of PROTOTYPE_WORDS) expect(shownZone(word)).toBe(word);
	});

	test("fieldsShownIn and noonOnDay agree on the day, named zone or fixed offset", () => {
		for (const zone of ["Asia/Tokyo", "Pacific/Honolulu", "Pacific/Kiritimati", "UTCOFFSET:-660", "UTCNAMED:840", "UTC"]) {
			const noon = noonOnDay(2026, 2, 10, zone, DATE_CALENDAR);
			const f = fieldsShownIn(noon, zone, DATE_CALENDAR);
			expect([f.year, f.month0, f.day, f.hour]).toEqual([2026, 2, 10, 12]);
			expect(fieldsShownIn(noon, zone)).toEqual(f);
		}
		// A month end rolls over.
		const f = fieldsShownIn(noonOnDay(2026, 0, 32, "Asia/Tokyo", DATE_CALENDAR), "Asia/Tokyo");
		expect([f.month0, f.day]).toEqual([1, 1]);
	});

	test("isZoneTime asks for every part of the shape", () => {
		const v = datetimeValue(0, "time", "Asia/Tokyo", 0);
		expect(isZoneTime(v)).toBe(false);
		v.timePrecision = "minute";
		expect(isZoneTime(v)).toBe(true);
		expect(isZoneTime(datetimeValue(0, "instant", "Asia/Tokyo"))).toBe(false);
		const noZone = datetimeValue(0, "time", undefined, 0);
		noZone.timePrecision = "minute";
		expect(isZoneTime(noZone)).toBe(false);
		expect(isZoneTime(stringValue("7:00 PM"))).toBe(false);
	});

	test("dayShiftOf and zoneTimeText, ordinary and hostile", () => {
		const v = zoneTimeValue(Date.UTC(2026, 2, 10, 23), "Asia/Tokyo", { year: 2026, month0: 2, day: 10 }, DATE_CALENDAR);
		expect(dayShiftOf(v)).toBe(1);
		expect(dayShiftOf(v, DATE_CALENDAR)).toBe(1);
		expect(zoneTimeText(v)).toBe("8:00 AM (+1 day)");
		expect(clockInZone(Date.UTC(2026, 2, 10, 23), "UTCNAMED:-660")).toBe("12:00 PM");
		// Not the instant 0: jest's fake clock reads a format of 0 as now.
		const noAnchor = datetimeValue(Date.UTC(2026, 0, 1), "time", "UTC");
		noAnchor.timePrecision = "minute";
		expect(dayShiftOf(noAnchor)).toBe(0);
		expect(zoneTimeText(noAnchor)).toBe("12:00 AM");
		const unknown = datetimeValue(0, "time", "Mars/Olympus", 0);
		unknown.timePrecision = "minute";
		expect(zoneTimeText(unknown)).toBeUndefined();
		const notANumber = datetimeValue(NaN, "time", "UTC", 0);
		notANumber.timePrecision = "minute";
		expect(zoneTimeText(notANumber)).toBeUndefined();
		expect(zoneTimeText(stringValue("7:00 PM"))).toBeUndefined();
	});

	test("zoneDifferenceMinutes and zoneDifferenceText decline what is not one", () => {
		const v = uomValue(-8, "hours");
		v.zoneDifference = { from: "Tokyo", to: "London" };
		expect(zoneDifferenceMinutes(v)).toBe(-480);
		expect(zoneDifferenceText(v)).toBe("Tokyo is 8 hours ahead of London");
		const minutes = uomValue(480, "minutes");
		minutes.zoneDifference = { from: "London", to: "Tokyo" };
		expect(zoneDifferenceMinutes(minutes)).toBeUndefined();
		expect(formatValue(minutes)).toBe("= 480 minutes");
		const infinite = uomValue(Infinity, "hours");
		infinite.zoneDifference = { from: "London", to: "Tokyo" };
		expect(zoneDifferenceText(infinite)).toBeUndefined();
		expect(formatValue(infinite)).not.toMatch(/ahead/);
		expect(zoneDifferenceText(uomValue(8, "hours"))).toBeUndefined();
	});

	test("zoneAnswerText, zoneAnswerEqualsText and zoneAnswerJoinedText", () => {
		const time = zoneTimeValue(Date.UTC(2026, 2, 10, 10), "Asia/Tokyo", { year: 2026, month0: 2, day: 10 }, DATE_CALENDAR);
		expect(zoneAnswerText(time)).toBe("7:00 PM");
		expect(zoneAnswerText(stringValue("7:00 PM"))).toBeUndefined();
		expect(zoneAnswerText(uomValue(8, "hours"))).toBeUndefined();
		expect(zoneAnswerEqualsText(time, stringValue("7:00 PM"))).toBe(true);
		expect(zoneAnswerEqualsText(stringValue("7:00 pm"), time)).toBe(false);
		expect(zoneAnswerEqualsText(time, time)).toBeNull();
		expect(zoneAnswerEqualsText(stringValue("a"), stringValue("a"))).toBeNull();
		expect(zoneAnswerEqualsText(stringValue("a"), uomValue(8, "hours"))).toBeNull();
		expect(zoneAnswerJoinedText(stringValue("at "), time)).toBe("at 7:00 PM");
		expect(zoneAnswerJoinedText(time, stringValue("!"))).toBe("7:00 PM!");
		expect(zoneAnswerJoinedText(stringValue("at "), datetimeValue(0, "date"))).toBeNull();
		expect(zoneAnswerJoinedText(time, time)).toBeNull();
	});

	test("localClockTime, localDayShift, localDuration and localZoneDifference", () => {
		expect(localClockTime(Date.UTC(2026, 2, 10, 10), "Asia/Tokyo", "de")).toBe("19:00");
		expect(localClockTime(Date.UTC(2026, 2, 10, 10), "Asia/Tokyo", "en-US")).toBeUndefined();
		expect(localClockTime(NaN, "Asia/Tokyo", "de")).toBeUndefined();
		expect(localClockTime(0, "Mars/Olympus", "de")).toBeUndefined();
		expect(localClockTime(0, "x".repeat(10_000), "de")).toBeUndefined();
		expect(localDayShift(0, "de")).toBe("");
		expect(localDayShift(1, "de")).toBe(" (+1 Tag)");
		expect(localDayShift(-2, "de")).toBe(" (-2 Tage)");
		expect(localDayShift(1.5, "de")).toBeUndefined();
		expect(localDayShift(1, "en")).toBeUndefined();
		expect(localDuration(0, "de")).toBe("0 Minuten");
		expect(localDuration(60, "de")).toBe("1 Stunde");
		expect(localDuration(285, "de")).toBe("4 Stunden 45 Minuten");
		expect(localDuration(-1, "de")).toBeUndefined();
		expect(localDuration(0.5, "de")).toBeUndefined();
		expect(localZoneDifference(-480, "Tokyo", "London", "de")).toBe("London: Tokyo - 8 Stunden");
		expect(localZoneDifference(0, "London", "Lisbon", "de")).toBe("Lisbon: London ± 0 Minuten");
		expect(localZoneDifference(NaN, "a", "b", "de")).toBeUndefined();
		for (const word of PROTOTYPE_WORDS) {
			expect(localClockTime(0, "UTC", word)).toBeUndefined();
			expect(localDayShift(1, word)).toBeUndefined();
			expect(localZoneDifference(60, "a", "b", word)).toBeUndefined();
		}
	});

	test("zoneTimeValue anchors on the reader's day as the target zone counts it", () => {
		const v = zoneTimeValue(Date.UTC(2026, 2, 10, 10), "UTCOFFSET:480", { year: 2026, month0: 2, day: 10 }, DATE_CALENDAR);
		expect(v.zone).toBe("UTCNAMED:480");
		expect(v.timeAnchor).toBe(Date.UTC(2026, 2, 10, 4));
		expect(formatValue(v)).toBe("= 6:00 PM");
	});

	test("clone carries the sidecars and recycle clears them", () => {
		const time = value("11pm London in Tokyo on 2026-03-10");
		const gap = value("time difference between London and Tokyo");
		expect(formatValue(time.clone())).toBe("= 8:00 AM (+1 day)");
		expect(formatValue(gap.clone())).toBe("= Tokyo is 8 hours ahead of London");
		time.recycle(ValueType.Datetime, 0);
		gap.recycle(ValueType.Uom, 8, "hours");
		expect([time.grain, time.timeAnchor, time.timePrecision, time.zone]).toEqual([undefined, undefined, undefined, undefined]);
		expect(gap.zoneDifference).toBeUndefined();
		expect(formatValue(gap)).toBe("= 8 hours");
	});
});

describe("adversarial", () => {
	test("security: prototype words as zone names are refused honestly and touch nothing", () => {
		expectPrototypeUntouched(() => {
			for (const template of ["3pm X in Tokyo", "3pm London in X", "time in X", "time difference between X and Tokyo", "time difference between London and X", "(3pm London in Tokyo) in X"]) {
				for (const line of fill(template, PROTOTYPE_WORDS)) expectHonestLine(line);
			}
		});
	});

	test("security: look-alike and markup text beside a zone answer is read as text", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill('(3pm London in Tokyo) == "X"', TEXT_EDGES)) expectHonestLine(line);
			for (const line of fill('"X" + (time difference between London and Tokyo)', TEXT_EDGES)) expectHonestLine(line);
			for (const line of fill("3pm London in Tokyo X", TEXT_EDGES)) expectHonestLine(line);
		});
		expect(shown('"<b>" + (3pm London in Tokyo on 2026-03-10)')).toBe("= <b>12:00 AM (+1 day)");
	});

	test("security: a thousand zone answers in one note stay within budget", () => {
		const doc = Array.from({ length: 1_000 }, (_, i) => `${(i % 12) + 1}pm London in Tokyo on 2026-03-10 + ${i} minutes`).join("\n");
		expectHonestDocument(doc, { budgetMs: 20_000 });
		const many = Array.from({ length: 500 }, (_, i) => (i % 2 === 0 ? "time difference between London and Tokyo" : "prev + 1 hour")).join("\n");
		expectHonestDocument(many, { budgetMs: 20_000 });
	});

	test("realistic: a typo, a unit that does not fit, and a value from the line above", () => {
		expectHonestLine("3pm Londn in Tokyo");
		expectHonestLine("(3pm London in Tokyo) + 5 kg");
		expectHonestLine("(3pm London in Tokyo) * 2");
		expectHonestLine("(time difference between London and Tokyo) + 5 kg");
		expectHonestLine("(time difference between London and Tokyo) in kg");
		const doc = "3pm London in Tokyo on 2026-03-10\nprev + 1 hour\ntime difference between London and Tokyo\nprev in minutes";
		expectHonestDocument(doc);
		expect(newTrackedEngine().parseDocument(doc).lines.map((line) => (line.result ? formatValue(line.result) : "")))
			.toEqual(["= 12:00 AM (+1 day)", "= 1:00 AM (+1 day)", "= Tokyo is 8 hours ahead of London", "= 480 minutes"]);
	});

	test("realistic: the document edge shapes beside a zone answer", () => {
		for (const edge of DOCUMENT_EDGES) expectHonestDocument(`${edge}\n3pm London in Tokyo on 2026-03-10\ntime difference between London and Tokyo`);
	});

	test("edges: dates before 1970, past 2038 and at the far end of the calendar", () => {
		// London kept British Standard Time, an hour ahead of GMT, all year in 1969.
		expect(shown("3pm London in Tokyo on 1969-07-20")).toBe("= 11:00 PM");
		expect(shown("3pm London in Tokyo on 2100-03-01")).toBe("= 12:00 AM (+1 day)");
		expectHonestLine("3pm London in Tokyo on 9999-12-31");
		expectHonestLine("(3pm London in Tokyo on 9999-12-31) + 1 day");
		// Past the calendar's range a zone time is refused by name where it is
		// made (DATE_OUT_OF_RANGE, the dates batch, #832), in every locale,
		// rather than throwing where its zone is read, and the refusal passes
		// through a conversion of it.
		expect(value("(3pm London in Tokyo on 2026-03-10) + 1e15 hours").value).toBe("DATE_OUT_OF_RANGE");
		expect(shown("(3pm London in Tokyo on 2026-03-10) + 1e15 hours", de)).toMatch(/past the range a calendar holds/);
		const engine = newTrackedEngine();
		engine.evaluateExpression("far = (3pm London in Tokyo on 2026-03-10) + 1e15 hours");
		expect(value("far London in Paris", engine).value).toBe("DATE_OUT_OF_RANGE");
		expect(value("far in Paris", engine).value).toBe("DATE_OUT_OF_RANGE");
	});
});
