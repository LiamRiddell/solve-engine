/**
 * Units spelled in more than one word (issue #548).
 *
 * The lexer reads a unit as one run of word characters, so `nautical miles`
 * arrived as two tokens and `nautical` on its own was an undefined variable:
 * `5 km in nautical miles` said the two did not measure the same thing. The
 * multi-word unit rule now fuses any spelling the unit table carries with a
 * space or a hyphen, after a value or a conversion keyword.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/** One line, formatted as a host shows it. */
function show(source: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(source));
}

describe("a unit spelled in words", () => {
	test("after a value", () => {
		expect(show("5 nautical miles")).toBe("= 5.00 nautical miles");
		expect(show("5 square feet")).toBe("= 5.00 square feet");
	});

	test("as a conversion target", () => {
		expect(show("5 km in nautical miles")).toBe("= 2.70 nautical miles");
		expect(show("5 cubic metres in litres")).toBe("= 5,000.00 litres");
	});

	test("as a conversion source", () => {
		expect(show("1 nautical mile in km")).toBe("= 1.85 km");
		expect(show("3 imperial gallons in litres")).toBe("= 13.64 litres");
	});

	test("hyphenated spellings, and three words", () => {
		expect(show("2 light-years in km")).toBe("= 18,921,460,945,161.60 km");
		expect(show("10 US fluid ounces in ml")).toBe("= 295.74 ml");
	});

	test("a plural the table does not carry reads as its singular", () => {
		// The table mirrors its upstream, which has `troy ounce` and
		// `watt-hour` with no plural beside them.
		expect(show("2 troy ounces in g")).toBe("= 62.21 g");
		expect(show("5 watt-hours in J")).toBe("= 18,000.00 J");
		// A symbol takes no plural: `kW hs` is not a spelling of anything.
		expect(newTrackedEngine().evaluateExpression("3 kW hs").errorCode).toBe("UNIT_AFTER_UNIT");
	});

	test("the two-unit pairs the rule already fused are unchanged", () => {
		expect(show("1 cup in fl oz")).toBe("= 8.00 fl oz");
	});

	test("the words must be separated exactly as the table spells them", () => {
		// Two spaces is not the table's spelling, so the words stay apart and
		// `nautical` is still an unknown name rather than half a unit.
		expect(() => newTrackedEngine().evaluateExpression("5 nautical  miles")).toThrow(/nautical/);
	});
});
