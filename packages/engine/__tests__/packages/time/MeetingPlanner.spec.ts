/**
 * The meeting planner (#518): one clock time shown in several zones, and the
 * stretch of the day that falls inside the same hours in several places.
 *
 * What was wrong: every timezone form took one time and one target, and a
 * line naming more failed to parse.
 *
 *     expression                                         before                     now
 *     3pm London in Tokyo, New York and Sydney           Unexpected token ","       Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day)
 *     3pm London in Tokyo and New York                   No prefix parselet ...     Tokyo 11:00 PM, New York 10:00 AM
 *     overlap of 9am to 5pm in London and New York       No prefix parselet ...     3 hours: London 2:00 PM to 5:00 PM, New York 9:00 AM to 12:00 PM
 *
 * And a line could not say which day it meant, so every answer moved with
 * daylight saving: `3pm London in New York` is 10am in September and 11am for
 * three weeks in March. `on <date>` fixes the day, which is also what makes
 * every expectation below a fixed string.
 *
 * Every expectation is either on a named date, or on today with the clock
 * pinned at an instant that is the same calendar day in all three zones
 * `npm run test:temporal` runs this suite in, and on both calendar backends.
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Value, ValueType } from "@solve-js/vm/Value";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { encodeFixedOffset, wallClockInstants, describeMinutes } from "@solve-js/packages/time/timezones/ZoneMath";
import { MAX_ZONES_PER_LINE } from "@solve-js/packages/time/parselets/shared/ZoneReference";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The one Value a line evaluates to, through the single-expression path. */
function evaluate(expression: string): Value {
	return newTrackedEngine().evaluateLine(1, expression);
}

/** The string a line answers, failing loudly when it answers anything else. */
function answer(expression: string): string {
	const value = evaluate(expression);
	expect({ expression, type: value.type, message: value.type === ValueType.Error ? value.unit : undefined })
		.toEqual({ expression, type: ValueType.String, message: undefined });
	return value.value as string;
}

/** The code of the Error value a line refuses with. */
function refusal(expression: string): { code: unknown; message: unknown } {
	const value = evaluate(expression);
	expect(value.type).toBe(ValueType.Error);
	return { code: value.value, message: value.unit };
}

/** The code of the parse error a line throws. */
function parseErrorCode(expression: string): string | undefined {
	try {
		evaluate(expression);
	} catch (error) {
		return (error as { code?: string }).code;
	}
	return undefined;
}

describe("one time in several zones", () => {
	test("a list of targets answers each, labelled with the name the reader used", () => {
		expect(answer("3pm London on 23 September 2026 in Tokyo, New York and Sydney"))
			.toBe("Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day)");
	});

	test("the date may come at the end instead", () => {
		expect(answer("3pm London in Tokyo, New York and Sydney on 23 September 2026"))
			.toBe("Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day)");
	});

	test("a serial comma, a bare and, and an ISO date read the same", () => {
		const expected = "Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day)";
		expect(answer("3pm London on 23 September 2026 in Tokyo, New York, and Sydney")).toBe(expected);
		expect(answer("3pm London on 2026-09-23 in Tokyo and New York and Sydney")).toBe(expected);
	});

	test("one dated target answers as the undated form does, with no label", () => {
		expect(answer("3pm London on 23 September 2026 in Tokyo")).toBe("11:00 PM");
		expect(answer("3pm London in Tokyo on 23 September 2026")).toBe("11:00 PM");
	});

	test("a target behind the source carries a backward day shift", () => {
		expect(answer("9am Tokyo on 23 September 2026 in London and San Francisco"))
			.toBe("London 1:00 AM, San Francisco 5:00 PM (-1 day)");
	});

	test("abbreviations and signed offsets work as list entries and keep their own labels", () => {
		expect(answer("3pm JST on 23 September 2026 in EST and CET")).toBe("EST 2:00 AM, CET 8:00 AM");
		expect(answer("3pm GMT+9 in Tokyo, UTC-5 and London on 23 September 2026"))
			.toBe("Tokyo 3:00 PM, UTC-5 1:00 AM, London 7:00 AM");
	});

	test("the result is an ordinary value a variable can hold", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "call = 3pm London on 23 September 2026 in Tokyo and New York");
		expect(engine.evaluateLine(2, "call").value).toBe("Tokyo 11:00 PM, New York 10:00 AM");
	});
});

describe("daylight saving, which is why the day matters", () => {
	test("New York changes three weeks before London, so the gap is four hours in March", () => {
		expect(answer("3pm London on 1 March 2026 in New York")).toBe("10:00 AM");
		expect(answer("3pm London on 20 March 2026 in New York")).toBe("11:00 AM");
		expect(answer("3pm London on 23 September 2026 in New York")).toBe("10:00 AM");
	});

	test("the southern hemisphere changes the other way", () => {
		// Sydney goes forward on 4 October 2026, while London is still on
		// summer time: the gap grows from nine hours to ten.
		expect(answer("9am Sydney on 1 October 2026 in London")).toBe("12:00 AM");
		expect(answer("9am Sydney on 5 October 2026 in London")).toBe("11:00 PM (-1 day)");
	});

	test("a reading either side of a change is converted on its own side", () => {
		// London goes forward at 1am on 29 March 2026 and back at 2am on 25
		// October 2026.
		expect(answer("12:30am London on 29 March 2026 in Tokyo")).toBe("9:30 AM");
		expect(answer("2:30am London on 29 March 2026 in Tokyo")).toBe("10:30 AM");
		expect(answer("2:30am London on 25 October 2026 in Tokyo")).toBe("11:30 AM");
	});

	test("a time the clocks skipped is refused, and says why", () => {
		expect(refusal("1:30am London on 29 March 2026 in Tokyo")).toEqual({
			code: "TIME_ZONE_SKIPPED_TIME",
			message: "1:30 AM did not happen in London on March 29, 2026: the clocks went forward past it",
		});
		expect(refusal("2:30am New York on 8 March 2026 in London").code).toBe("TIME_ZONE_SKIPPED_TIME");
	});

	test("a time the clocks repeated is refused, since it names two moments", () => {
		expect(refusal("1:30am London on 25 October 2026 in Tokyo")).toEqual({
			code: "TIME_ZONE_REPEATED_TIME",
			message: "1:30 AM happened twice in London on October 25, 2026, when the clocks went back, so it names no single moment",
		});
		expect(refusal("2:30am Auckland on 5 April 2026 in London").code).toBe("TIME_ZONE_REPEATED_TIME");
	});
});

describe("the overlap of the same hours in several places", () => {
	test("London and New York share three hours in September", () => {
		expect(answer("overlap of 9am to 5pm in London and New York on 23 September 2026"))
			.toBe("3 hours: London 2:00 PM to 5:00 PM, New York 9:00 AM to 12:00 PM");
	});

	test("the hyphenated and the 24-hour spellings of the hours read the same", () => {
		const expected = "3 hours: London 2:00 PM to 5:00 PM, New York 9:00 AM to 12:00 PM";
		expect(answer("overlap of 9am-5pm in London and New York on 23 September 2026")).toBe(expected);
		expect(answer("overlap of 09:00-17:00 in London and New York on 23 September 2026")).toBe(expected);
		expect(answer("overlap of 09:00 to 17:00 in London, and New York on 23 September 2026")).toBe(expected);
	});

	test("each further place cuts the stretch down", () => {
		expect(answer("overlap of 9am to 5pm in London, Paris and New York on 23 September 2026"))
			.toBe("2 hours: London 2:00 PM to 4:00 PM, Paris 3:00 PM to 5:00 PM, New York 9:00 AM to 11:00 AM");
	});

	test("the stretch follows daylight saving, day by day", () => {
		expect(answer("overlap of 9am to 5pm in London and New York on 7 March 2026"))
			.toBe("3 hours: London 2:00 PM to 5:00 PM, New York 9:00 AM to 12:00 PM");
		// New York has gone forward, London has not.
		expect(answer("overlap of 9am to 5pm in London and New York on 8 March 2026"))
			.toBe("4 hours: London 1:00 PM to 5:00 PM, New York 9:00 AM to 1:00 PM");
		expect(answer("overlap of 9am to 5pm in London and New York on 20 March 2026"))
			.toBe("4 hours: London 1:00 PM to 5:00 PM, New York 9:00 AM to 1:00 PM");
	});

	test("a change inside the hours makes the stretch an hour shorter, as lived", () => {
		// Both go forward at 01:00 UTC on 29 March 2026: London's night from
		// midnight to 6am is five hours long that day.
		expect(answer("overlap of 12am to 6am in London and Paris on 29 March 2026"))
			.toBe("4 hours: London 12:00 AM to 5:00 AM, Paris 1:00 AM to 6:00 AM");
	});

	test("across the date line the matching hours are on the other place's yesterday", () => {
		expect(answer("overlap of 8am to 6pm in Tokyo and San Francisco on 23 September 2026"))
			.toBe("2 hours: Tokyo 8:00 AM to 10:00 AM, San Francisco 4:00 PM to 6:00 PM (-1 day)");
	});

	test("the first place's day is the one read, so the order names the day", () => {
		expect(answer("overlap of 8am to 6pm in San Francisco and Tokyo on 23 September 2026"))
			.toBe("2 hours: San Francisco 4:00 PM to 6:00 PM, Tokyo 8:00 AM to 10:00 AM (+1 day)");
	});

	test("hours that run past midnight are one stretch", () => {
		expect(answer("overlap of 10pm to 6am in London and New York on 23 September 2026"))
			.toBe("3 hours: London 3:00 AM to 6:00 AM, New York 10:00 PM to 1:00 AM (-1 day)");
	});

	test("hours longer than twelve can meet twice, and both stretches are given", () => {
		expect(answer("overlap of 5am to 11pm in London and Tokyo on 23 September 2026"))
			.toBe("12 hours: London 5:00 AM to 3:00 PM, Tokyo 1:00 PM to 11:00 PM; London 9:00 PM to 11:00 PM, Tokyo 5:00 AM to 7:00 AM (+1 day)");
	});

	test("a half-hour zone gives a length in hours and minutes", () => {
		expect(answer("overlap of 9:30am to 5:30pm in Mumbai and London on 23 September 2026"))
			.toBe("3 hours 30 minutes: Mumbai 2:00 PM to 5:30 PM, London 9:30 AM to 1:00 PM");
	});

	test("two names for one zone share all of the hours", () => {
		expect(answer("overlap of 9am to 5pm in Seattle and Los Angeles on 23 September 2026"))
			.toBe("8 hours: Seattle 9:00 AM to 5:00 PM, Los Angeles 9:00 AM to 5:00 PM");
	});

	test("no shared stretch is an answer, said in words", () => {
		// London's 5pm is Tokyo's 1am: the two only touch at an instant.
		expect(answer("overlap of 9am to 5pm in London and Tokyo on 23 September 2026"))
			.toBe("No overlap between London and Tokyo");
		expect(answer("overlap of 9am to 5pm in London, New York and Tokyo on 23 September 2026"))
			.toBe("No overlap between London, New York and Tokyo");
	});

	test("a bare overlap is still an ordinary variable name", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "overlap = 5");
		expect(engine.evaluateLine(2, "overlap * 2").toNumber()).toBe(10);
	});
});

describe("refusals", () => {
	test("an overlap needs two places", () => {
		expect(refusal("overlap of 9am to 5pm in London on 23 September 2026").code).toBe("OVERLAP_NEEDS_TWO_ZONES");
	});

	test("hours that start where they end have no length", () => {
		expect(refusal("overlap of 9am to 9am in London and Paris on 23 September 2026")).toEqual({
			code: "OVERLAP_HOURS_EMPTY",
			message: "9:00 AM to 9:00 AM has no length, so no time falls inside it",
		});
	});

	test("on takes a date, and says so when given something else", () => {
		expect(refusal("3pm London on 5 in Tokyo").code).toBe("TIME_ZONE_EXPECTED_DATE");
		expect(refusal("3pm London in Tokyo and Paris on 5").code).toBe("TIME_ZONE_EXPECTED_DATE");
		expect(refusal("overlap of 9am to 5pm in London and Paris on 5").code).toBe("TIME_ZONE_EXPECTED_DATE");
	});

	test("malformed lines are parse errors with their own codes", () => {
		expect(parseErrorCode("overlap of 9-5 in London and Paris")).toBe("OVERLAP_EXPECTED_HOURS");
		expect(parseErrorCode("overlap of 9am to 5pm London and Paris")).toBe("OVERLAP_EXPECTED_IN");
		expect(parseErrorCode("overlap of 9am to 5pm in")).toBe("OVERLAP_EXPECTED_CITY");
		expect(parseErrorCode("3pm London on in Tokyo")).toBe("TIME_ZONE_MISSING_DATE");
		expect(parseErrorCode("3pm London in Tokyo on")).toBe("TIME_ZONE_MISSING_DATE");
	});

	test("an unknown place after and is named, not reported as a variable", () => {
		expect(parseErrorCode("overlap of 9am to 5pm in London and Atlantis")).toBe("TIME_ZONE_UNKNOWN");
		expect(parseErrorCode("3pm London in Tokyo and Atlantis")).toBe("TIME_ZONE_UNKNOWN");
	});

	test("a list longer than a line can carry is refused by name", () => {
		const many = Array.from({ length: MAX_ZONES_PER_LINE + 1 }, () => "Tokyo").join(", ");
		expect(parseErrorCode(`3pm London in ${many}`)).toBe("TIME_ZONE_TOO_MANY");
		expect(parseErrorCode(`overlap of 9am to 5pm in London, ${many}`)).toBe("TIME_ZONE_TOO_MANY");
		const most = Array.from({ length: MAX_ZONES_PER_LINE }, () => "Tokyo").join(", ");
		expect(evaluate(`3pm London on 23 September 2026 in ${most}`).type).toBe(ValueType.String);
	});
});

describe("undated lines read today", () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	// 06:00 UTC on 23 September 2026 is the 23rd in London, New York and
	// Auckland, the three zones the Temporal run uses, so today is one day
	// whichever of them the host is in.
	const SEPTEMBER = "2026-09-23T06:00:00Z";

	test("a list of targets on today matches the same list on that date", () => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date(SEPTEMBER));
		expect(answer("3pm London in Tokyo, New York and Sydney"))
			.toBe("Tokyo 11:00 PM, New York 10:00 AM, Sydney 12:00 AM (+1 day)");
		expect(answer("3pm London in Tokyo and New York")).toBe("Tokyo 11:00 PM, New York 10:00 AM");
	});

	test("the overlap on today matches the overlap on that date", () => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date(SEPTEMBER));
		expect(answer("overlap of 9am to 5pm in London and New York"))
			.toBe("3 hours: London 2:00 PM to 5:00 PM, New York 9:00 AM to 12:00 PM");
	});

	test("the single-target form is unchanged", () => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date(SEPTEMBER));
		expect(answer("3pm London in Tokyo")).toBe("11:00 PM");
		expect(answer("6pm Sydney in Chicago")).toBe("3:00 AM");
	});

	test("the single-target form refuses a skipped time on the day it is skipped", () => {
		// 09:00 UTC on 29 March 2026 is the 29th in all three zones.
		jest.useFakeTimers();
		jest.setSystemTime(new Date("2026-03-29T09:00:00Z"));
		expect(refusal("1:30am London in Tokyo").code).toBe("TIME_ZONE_SKIPPED_TIME");
	});
});

describe("the arithmetic underneath", () => {
	const at = (iso: string): number => Date.parse(iso);

	test("an ordinary reading names one instant", () => {
		expect(wallClockInstants(2026, 8, 23, 15 * 60, "Europe/London", DATE_CALENDAR)).toEqual([at("2026-09-23T14:00:00Z")]);
	});

	test("a skipped reading names none", () => {
		expect(wallClockInstants(2026, 2, 29, 90, "Europe/London", DATE_CALENDAR)).toEqual([]);
	});

	test("a repeated reading names two, an hour apart, earliest first", () => {
		expect(wallClockInstants(2026, 9, 25, 90, "Europe/London", DATE_CALENDAR))
			.toEqual([at("2026-10-25T00:30:00Z"), at("2026-10-25T01:30:00Z")]);
	});

	test("a fixed offset has no transitions", () => {
		expect(wallClockInstants(2026, 2, 29, 90, encodeFixedOffset(540), DATE_CALENDAR)).toEqual([at("2026-03-28T16:30:00Z")]);
	});

	test("lengths are written in hours and minutes", () => {
		expect(describeMinutes(180)).toBe("3 hours");
		expect(describeMinutes(90)).toBe("1 hour 30 minutes");
		expect(describeMinutes(45)).toBe("45 minutes");
		expect(describeMinutes(61)).toBe("1 hour 1 minute");
	});
});
