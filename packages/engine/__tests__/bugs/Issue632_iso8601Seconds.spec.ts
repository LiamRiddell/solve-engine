import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { asIso8601 } from "@solve-js/packages/datetime/parselets/DatetimeTimestampPluginFunctions";
import { ValueType, boolValue, datetimeValue, numberValue, stringValue, uomValue } from "@solve-js/vm/Value";

/**
 * Issue #632: `as iso8601` formatted `value.toNumber()` as epoch milliseconds
 * whatever the value was, so a Unix timestamp in seconds, the usual kind, was
 * read as milliseconds: `1710000000 as iso8601` gave a day in January 1970. It
 * now reads its argument as `to date` does, and refuses anything that is not a
 * date, a timestamp or ISO 8601 text.
 */

function show(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

describe("asIso8601", () => {
	test("a timestamp in seconds and in milliseconds name the same instant", () => {
		const seconds = asIso8601(numberValue(1710000000));
		const millis = asIso8601(numberValue(1710000000000));
		expect(seconds.type).toBe(ValueType.String);
		expect(seconds.value).toBe(millis.value);
		expect(String(seconds.value)).toMatch(/^2024-03-09T/);
	});

	test("either side of the seconds threshold", () => {
		expect(String(asIso8601(numberValue(999999999999)).value)).toMatch(/^33658-/);
		expect(String(asIso8601(numberValue(1000000000000)).value)).toMatch(/^2001-09-09T/);
	});

	test("a date is written as it is", () => {
		const jan1 = new Date(2026, 0, 1).getTime();
		expect(String(asIso8601(datetimeValue(jan1)).value)).toMatch(/^2026-01-01T00:00:00/);
	});

	test("ISO text is read, and other text refused with the to-date code", () => {
		expect(String(asIso8601(stringValue("2024-03-09")).value)).toMatch(/^2024-03-09T00:00:00/);
		expect(asIso8601(stringValue("hello")).errorCode).toBe("INVALID_ISO8601_STRING");
	});

	test.each([
		["a quantity", uomValue(5, "kg")],
		["money", uomValue(5, "USD")],
		["true or false", boolValue(true)],
	])("%s is refused by name", (_what, value) => {
		expect(asIso8601(value).errorCode).toBe("AS_ISO8601_NEEDS_DATE");
	});
});

describe("through the engine", () => {
	test.each([
		["1710000000 as iso8601", /^= 2024-03-09T/],
		["1 Jan 2026 as iso8601", /^= 2026-01-01T00:00:00/],
		["\"hello\" as iso8601", /is not a recognizable ISO8601 date\/time string$/],
		["5 kg as iso8601", /^as iso8601 writes a date, a Unix timestamp/],
		["[1, 2] as iso8601", /^as iso8601 writes a date, a Unix timestamp/],
	])("%s", (line, pattern) => {
		expect(show(line)).toMatch(pattern);
	});

	test.each(["2^53", "1e308", "-1e308", "0/0"])("adversarial: %s is past the calendar's reach, and refused rather than written as NaN", (n) => {
		expect(show(`(${n}) as iso8601`)).toBe("This timestamp is outside the dates the engine can hold, which reach about 273,000 years either side of 1970.");
		expect(newTrackedEngine().evaluateExpression(`(${n}) to date`).errorCode).toBe("DATE_OUT_OF_RANGE");
	});

	test("adversarial: 0 and a negative timestamp are instants, not refusals", () => {
		expect(show("0 as iso8601")).toMatch(/^= 1970-01-01T/);
		expect(show("-86400 as iso8601")).toMatch(/^= 1969-12-31T/);
	});
});
