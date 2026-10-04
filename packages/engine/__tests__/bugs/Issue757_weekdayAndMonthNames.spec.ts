import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { FormattingOverrides } from "@solve-js/format/FormattingSettings";
import { localCalendarName } from "@solve-js/format/LocaleWords";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { Value, ValueType, stringValue } from "@solve-js/vm/Value";
import { serializeValue } from "@solve-js/worker/serialize";

/**
 * Issue #757 (the weekday and month part): `2026-03-10 as weekday` answered
 * the finished English string `Tuesday`, which a formatter could not localise,
 * so a German reader saw `Tuesday` beside `Dienstag, 10. März 2026`. The answer
 * is still that text, so comparisons and joins read it as before, and it now
 * records which weekday or month it names (`Value.calendarName`), which the
 * formatter writes in the reader's language.
 */

const under = (tag: string, extra: FormattingOverrides = {}): FormattingOverrides => ({ ...extra, numberResult: { decimalSeparatorLocale: tag } });

function shown(line: string, settings?: FormattingOverrides, engine = newTrackedEngine()): string {
	return formatValue(engine.evaluateExpression(line), settings);
}

describe("the issue's lines", () => {
	test.each([
		["2026-03-10 as weekday", "= Tuesday", "= Dienstag"],
		["2026-03-10 as month", "= March", "= März"],
		["day of the week on 2026-03-10", "= Tuesday", "= Dienstag"],
		["2026-12-25 as weekday", "= Friday", "= Freitag"],
	])("%s: %s in English, %s under de", (line, english, german) => {
		expect(shown(line)).toBe(english);
		expect(shown(line, under("de"))).toBe(german);
		expect(shown(line, under("de-DE"))).toBe(german);
		expect(shown(line, under("de", { wordsResult: { spelling: "engine" } }))).toBe(english);
	});

	test("the comparison the issue must not break still holds", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression('(2026-03-10 as weekday) == "Tuesday"').value).toBe(true);
		expect(engine.evaluateExpression('(2026-03-10 as month) == "March"').value).toBe(true);
		expect(engine.evaluateExpression("2026-03-10 as weekday").value).toBe("Tuesday");
	});

	test("the value records which name it is", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("2026-03-10 as weekday").calendarName).toEqual({ kind: "weekday", index: 2 });
		expect(engine.evaluateExpression("2026-03-10 as month").calendarName).toEqual({ kind: "month", index: 2 });
		expect(engine.evaluateExpression('"Tuesday"').calendarName).toBeUndefined();
	});
});

describe("the boundary", () => {
	test("text built from the name is new text, in English", () => {
		expect(shown('"on " + (2026-03-10 as weekday)', under("de"))).toBe("= on Tuesday");
	});

	test("a time in another zone and a time difference stay English text", () => {
		expect(shown("10:00 London in Tokyo on 2026-03-10", under("de"))).toBe("= 7:00 PM");
	});

	test("an English tag and a tag without data write the engine's names", () => {
		for (const tag of ["en-US", "en-GB", "xx"]) expect(shown("2026-03-10 as weekday", under(tag))).toBe("= Tuesday");
	});
});

describe("the name in other languages", () => {
	test.each([
		["fr", "weekday", "= mardi"],
		["pl", "month", "= marzec"],
		["ar", "weekday", "= الثلاثاء"],
		["ja", "month", "= 3月"],
	])("%s %s", (tag, kind, answer) => {
		expect(shown(`2026-03-10 as ${kind}`, under(tag))).toBe(answer);
	});
});

describe("the parts", () => {
	test("localCalendarName: every weekday and month in German", () => {
		expect(Array.from({ length: 7 }, (_, i) => localCalendarName("weekday", i, "de"))).toEqual(
			["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
		);
		expect(localCalendarName("month", 0, "de")).toBe("Januar");
		expect(localCalendarName("month", 11, "de")).toBe("Dezember");
	});

	test("localCalendarName declines what is out of range or not localised", () => {
		expect(localCalendarName("weekday", 7, "de")).toBeUndefined();
		expect(localCalendarName("month", 12, "de")).toBeUndefined();
		expect(localCalendarName("weekday", -1, "de")).toBeUndefined();
		expect(localCalendarName("weekday", 1.5, "de")).toBeUndefined();
		expect(localCalendarName("weekday", NaN, "de")).toBeUndefined();
		expect(localCalendarName("weekday", 2, "en-US")).toBeUndefined();
		expect(localCalendarName("weekday", 2, "xx")).toBeUndefined();
		for (const word of PROTOTYPE_WORDS) expect(localCalendarName("weekday", 2, word)).toBeUndefined();
	});

	test("the formatter falls back to the text when the recorded name is out of range", () => {
		const value = stringValue("Tuesday");
		value.calendarName = { kind: "weekday", index: 99 };
		expect(formatValue(value, under("de"))).toBe("= Tuesday");
	});

	test("clone carries the name and recycle clears it", () => {
		const value = new Value(ValueType.String, "March");
		value.calendarName = { kind: "month", index: 2 };
		expect(value.clone().calendarName).toEqual({ kind: "month", index: 2 });
		value.recycle(ValueType.String, "other");
		expect(value.calendarName).toBeUndefined();
		expect(formatValue(value, under("de"))).toBe("= other");
	});

	test("toJSON and the worker DTO carry the name as plain JSON", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("2026-03-10 as weekday");
		expect(value.toJSON()).toEqual({ type: ValueType.String, value: "Tuesday", calendarName: { kind: "weekday", index: 2 } });
		const dto = serializeValue(value, { ...engine.getFormattingSettings(), numberResult: { decimalSeparatorLocale: "de" } });
		expect(dto.text).toBe("= Dienstag");
		expect(dto.calendarName).toEqual({ kind: "weekday", index: 2 });
		expect(structuredClone(dto)).toEqual(dto);
		expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
	});
});

describe("adversarial", () => {
	test("security: prototype words and look-alike text as the date are refused honestly", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("X as weekday", PROTOTYPE_WORDS)) expectHonestLine(line);
			for (const line of fill("X as month", TEXT_EDGES)) expectHonestLine(line);
		});
	});

	test("realistic: a variable holding the name keeps it, through both document passes", () => {
		const doc = "day = 2026-03-10 as weekday\nday\nday == \"Tuesday\"";
		const engine = newTrackedEngine();
		const batch = engine.parseDocument(doc).lines.map((line) => (line.result ? formatValue(line.result, under("de")) : ""));
		const live = evaluateDocument(newTrackedEngine(), doc).lines.map((line) => (line.result ? formatValue(line.result, under("de")) : ""));
		expect(batch).toEqual(["= Dienstag", "= Dienstag", "= true"]);
		expect(live).toEqual(batch);
	});

	test("realistic: a snapshot round trip keeps the name, and a malformed one is refused by name", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("day = 2026-03-10 as weekday");
		const json = JSON.stringify(engine.toJSON());
		expect(json).toContain('"cn":{"kind":"weekday","index":2}');
		const restored = ExpressionEngine.fromJSON(JSON.parse(json), { packages: BUILTIN_PACKAGES });
		try {
			expect(formatValue(restored.evaluateExpression("day"), under("de"))).toBe("= Dienstag");
		} finally {
			restored.clear();
		}
		for (const bad of ['{"kind":"weekday","index":9}', '{"kind":"year","index":1}', '{"kind":"month","index":-1}', '"Tuesday"']) {
			const hostile = JSON.parse(json.replace('{"kind":"weekday","index":2}', bad));
			expect(() => ExpressionEngine.fromJSON(hostile, { packages: BUILTIN_PACKAGES })).toThrow(/cn/);
		}
	});

	test("edges: a leap day, a year end and a date before 1970", () => {
		expect(shown("2024-02-29 as weekday", under("de"))).toBe("= Donnerstag");
		expect(shown("2026-12-31 as month", under("de"))).toBe("= Dezember");
		expect(shown("1969-07-20 as weekday", under("de"))).toBe("= Sonntag");
	});
});
