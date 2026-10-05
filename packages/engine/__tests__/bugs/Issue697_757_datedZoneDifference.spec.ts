/**
 * #697 meets #757: a dated time difference is the same kind of answer as the
 * undated one, a length of time in hours carrying its two places, and now the
 * day it was read on. The day survives every way a value travels (a variable,
 * `toJSON`, the worker DTO, a snapshot), and the undated gap carries no day.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { RecordingCalendar } from "@tools/recordingCalendar";
import { calendarUnderTest, temporalCalendarForTests } from "@tools/temporalTestKit";
import { formatValue } from "@solve-js/format/FormatEngine";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ValueType, copyZoneDifference, uomValue } from "@solve-js/vm/Value";
import { zoneDifferenceText } from "@solve-js/vm/ZoneAnswers";
import { serializeValue } from "@solve-js/worker/serialize";

/** An engine whose clock is stopped at noon on 25 September 2026, in London. */
function engine() {
	const inner = calendarUnderTest() === "temporal" ? temporalCalendarForTests({ timeZone: "Europe/London" }) : dateCalendarInZone("Europe/London");
	const calendar = new RecordingCalendar(Date.parse("2026-09-25T11:00:00Z"), inner);
	return newTrackedEngine({ config: { network: { enabled: false } }, calendar });
}

const DATED = "time difference between London and Tokyo on 1 March 2027";

describe("the dated gap is a duration with its day", () => {
	test("it is a length of time in hours, with its places and its day", () => {
		const v = engine().evaluateExpression(DATED);
		expect(v.type).toBe(ValueType.Uom);
		expect(v.unit).toBe("hours");
		expect(v.value).toBe(9);
		expect(v.zoneDifference).toEqual({ from: "London", to: "Tokyo", on: "March 1, 2027" });
	});

	test("it converts and computes as a duration", () => {
		const e = engine();
		expect(formatValue(e.evaluateExpression(`${DATED} in hours`))).toBe("= 9 hours");
		expect(formatValue(e.evaluateExpression(`${DATED} in minutes`))).toBe("= 540 minutes");
	});

	test("the undated gap carries no day", () => {
		const v = engine().evaluateExpression("time difference between London and Tokyo");
		expect(v.zoneDifference).toEqual({ from: "London", to: "Tokyo" });
		expect(Object.prototype.hasOwnProperty.call(v.zoneDifference, "on")).toBe(false);
	});

	test("a variable holding it keeps the day, through both document passes", () => {
		const e = engine();
		const text = `gap = ${DATED}\ngap`;
		const batch = e.parseDocument(text).lines.map((l) => formatValue(l.result!));
		expect(batch[1]).toBe("= Tokyo is 9 hours ahead of London on March 1, 2027");
		expect(evaluateDocument(e, text).lines.map((l) => formatValue(l.result!))).toEqual(batch);
	});

	test("toJSON, the worker DTO and a snapshot keep the day", () => {
		const e = engine();
		const v = e.evaluateExpression(DATED);
		expect(v.toJSON()).toMatchObject({ zoneDifference: { from: "London", to: "Tokyo", on: "March 1, 2027" } });
		expect(serializeValue(v).zoneDifference).toEqual({ from: "London", to: "Tokyo", on: "March 1, 2027" });
		e.parseDocument(`gap = ${DATED}`);
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(e.toJSON())), { packages: BUILTIN_PACKAGES });
		try {
			expect(formatValue(restored.evaluateExpression("gap"))).toBe("= Tokyo is 9 hours ahead of London on March 1, 2027");
		} finally {
			restored.clear();
		}
	});

	test("a snapshot whose day is not text is refused by name", () => {
		const e = engine();
		e.parseDocument(`gap = ${DATED}`);
		const json = JSON.stringify(e.toJSON()).replace('"on":"March 1, 2027"', '"on":5');
		expect(json).toContain('"on":5');
		expect(() => ExpressionEngine.fromJSON(JSON.parse(json), { packages: BUILTIN_PACKAGES })).toThrow(/\.zd/);
	});

	test("under a locale with words of its own the day stays beside the gap", () => {
		const v = engine().evaluateExpression(DATED);
		const shown = formatValue(v, { ...engine().getFormattingSettings(), numberResult: { ...engine().getFormattingSettings().numberResult, decimalSeparatorLocale: "de" } });
		expect(shown).toContain("(March 1, 2027)");
		expect(shown).not.toMatch(/undefined|\[object/);
	});
});

describe("the parts", () => {
	test("copyZoneDifference keeps the day only when there is one", () => {
		expect(copyZoneDifference({ from: "a", to: "b" })).toEqual({ from: "a", to: "b" });
		expect(Object.keys(copyZoneDifference({ from: "a", to: "b" }))).toEqual(["from", "to"]);
		expect(copyZoneDifference({ from: "a", to: "b", on: "" })).toEqual({ from: "a", to: "b", on: "" });
		const original = { from: "a", to: "b", on: "c" };
		const copy = copyZoneDifference(original);
		expect(copy).toEqual(original);
		expect(copy).not.toBe(original);
	});

	test("zoneDifferenceText writes the day after the gap, and after a shared offset", () => {
		const gap = uomValue(-1.5, "hours");
		gap.zoneDifference = { from: "Adelaide", to: "Tokyo", on: "March 1, 2027" };
		expect(zoneDifferenceText(gap)).toBe("Adelaide is 1 hour 30 minutes ahead of Tokyo on March 1, 2027");
		const none = uomValue(-0, "hours");
		none.zoneDifference = { from: "Tokyo", to: "Seoul", on: "March 1, 2027" };
		expect(zoneDifferenceText(none)).toBe("Seoul and Tokyo share the same UTC offset on March 1, 2027");
		none.zoneDifference = { from: "Tokyo", to: "Seoul" };
		expect(zoneDifferenceText(none)).toBe("Seoul and Tokyo currently share the same UTC offset");
	});

	test("a day named like an inherited property is only text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const gap = uomValue(1, "hours");
				gap.zoneDifference = copyZoneDifference({ from: "a", to: "b", on: word });
				expect(zoneDifferenceText(gap)).toBe(`b is 1 hour ahead of a on ${word}`);
			}
		});
	});
});
