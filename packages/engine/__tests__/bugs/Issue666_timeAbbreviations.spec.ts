import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { isKnownUnit } from "@solve-js/lexer/units";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { unknownUnitError } from "@solve-js/vm/VMConversion";

/**
 * Issue #666: the abbreviations people write after a number were refused. `$15/hr`
 * threw "Undefined variable: hr" and `30 mins` "Undefined variable: mins", while
 * `1hr30min` read as 90 minutes, because the compact-duration rule had its own
 * list and the unit table did not spell them. The table now carries `hr`, `hrs`,
 * `mins`, `sec`, `secs`, `wks` and `yrs`, each an alias of the unit it names, and
 * the lexer admits a leading micro sign, so `5 µs` is five microseconds.
 */

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

function thrownMessage(line: string): string {
	try {
		newTrackedEngine().evaluateExpression(line);
	} catch (error) {
		return (error as Error).message;
	}
	return "(no throw)";
}

describe("each abbreviation is a unit after a number", () => {
	test.each([
		["$15/hr", "= 15.00 USD/hr"],
		["30 mins", "= 30.00 mins"],
		["2 hrs", "= 2.00 hrs"],
		["10 sec", "= 10.00 sec"],
		["10 secs", "= 10.00 secs"],
		["2 wks", "= 2.00 wks"],
		["3 yrs", "= 3.00 yrs"],
		["£12/hr", "= 12.00 GBP/hr"],
		["100 km/hr", "= 100.00 km/hr"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});
});

describe("and converts as the unit it names", () => {
	test.each([
		["2 hours in mins", "= 120.00 mins"],
		["90 minutes in hr", "= 1.50 hr"],
		["1 wks in hrs", "= 168.00 hrs"],
		["1 yr in secs", "= 31,536,000.00 secs"],
		["2 yrs in days", "= 730 days"],
		["100 km/hr in km/h", "= 100.00 km/h"],
		["$15/hr * 37.5 hrs", "= $562.50"],
		["10 hrs + 30 mins", "= 10.50 hrs"],
		["30 min + 10 sec", "= 30.17 min"],
		["90 mins as timespan", "= 1 hour 30 minutes"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("hr agrees with h, and mins with min, to the bit", () => {
		expect(UNIT_TABLE.hr).toBe(UNIT_TABLE.h);
		expect(UNIT_TABLE.mins).toBe(UNIT_TABLE.min);
		expect(newTrackedEngine().evaluateExpression("7 hrs in mins").toNumber()).toBe(
			newTrackedEngine().evaluateExpression("7 h in min").toNumber(),
		);
	});
});

describe("a count of a rate's unit", () => {
	test("keeps a symbol singular, although the table now spells its plural", () => {
		expect(shown("500 l / 20 lpm")).toBe("= 25.00 min");
		expect(shown("$100 / $5/min")).toBe("= 20.00 min");
		expect(shown("$100 / $5/wk")).toBe("= 20.00 wk");
		expect(shown("$100 / $5/yr")).toBe("= 20.00 yr");
	});

	test("gives a word its plural, as before, and an added abbreviation its own", () => {
		expect(shown("$100 / $5/hour")).toBe("= 20 hours");
		expect(shown("$100 / $5/hr")).toBe("= 20.00 hrs");
	});
});

describe("the compact forms read the same spellings", () => {
	test.each([
		["1hr30min", "= 90 minutes"],
		["1hr30min in hours", "= 1.50 hours"],
		["2hrs", "= 2.00 hrs"],
		["45secs", "= 45.00 secs"],
		["1hr 30min", "= 90.00 min"],
		["1 hr 30 mins", "= 90.00 mins"],
		["2h30m", "= 150 minutes"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});
});

describe("the micro sign", () => {
	test.each([
		["5 µs in ns", "= 5,000.00 ns"],
		["5 μs in ns", "= 5,000.00 ns"],
		["5µs", "= 5.00 µs"],
		["3 µm in nm", "= 3,000.00 nm"],
		["1 mL in µL", "= 1,000.00 µL"],
		["1,000 µs in ms", "= 1.00 ms"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("is a prefix only, on a spelling the table has", () => {
		expect(thrownMessage("5 µ")).toBe("Undefined variable: µ");
		expect(thrownMessage("5 µx")).toBe("Undefined variable: µx");
		expect(isKnownUnit("µµs")).toBe(false);
	});

	test("and us is not read as microseconds, since it is a word", () => {
		expect(thrownMessage("5 us")).toBe("Undefined variable: us");
	});
});

describe("what did not change", () => {
	test.each([
		["30 min", "= 30.00 min"],
		["2 wk", "= 2.00 wk"],
		["$15/hour", "= 15.00 USD/hour"],
		["5 microseconds", "= 5.00 microseconds"],
		["90m", "= 90.00 m"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("a unit is lower case only, so HR and Hrs are names", () => {
		expect(thrownMessage("2 HRS")).toBe("Undefined variable: HRS");
		expect(thrownMessage("2 Hrs")).toBe("Undefined variable: Hrs");
		expect(thrownMessage("HR")).toBe("Undefined variable: HR");
	});

	test("nor are they functions", () => {
		expect(thrownMessage("sec(1)")).toBe("Undefined function: sec");
		expect(thrownMessage("hr(2)")).toBe("Undefined function: hr");
	});
});

describe("a variable of the same name", () => {
	test("is the variable at the start of a line and after an operator", () => {
		const { batch } = expectHonestDocument("hr = 2\nhr * 3\nhrs = 5\nhrs * 2\nsec = 3\nsec + 1\nmins = 4\nmins");
		expect(batch).toEqual(["= 2", "= 6", "= 5", "= 10", "= 3", "= 4", "= 4", "= 4"]);
	});

	test("while straight after a value the unit is read, as h always was", () => {
		// Before #666 these two read the variable: `$15/hr` was $7.50 and
		// `30 mins` was 120. The changeset names the change.
		const { batch } = expectHonestDocument("hr = 2\n$15/hr\nmins = 4\n30 mins\nh = 2\n$15/h");
		expect(batch).toEqual(["= 2", "= 15.00 USD/hr", "= 4", "= 30.00 mins", "= 2", "= 15.00 USD/h"]);
	});

	test("a global works the same way", () => {
		const { batch } = expectHonestDocument(":hr = 3\n$10/hr\nhr * 2");
		expect(batch).toEqual(["= 3", "= 10.00 USD/hr", "= 6"]);
	});

	test("a quantity in the new spelling carries it through a variable", () => {
		const { batch } = expectHonestDocument("x = 3 hrs\nx in mins");
		expect(batch).toEqual(["= 3.00 hrs", "= 180.00 mins"]);
	});
});

describe("prose is still prose", () => {
	test("a line that uses the words is not evaluated", () => {
		const doc = newTrackedEngine().parseDocument("I need 3 hrs for this\n5");
		expect(doc.lines[0].result ?? null).toBeNull();
		expect(formatValue(doc.lines[1].result!)).toBe("= 5");
	});
});

describe("a misspelt conversion target names units of the same measure", () => {
	test("mins is as close to mies as miles is, and is not offered for a length", () => {
		expect(shown("5 km in mies")).toBe(`"mies" is not a unit. Did you mean miles?`);
	});

	test("with nothing of the source's measure close, every near spelling is offered", () => {
		expect(shown("5 kg in mies")).toBe(`"mies" is not a unit. Did you mean miles or mins?`);
		expect(shown("5 in mies")).toBe(`"mies" is not a unit. Did you mean miles or mins?`);
	});

	test("unknownUnitError filters by the source's measure only when it has one", () => {
		const message = (unit: string, from?: string): string => formatValue(unknownUnitError(unit, from));
		expect(message("mies", "km")).toBe(`"mies" is not a unit. Did you mean miles?`);
		expect(message("mies")).toBe(`"mies" is not a unit. Did you mean miles or mins?`);
		expect(message("mies", "bottles")).toBe(`"mies" is not a unit. Did you mean miles or mins?`);
		expect(message("mies", "__proto__")).toBe(`"mies" is not a unit. Did you mean miles or mins?`);
		expect(message("zzzzzz", "km")).toBe(`"zzzzzz" is not a unit.`);
		expect(unknownUnitError("mies", "km").errorCode).toBe("UNKNOWN_UNIT");
	});

	test("a time target offers both minute spellings", () => {
		expect(shown("2 hours in minz")).toBe(`"minz" is not a unit. Did you mean min or mins?`);
	});
});

describe("adversarial: every form answers honestly", () => {
	const words = ["hr", "hrs", "mins", "sec", "secs", "wks", "yrs", "µs", "μs"];
	test.each(words.flatMap((w) => [`5 ${w}`, `$5/${w}`, `5 ${w} in s`, `${w}`, `${w} = 1`, `5${w}`, `-5 ${w}`, `5 ${w} ^ 2`, `(5 ${w}) / (0 ${w})`]))("%s", (line) => {
		expectHonestLine(line, { allowNaN: true });
	});
});
