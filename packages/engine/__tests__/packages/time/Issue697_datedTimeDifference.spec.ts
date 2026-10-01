/**
 * #697: `time difference between <zone> and <zone> on <date>` gives the gap on
 * that day, and `time in <zone> on <date>` is refused with the two forms that
 * answer what it usually means.
 *
 * The gap between two places moves when either changes its clocks, and the US
 * and the UK change on different Sundays, so the dates here sit either side of
 * each change and on the change days themselves. The clock is pinned, on the
 * calendar backend under test, so the undated answers are fixed too.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { RecordingCalendar } from "@tools/recordingCalendar";
import { calendarUnderTest, temporalCalendarForTests } from "@tools/temporalTestKit";
import { formatValue } from "@solve-js/format/FormatEngine";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { ValueType } from "@solve-js/vm/Value";

/** An engine whose clock is stopped at noon on 25 September 2026, in London. */
function engine() {
	const inner = calendarUnderTest() === "temporal" ? temporalCalendarForTests({ timeZone: "Europe/London" }) : dateCalendarInZone("Europe/London");
	const calendar = new RecordingCalendar(Date.parse("2026-09-25T11:00:00Z"), inner);
	return newTrackedEngine({ config: { network: { enabled: false } }, calendar });
}

const e = engine();
const show = (line: string): string => formatValue(e.evaluateExpression(line)).replace(/^=\s*/, "");

describe("#697: the gap on a given day", () => {
	test.each([
		["London and Tokyo on 1 March 2027", "Tokyo is 9 hours ahead of London on March 1, 2027"],
		["London and Tokyo on 1 July 2027", "Tokyo is 8 hours ahead of London on July 1, 2027"],
		["London and New York on 1 March 2027", "London is 5 hours ahead of New York on March 1, 2027"],
		["London and New York on 13 March 2027", "London is 5 hours ahead of New York on March 13, 2027"],
		["London and New York on 14 March 2027", "London is 4 hours ahead of New York on March 14, 2027"],
		["London and New York on 20 March 2027", "London is 4 hours ahead of New York on March 20, 2027"],
		["London and New York on 27 March 2027", "London is 4 hours ahead of New York on March 27, 2027"],
		["London and New York on 28 March 2027", "London is 5 hours ahead of New York on March 28, 2027"],
		["London and New York on 1 November 2027", "London is 4 hours ahead of New York on November 1, 2027"],
		["London and New York on 8 November 2027", "London is 5 hours ahead of New York on November 8, 2027"],
		["New York and London on 14 March 2027", "London is 4 hours ahead of New York on March 14, 2027"],
		["Adelaide and Tokyo on 1 March 2027", "Adelaide is 1 hour 30 minutes ahead of Tokyo on March 1, 2027"],
		["Tokyo and Adelaide on 1 July 2027", "Adelaide is 30 minutes ahead of Tokyo on July 1, 2027"],
		["UTC+5:30 and London on 1 March 2027", "UTC+5:30 is 5 hours 30 minutes ahead of London on March 1, 2027"],
		["UTC+5:30 and London on 1 July 2027", "UTC+5:30 is 4 hours 30 minutes ahead of London on July 1, 2027"],
		["Tokyo and Seoul on 1 March 2027", "Seoul and Tokyo share the same UTC offset on March 1, 2027"],
		["London and Lisbon on 1 July 2027", "Lisbon and London share the same UTC offset on July 1, 2027"],
		["London and Tokyo on next friday", "Tokyo is 8 hours ahead of London on October 2, 2026"],
		["London and Tokyo on today", "Tokyo is 8 hours ahead of London on September 25, 2026"],
	])("time difference between %s", (rest, expected) => {
		expect(show(`time difference between ${rest}`)).toBe(expected);
	});

	test.each(["1 March 2027", "14 March 2027", "20 March 2027", "28 March 2027", "1 April 2027", "1 November 2027", "8 November 2027"])(
		"on %s it agrees with converting noon in London to New York on the same day",
		(date) => {
			const converted = show(`12pm London in New York on ${date}`);
			const hour = Number(/^(\d+):00 AM$/.exec(converted)?.[1]);
			expect(show(`time difference between London and New York on ${date}`)).toMatch(new RegExp(`^London is ${12 - hour} hours ahead`));
		},
	);

	test("the undated form still answers for now", () => {
		expect(show("time difference between London and Tokyo")).toBe("Tokyo is 8 hours ahead of London");
		expect(show("time difference between London and Lisbon")).toBe("Lisbon and London currently share the same UTC offset");
		expect(show("time in Tokyo")).toBe("8:00 PM");
	});

	test("it works in a document as on a single line", () => {
		const lines = e.parseDocument("time difference between London and New York on 20 March 2027\nx = 2").lines;
		expect(formatValue(lines[0].result!)).toBe("= London is 4 hours ahead of New York on March 20, 2027");
	});
});

describe("#697: time in and date in stay for now", () => {
	test.each(["time in Tokyo on 1 March 2027", "date in Tokyo on 1 March 2027", "time in Tokyo on today"])("%s is refused with the forms that answer it", (line) => {
		expect(() => e.evaluateExpression(line)).toThrow(/2pm London in Tokyo on 1 March 2027.*time difference between London and Tokyo on 1 March 2027/);
	});

	test("the refusal names the form it refuses", () => {
		expect(() => e.evaluateExpression("time in Tokyo on 1 March 2027")).toThrow(/^"time in" gives the time there now/);
		expect(() => e.evaluateExpression("date in Tokyo on 1 March 2027")).toThrow(/^"date in" gives the date there now/);
	});
});

describe("#697 adversarial", () => {
	test("an on clause that is not a date is refused as the dated conversion refuses it", () => {
		for (const line of ["time difference between London and Tokyo on 5", "time difference between London and Tokyo on 5 km", "time difference between London and Tokyo on true"]) {
			const result = e.evaluateExpression(line);
			expect(result.type).toBe(ValueType.Error);
			expect(result.value).toBe("TIME_ZONE_EXPECTED_DATE");
		}
	});

	test("a date that is not a real day says why, not that it is not a date", () => {
		const result = e.evaluateExpression("time difference between London and Tokyo on 29 February 2027");
		expect(result.type).toBe(ValueType.Error);
		expect(formatValue(result)).toMatch(/February 2027 has 28 days/);
	});

	test("an on with nothing after it is refused by name", () => {
		expect(() => e.evaluateExpression("time difference between London and Tokyo on")).toThrow(/Expected a date after "on"/);
	});

	test("a word naming an inherited property is not a zone or a date", () => {
		expect(() => e.evaluateExpression("time difference between London and constructor on 1 March 2027")).toThrow();
		expect(() => e.evaluateExpression("time difference between __proto__ and London on 1 March 2027")).toThrow();
		const onProto = (() => {
			try { return formatValue(e.evaluateExpression("time difference between London and Tokyo on __proto__")); } catch (err) { return (err as Error).message; }
		})();
		expect(onProto).not.toMatch(/\[object/);
		expect(onProto).not.toMatch(/ahead/);
	});

	test("on stays an ordinary word where no clause is asked for", () => {
		expect(e.parseDocument("on = 3\non * 2").lines.map((l) => formatValue(l.result!))).toEqual(["= 3", "= 6"]);
	});
});
