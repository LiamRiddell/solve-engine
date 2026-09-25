import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #624: `3.30pm` read its hour with `parseInt` of the number the lexer
 * made of `3.30`, which is 3.3, so the minutes were dropped and it answered
 * 3:00 PM. The clock-time rule now reads the hour and minutes from the source
 * text. Only two digits after the point are minutes; any other fraction has no
 * single reading and is not read as a time at all.
 */

const engine = () => newTrackedEngine();

/** The hour and minute of a clock time's answer, read from the instant. */
function clock(line: string): string {
	const value = engine().evaluateExpression(line);
	expect(value.type).toBe(ValueType.Datetime);
	const d = new Date(value.toNumber());
	return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

describe("a dotted time keeps its minutes", () => {
	test.each([
		["3.30pm", "15:30"],
		["10.45am", "10:45"],
		["12.00pm", "12:00"],
		["3.30 pm", "15:30"],
		["12.05am", "0:05"],
	])("%s", (line, expected) => {
		expect(clock(line)).toBe(expected);
	});

	test("reads as the colon spelling does", () => {
		expect(clock("3.30pm")).toBe(clock("3:30pm"));
		expect(clock("4pm")).toBe("16:00");
	});
});

describe("adversarial: a fraction with no single reading is not a time", () => {
	test.each(["3.5pm", "3.305pm", "3.60pm", "13.30pm", "0.30am"])("%s is not read as a time", (line) => {
		let shown: string;
		try {
			shown = formatValue(engine().evaluateExpression(line));
		} catch (error) {
			shown = (error as Error).message;
		}
		expect(shown).not.toMatch(/PM|AM/);
	});
});
