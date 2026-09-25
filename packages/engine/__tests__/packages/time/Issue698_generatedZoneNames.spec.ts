/**
 * #698: a name for every place in the IANA time zone database, generated at
 * build time beneath the hand-written table.
 *
 * `time in Kathmandu`, `Kolkata` and `Hobart` were refused because the table
 * was written by hand and held about ninety cities. The generated table
 * (`calendar/generated/ZoneNames.generated.ts`, from
 * `scripts/generate-zone-names.mjs`) adds the rest. These tests read the new
 * names through every form that reads a zone, check the legacy and current
 * spellings agree, that the hand-written entries still win, that the names
 * left out stay out, and that no generated name takes a word the engine reads
 * as something else.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { RecordingCalendar } from "@tools/recordingCalendar";
import { calendarUnderTest, temporalCalendarForTests } from "@tools/temporalTestKit";
import { formatValue } from "@solve-js/format/FormatEngine";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { ValueType } from "@solve-js/vm/Value";
import { GENERATED_ZONE_NAMES, GENERATED_MULTI_WORD_ZONE_NAMES } from "@solve-js/calendar/generated/ZoneNames.generated";
import { CITY_TO_IANA_ZONE, MULTI_WORD_CITY_ZONES, ZONE_LOOKUP, resolveZoneName } from "@solve-js/calendar/ZoneNames";

/** An engine on a pinned clock: noon UTC on Wednesday 11 March 2026. */
function engine() {
	const inner = calendarUnderTest() === "temporal" ? temporalCalendarForTests({ timeZone: "Europe/London" }) : dateCalendarInZone("Europe/London");
	return newTrackedEngine({ config: { network: { enabled: false } }, calendar: new RecordingCalendar(Date.parse("2026-03-11T12:00:00Z"), inner) });
}

const e = engine();
const show = (line: string): string => formatValue(e.evaluateExpression(line)).replace(/^=\s*/, "");

describe("#698: a generated name in each form that reads a zone", () => {
	test.each([
		["time in Kathmandu", "5:45 PM"],
		["time in Kolkata", "5:30 PM"],
		["time in Hobart", "11:00 PM"],
		["time in Ho Chi Minh", "7:00 PM"],
		["time in Dar es Salaam", "3:00 PM"],
		["time in Port au Prince", "8:00 AM"],
		["time in St Johns", "9:30 AM"],
		["date in Apia", "March 12, 2026"],
		["time difference between Kathmandu and Kolkata", "Kathmandu is 15 minutes ahead of Kolkata"],
		["3pm London on 1 March 2027 in Hobart", "2:00 AM (+1 day)"],
		["3pm London on 1 March 2027 in Kathmandu and Isle of Man", "Kathmandu 8:45 PM, Isle Of Man 3:00 PM"],
	])("%s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});

	test("a date in a generated zone reads through the VM's own zone lookup", () => {
		expect(resolveZoneName("Kathmandu")).toBe("Asia/Kathmandu");
		expect(e.evaluateExpression("2026-04-03 in Ho Chi Minh").type).toBe(ValueType.Datetime);
	});
});

describe("#698: a renamed place answers to both names", () => {
	test.each([
		["Calcutta", "Kolkata"],
		["Katmandu", "Kathmandu"],
		["Saigon", "Ho Chi Minh"],
		["Rangoon", "Yangon"],
		["Kiev", "Kyiv"],
		["Godthab", "Nuuk"],
		["Asmera", "Asmara"],
	])("%s and %s", (old, current) => {
		expect(show(`time in ${old}`)).toBe(show(`time in ${current}`));
		expect(resolveZoneName(old)).toBe(resolveZoneName(current));
	});

	test("the current identifier is the one stored, not ICU's older spelling", () => {
		expect(GENERATED_ZONE_NAMES.calcutta).toBe("Asia/Kolkata");
		expect(GENERATED_ZONE_NAMES.saigon).toBe("Asia/Ho_Chi_Minh");
		expect(GENERATED_MULTI_WORD_ZONE_NAMES["ho chi minh"]).toBe("Asia/Ho_Chi_Minh");
	});
});

describe("#698: the hand-written table takes precedence", () => {
	test("San Juan is Puerto Rico, not the Argentine province", () => {
		expect(ZONE_LOOKUP["san juan"]).toBe("America/Puerto_Rico");
		// Puerto Rico is four hours behind London in March; the Argentine San Juan is three.
		expect(show("time difference between San Juan and London")).toBe("London is 4 hours ahead of San Juan");
	});

	test("every hand-written name resolves to its own entry", () => {
		for (const [name, zone] of Object.entries({ ...CITY_TO_IANA_ZONE, ...MULTI_WORD_CITY_ZONES })) {
			expect([name, ZONE_LOOKUP[name]]).toEqual([name, zone]);
		}
	});
});

describe("#698 adversarial: the names left out, and the words kept", () => {
	test.each(["Easter", "Christmas", "Reunion", "Wake", "Center", "Petersburg", "Cordoba", "Chatham", "Norfolk", "Davis", "Casey", "Palmer", "McMurdo", "Oral"])(
		"%s is not read as a place",
		(name) => {
			expect(() => e.evaluateExpression(`time in ${name}`)).toThrow(/Expected a city or zone name/);
			expect(resolveZoneName(name)).toBeNull();
		},
	);

	test("no generated single-word name is a unit, a keyword or anything but a plain word", () => {
		const taken = Object.keys(GENERATED_ZONE_NAMES).filter((name) => {
			const tokens = e.tokenizeForClassification(name);
			return tokens.length !== 1 || tokens[0].type !== "IDENT";
		});
		expect(taken).toEqual([]);
	});

	test("every generated multi-word name fuses to one place token", () => {
		const unfused = Object.keys(GENERATED_MULTI_WORD_ZONE_NAMES).filter((name) => {
			const tokens = e.tokenizeForClassification(name);
			return tokens.length !== 1 || tokens[0].type !== "CITY_NAME";
		});
		expect(unfused).toEqual([]);
	});

	test("every generated zone is one the calendar backend can compute in", () => {
		const refused = [...Object.keys(GENERATED_ZONE_NAMES), ...Object.keys(GENERATED_MULTI_WORD_ZONE_NAMES)].filter((name) => {
			const value = e.evaluateExpression(`time in ${name}`);
			return value.type !== ValueType.String;
		});
		expect(refused).toEqual([]);
	});

	test("a hyphenated spelling is not read as the place, it is subtraction", () => {
		expect(() => e.evaluateExpression("time in Port-au-Prince")).toThrow();
		expect(() => e.evaluateExpression("time in Asia/Kathmandu")).toThrow();
	});

	test("a word naming an inherited property is not a place", () => {
		for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
			expect(resolveZoneName(name)).toBeNull();
			expect(() => e.evaluateExpression(`time in ${name}`)).toThrow(/Expected a city or zone name/);
		}
	});

	test("single-word place names stay free as variable names", () => {
		const doc = engine().parseDocument("kathmandu = 4\nkathmandu * 2\nhobart = 3\nhobart + kathmandu");
		expect(doc.lines.map((l) => formatValue(l.result!))).toEqual(["= 4", "= 8", "= 3", "= 7"]);
	});

	test("a line that was prose stays prose", () => {
		for (const line of ["the port of spain is busy", "5 st thomas"]) {
			expect(() => e.evaluateExpression(line)).toThrow();
		}
	});
});
