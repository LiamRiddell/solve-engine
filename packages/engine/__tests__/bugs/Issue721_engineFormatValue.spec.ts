import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import {
	DEFAULT_FORMATTING_SETTINGS,
	mergeFormattingSettings,
	numberLocaleFor,
	resolveFormattingSettings,
	type FormattingOverrides,
	type FormattingSettings,
} from "@solve-js/format/FormattingSettings";
import { DATE_CALENDAR, dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { checkedClock } from "@solve-js/calendar/Clock";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { EngineError } from "@solve-js/errors/EngineError";

/**
 * Issue #721: `formatValue` did not know the engine's calendar. It writes a
 * date through `settings.calendar`, which is absent unless the host passes it,
 * so a date computed on a `Pacific/Kiritimati` engine was written in the host
 * process's zone, and `next friday` could print as a Thursday. The one-key
 * settings object the calendar option asks a host to pass (`{ calendar }`)
 * threw an uncoded TypeError, and the `Date` backend had no way to pin its
 * clock short of replacing `Date.now` for the whole process.
 *
 * The clock is pinned at 14:24:57 UTC on Friday 25 September 2026: Saturday
 * 26 September, 04:24:57, in Kiritimati (UTC+14), so the engine's day and the
 * day in any zone west of UTC+9:35 differ at that moment, on every run.
 */

const AT = Date.UTC(2026, 8, 25, 14, 24, 57);

function kiritimati() {
	const calendar = dateCalendarInZone("Pacific/Kiritimati", { now: () => AT });
	return { calendar, engine: newTrackedEngine({ calendar }) };
}

describe("engine.formatValue writes a date in the engine's own zone", () => {
	test.each([
		["next friday", "= Friday, October 2, 2026, 4:24:57 AM"],
		["today", "= Saturday, September 26, 2026, 4:24:57 AM"],
		["tomorrow", "= Sunday, September 27, 2026, 4:24:57 AM"],
		["3 October 2026", "= Saturday, October 3, 2026"],
	])("%s is %s", (line, expected) => {
		const { engine } = kiritimati();
		expect(engine.formatValue(engine.evaluateExpression(line))).toBe(expected);
	});

	test("it is formatValue with the engine's calendar, and the one-key settings object is enough", () => {
		const { calendar, engine } = kiritimati();
		for (const line of ["next friday", "today", "3 October 2026"]) {
			const value = engine.evaluateExpression(line);
			expect(formatValue(value, { calendar })).toBe(engine.formatValue(value));
			expect(formatValue(value, { ...DEFAULT_FORMATTING_SETTINGS, calendar })).toBe(engine.formatValue(value));
		}
	});

	test("overrides merge over the engine's settings, group by group", () => {
		const { engine } = kiritimati();
		const value = engine.evaluateExpression("next friday");
		expect(engine.formatValue(value, { dateResult: { format: "iso" } })).toBe("= 2026-10-02T04:24:57");
		expect(engine.formatValue(value, { dateResult: { format: "dmy" } })).toBe("= 02/10/2026 04:24:57");
		// An override naming another calendar is the host asking for another zone.
		expect(engine.formatValue(value, { calendar: dateCalendarInZone("UTC"), dateResult: { format: "iso" } })).toBe("= 2026-10-01T14:24:57");
	});

	test("a bare formatValue still reads the process zone, as it always has", () => {
		const { engine } = kiritimati();
		const value = engine.evaluateExpression("next friday");
		expect(formatValue(value)).toBe(formatValue(value, { ...DEFAULT_FORMATTING_SETTINGS, calendar: DATE_CALENDAR }));
	});

	test("an engine with no calendar formats as the bare formatter does", () => {
		const engine = newTrackedEngine({ calendar: DATE_CALENDAR });
		for (const line of ["3 October 2026", "1250.5", "£1250", "25%", "0xff"]) {
			const value = engine.evaluateExpression(line);
			expect(engine.formatValue(value)).toBe(formatValue(value));
		}
	});
});

describe("the engine's locale writes its numbers", () => {
	test("a de-DE engine writes 1.250,00 €", () => {
		const engine = newTrackedEngine({ locale: "de-DE", calendar: DATE_CALENDAR });
		const value = engine.evaluateExpression("€1250");
		// The symbol takes German's place after the amount (#755).
		expect(engine.formatValue(value)).toBe("= 1.250,00 €");
		expect(engine.formatValue(engine.evaluateExpression("€1.250"))).toBe("= 1.250,00 €");
		expect(formatValue(value)).toBe("= €1,250.00");
		expect(engine.getFormattingSettings().numberResult.decimalSeparatorLocale).toBe("de-DE");
	});

	test("the settings name the engine's calendar", () => {
		const { calendar, engine } = kiritimati();
		expect(engine.getFormattingSettings().calendar).toBe(calendar);
		expect(engine.getFormattingSettings({ floatResult: { decimalPlaces: 0 } }).floatResult).toEqual({ decimalPlaces: 0, enableSeperator: true });
	});
});

describe("a partial settings object merges with the defaults", () => {
	const engine = () => newTrackedEngine({ calendar: DATE_CALENDAR });
	test.each<[string, string, FormattingOverrides, string]>([
		["floatResult", "1234.5678", { floatResult: { decimalPlaces: 3 } }, "= 1,234.568"],
		["floatResult", "1234.5678", { floatResult: { enableSeperator: false } }, "= 1234.57"],
		["numberResult", "£1234.5", { numberResult: { decimalSeparatorLocale: "de-DE" } }, "= 1.234,50 £"],
		["hexResult", "255 as hex", { hexResult: { enablePadding: true, paddingZeros: 4 } }, "= 0x00FF"],
		["unitOfMeasurementResult", "3000 m", { unitOfMeasurementResult: { decimalPlaces: 0 } }, "= 3,000 m"],
		["percentageResult", "12.3456%", { percentageResult: { decimalPlaces: 1 } }, "= 12.3%"],
		["dateResult", "3 October 2026", { dateResult: { format: "iso" } }, "= 2026-10-03"],
		["calendar", "3 October 2026", { calendar: DATE_CALENDAR }, "= Saturday, October 3, 2026"],
	])("%s: %s with %j is %s", (_group, line, settings, expected) => {
		expect(formatValue(engine().evaluateExpression(line), settings)).toBe(expected);
	});

	test("an empty object is the defaults", () => {
		const value = engine().evaluateExpression("1234.5678");
		expect(formatValue(value, {})).toBe(formatValue(value));
	});

	test("a complete settings object is used as it is, and an edit in place is seen", () => {
		const value = engine().evaluateExpression("1234.5678");
		const settings: FormattingSettings = structuredClone({ ...DEFAULT_FORMATTING_SETTINGS });
		expect(formatValue(value, settings)).toBe("= 1,234.57");
		settings.floatResult.decimalPlaces = 1;
		expect(formatValue(value, settings)).toBe("= 1,234.6");
		expect(resolveFormattingSettings(settings)).toBe(settings);
	});
});

describe("dateCalendarInZone takes a clock", () => {
	test("a pinned clock pins today", () => {
		const calendar = dateCalendarInZone("UTC", { now: () => Date.UTC(2020, 0, 1) });
		const engine = newTrackedEngine({ calendar });
		expect(engine.formatValue(engine.evaluateExpression("today"))).toBe("= Wednesday, January 1, 2020");
		expect(calendar.now()).toBe(Date.UTC(2020, 0, 1));
	});

	test("no clock, or an undefined one, reads Date.now", () => {
		const before = Date.now();
		const reading = dateCalendarInZone("UTC", { now: undefined }).now();
		expect(reading).toBeGreaterThanOrEqual(before);
		expect(dateCalendarInZone("UTC").now()).toBeGreaterThanOrEqual(before);
	});
});

describe("the parts", () => {
	describe("checkedClock", () => {
		test("passes a good reading, truncated to a whole millisecond", () => {
			expect(checkedClock(() => AT, "test")()).toBe(AT);
			expect(checkedClock(() => 1.9, "test")()).toBe(1);
			expect(Object.is(checkedClock(() => -0.5, "test")(), 0)).toBe(true);
			expect(checkedClock(() => 8.64e15, "test")()).toBe(8.64e15);
			expect(checkedClock(() => -8.64e15, "test")()).toBe(-8.64e15);
		});

		test.each<[string, unknown]>([
			["NaN", () => Number.NaN],
			["Infinity", () => Number.POSITIVE_INFINITY],
			["past the range", () => 8.64e15 + 1],
			["a string", () => "2026-01-01"],
			["a bigint", () => 1n],
			["nothing", () => undefined],
			["a throw", () => { throw new Error("clock down"); }],
		])("refuses %s on the reading, with DATE_CLOCK_INVALID", (_name, clock) => {
			const read = checkedClock(clock, "test");
			let caught: unknown;
			try { read(); } catch (e) { caught = e; }
			expect(caught).toBeInstanceOf(EngineError);
			expect((caught as EngineError).code).toBe("DATE_CLOCK_INVALID");
			expect((caught as EngineError).message).toMatch(/^The clock given to test /);
		});

		test.each<[string, unknown]>([["a number", 5], ["a string", "now"], ["null", null], ["an object", {}]])(
			"refuses %s at once, not on first use",
			(_name, clock) => {
				expect(() => checkedClock(clock, "test")).toThrow(expect.objectContaining({ code: "DATE_CLOCK_INVALID" }));
			},
		);
	});

	describe("mergeFormattingSettings", () => {
		test("merges field by field and leaves the base alone", () => {
			const merged = mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS, { floatResult: { decimalPlaces: 0 } });
			expect(merged.floatResult).toEqual({ decimalPlaces: 0, enableSeperator: true });
			expect(merged.numberResult).toBe(DEFAULT_FORMATTING_SETTINGS.numberResult);
			expect(DEFAULT_FORMATTING_SETTINGS.floatResult.decimalPlaces).toBe(2);
		});

		test("nothing to merge answers the base itself", () => {
			expect(mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS)).toBe(DEFAULT_FORMATTING_SETTINGS);
			expect(mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS, null)).toBe(DEFAULT_FORMATTING_SETTINGS);
		});

		test("an undefined field keeps the base's value", () => {
			const merged = mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS, { floatResult: { decimalPlaces: undefined }, calendar: undefined });
			expect(merged.floatResult.decimalPlaces).toBe(2);
			expect(merged.calendar).toBeUndefined();
		});

		test("a group that is not an object, and a key that is not a group, are ignored", () => {
			const hostile = { floatResult: 5, numberResult: null, hexResult: [1, 2], somethingElse: { x: 1 } } as unknown as FormattingOverrides;
			const merged = mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS, hostile);
			expect(merged.floatResult).toEqual(DEFAULT_FORMATTING_SETTINGS.floatResult);
			expect(merged.numberResult).toEqual(DEFAULT_FORMATTING_SETTINGS.numberResult);
			expect(merged.hexResult).toEqual(DEFAULT_FORMATTING_SETTINGS.hexResult);
			expect(formatValue(newTrackedEngine().evaluateExpression("1234.5678"), hostile)).toBe("= 1,234.57");
		});

		test("prototype keys in an override reach no prototype", () => {
			expectPrototypeUntouched(() => {
				const hostile = JSON.parse('{"__proto__": {"polluted": 1}, "floatResult": {"__proto__": {"polluted": 1}, "constructor": 3, "decimalPlaces": 1}}') as FormattingOverrides;
				const merged = mergeFormattingSettings(DEFAULT_FORMATTING_SETTINGS, hostile);
				expect(merged.floatResult).toEqual({ decimalPlaces: 1, enableSeperator: true });
				expect(Object.getPrototypeOf(merged.floatResult)).toBe(Object.prototype);
				for (const word of PROTOTYPE_WORDS) {
					const settings = { [word]: { decimalPlaces: 9 } } as unknown as FormattingOverrides;
					expect(formatValue(newTrackedEngine().evaluateExpression("1.5"), settings)).toBe("= 1.50");
				}
			});
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		});
	});

	describe("resolveFormattingSettings", () => {
		test("absent, null or not an object is the defaults", () => {
			expect(resolveFormattingSettings()).toBe(DEFAULT_FORMATTING_SETTINGS);
			expect(resolveFormattingSettings(null)).toBe(DEFAULT_FORMATTING_SETTINGS);
			expect(resolveFormattingSettings("de-DE" as unknown as FormattingOverrides)).toBe(DEFAULT_FORMATTING_SETTINGS);
		});

		test("a complete object is itself; a partial one is merged", () => {
			const complete = { ...DEFAULT_FORMATTING_SETTINGS };
			expect(resolveFormattingSettings(complete)).toBe(complete);
			const partial = { floatResult: { decimalPlaces: 1, enableSeperator: true } };
			expect(resolveFormattingSettings(partial)).not.toBe(partial);
			// A group missing one required field is not complete.
			const almost = { ...DEFAULT_FORMATTING_SETTINGS, hexResult: { enablePadding: true } } as unknown as FormattingOverrides;
			expect(resolveFormattingSettings(almost).hexResult).toEqual({ enablePadding: true, paddingZeros: 0 });
		});
	});

	test("numberLocaleFor", () => {
		expect(numberLocaleFor("en")).toBe("en-US");
		expect(numberLocaleFor("EN")).toBe("en-US");
		expect(numberLocaleFor("de-DE")).toBe("de-DE");
		expect(numberLocaleFor("de-de")).toBe("de-DE");
		expect(numberLocaleFor("en-IN")).toBe("en-IN");
		for (const bad of ["", "xx", "__proto__", "constructor", "not a tag", 5, null, undefined]) {
			expect({ bad, locale: numberLocaleFor(bad) }).toEqual({ bad, locale: "en-US" });
		}
	});
});

describe("adversarial", () => {
	describe("security", () => {
		test("a clock that throws, or answers what is not a moment, is refused on the line that read it", () => {
			for (const now of [() => Number.NaN, () => Number.POSITIVE_INFINITY, () => 9e15, () => { throw new Error("boom"); }]) {
				const engine = newTrackedEngine({ calendar: dateCalendarInZone("UTC", { now: now as () => number }) });
				expect(() => engine.evaluateExpression("today")).toThrow(expect.objectContaining({ code: "DATE_CLOCK_INVALID" }));
				expect(engine.evaluateExpression("2 + 2").value).toBe(4);
			}
		});

		test("a clock that is not a function is refused when the backend is built", () => {
			for (const now of [5, "now", null, {}]) {
				expect(() => dateCalendarInZone("UTC", { now: now as unknown as () => number }))
					.toThrow(expect.objectContaining({ code: "DATE_CLOCK_INVALID" }));
			}
		});

		test("a zone name with space around it, or no name at all, is refused by name", () => {
			let caught: EngineError | undefined;
			try { dateCalendarInZone("Asia/Tokyo "); } catch (e) { caught = e as EngineError; }
			expect(caught?.code).toBe("DATE_ZONE_UNKNOWN");
			expect(caught?.message).toBe('dateCalendarInZone("Asia/Tokyo ") is not a time zone this runtime knows. The name has space around it; "Asia/Tokyo" is one.');
			for (const zone of [undefined, null, 5, "", " ", "__proto__", "Asia/Tokyo​"]) {
				expect(() => dateCalendarInZone(zone as unknown as string)).toThrow(expect.objectContaining({ code: "DATE_ZONE_UNKNOWN" }));
			}
		});
	});

	describe("realistic breakage", () => {
		test("a bad clock fails only the lines that read it, the same through both document passes", () => {
			const doc = "today\n2 + 2\n3 April 2026\nnow + 1 day";
			const calendar = dateCalendarInZone("UTC", { now: () => Number.NaN });
			const read = (lines: Array<{ result: { value: unknown } | null; errorCode?: string | null }>) =>
				lines.map((l) => l.errorCode ?? (l.result === null ? null : l.result.value));
			const batch = read(newTrackedEngine({ calendar }).parseDocument(doc).lines);
			const incremental = read(evaluateDocument(newTrackedEngine({ calendar }), doc).lines);
			expect(batch).toEqual(["DATE_CLOCK_INVALID", 4, Date.UTC(2026, 3, 3), "DATE_CLOCK_INVALID"]);
			expect(incremental).toEqual(batch);
		});

		test("the partial settings a host is most likely to write each format without throwing", () => {
			const value = newTrackedEngine().evaluateExpression("3 October 2026");
			for (const settings of [{ calendar: undefined }, { dateResult: {} }, { unitOfMeasurementResult: { currencyPlaces: "setting" as const } }]) {
				expect(formatValue(value, settings)).toBe("= Saturday, October 3, 2026");
			}
		});
	});

	describe("edge cases", () => {
		test("a clock at the edge of the range, and at the epoch", () => {
			const at = (ms: number) => {
				const calendar = dateCalendarInZone("UTC", { now: () => ms });
				const engine = newTrackedEngine({ calendar });
				return engine.formatValue(engine.evaluateExpression("today"), { dateResult: { format: "iso" } });
			};
			expect(at(0)).toBe("= 1970-01-01");
			expect(at(-0)).toBe("= 1970-01-01");
			expect(at(8.64e15)).toBe("= +275760-09-13");
		});

		test("the day boundary: one millisecond either side of midnight in Kiritimati", () => {
			// Midnight on Saturday 26 September 2026 in Kiritimati is 10:00 UTC on the 25th.
			const midnight = Date.UTC(2026, 8, 25, 10);
			const on = (ms: number) => {
				const engine = newTrackedEngine({ calendar: dateCalendarInZone("Pacific/Kiritimati", { now: () => ms }) });
				return engine.formatValue(engine.evaluateExpression("today"), { dateResult: { format: "iso" } });
			};
			expect(on(midnight - 1)).toBe("= 2026-09-25T23:59:59");
			expect(on(midnight)).toBe("= 2026-09-26");
		});
	});
});
