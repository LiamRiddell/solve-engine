/**
 * CSS length units (px, rem): a front-end convenience in the units system, kept
 * in their own measure so a pixel converts to a rem but not to a physical length.
 * `rem` is 16px, the CSS default root font size.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");

describe("CSS units", () => {
	test("px converts to rem against a 16px root, both directions", () => {
		expect(shown("16px in rem")).toBe("1.00 rem");
		expect(shown("24px in rem")).toBe("1.50 rem");
		expect(shown("1.5rem in px")).toBe("24.00 px");
	});

	test("they add and subtract like any other unit", () => {
		expect(shown("2rem + 8px")).toBe("2.50 rem");
	});

	test("a CSS length is disjoint from physical length", () => {
		// px and cm are different measures, so the conversion is refused rather
		// than inventing a pixels-per-centimetre it cannot know.
		expect(newTrackedEngine().evaluateExpression("16px in cm").type).toBe(ValueType.Error);
	});
});
