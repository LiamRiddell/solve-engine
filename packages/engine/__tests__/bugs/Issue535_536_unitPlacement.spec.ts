import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issues #535 and #536: a unit that lands somewhere it has no reading.
 *
 * - #535: a unit binds tighter than `^`, so `10^3 m` parsed as `10^(3 m)`, and
 *   the power read its exponent as the bare 3: `10^3 m` was the plain 1,000, and
 *   `10^3 m in km` labelled it 1,000 km. A unit inside an exponent's operand
 *   now belongs to the whole power (see PrecedenceParser's insideExponent), and
 *   an exponent that still carries one is refused.
 * - #536: a second unit straight after a quantity relabelled it, so `5 kg m`
 *   was 5 m. It is refused (UNIT_AFTER_UNIT). The currency symbol parselet,
 *   which silently dropped any unit after its amount, now reads a code that
 *   names the symbol's currency (`$5 CAD`) and leaves anything else to that
 *   refusal.
 */

const value = (source: string) => newTrackedEngine().evaluateExpression(source);
const shown = (source: string) => formatValue(value(source));

describe("#535: a unit after a power belongs to the whole power", () => {
	test.each([
		["10^3 m", "= 1,000.00 m"],
		["10^3 m in km", "= 1.00 km"],
		["1.5 * 10^3 kg", "= 1,500.00 kg"],
		["2^3 kg", "= 8.00 kg"],
		["10^-3 m in mm", "= 1.00 mm"],
		["2^3^2 m", "= 512.00 m"],
		["2 * 10^3 km in m", "= 2,000,000.00 m"],
		["1.2 * 10^6 USD", "= $1,200,000.00"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("a power on the unit itself is still the unit's", () => {
		expect(shown("5 m^2")).toBe("= 5.00 m2");
		expect(shown("(3 m)^2")).toBe("= 9.00 m2");
	});

	test("an exponent that carries a unit is refused rather than read as a number", () => {
		expect(value("2^(3 m)").errorCode).toBe("UNIT_IN_EXPONENT");
	});

	test("powers without units are unchanged", () => {
		expect(value("2^3^2").toNumber()).toBe(512);
		expect(value("10^3").toNumber()).toBe(1000);
	});
});

describe("#536: two units side by side are refused", () => {
	test.each(["5 kg m", "5 kg m in cm", "5 km h", "(5 kg) m", "5 USD GBP", "€5 GBP", "$5 kg"])("%s", (source) => {
		const v = value(source);
		expect(v.type).toBe(ValueType.Error);
		expect(v.errorCode).toBe("UNIT_AFTER_UNIT");
	});

	test("the message names the units in the order written", () => {
		expect(value("5 kg m").errorMessage).toContain("A quantity in kg cannot take a second unit, m");
		expect(value("$5 kg").errorMessage).toContain("A quantity in USD cannot take a second unit, kg");
	});

	test("a conversion of one quantity is still a conversion", () => {
		expect(shown("5 m in cm")).toBe("= 500.00 cm");
		expect(shown("(5 kg) in g")).toBe("= 5,000.00 g");
	});

	test("the same unit twice changes nothing", () => {
		expect(shown("5 kg kg")).toBe("= 5.00 kg");
		expect(shown("$5 USD")).toBe("= $5.00");
		expect(shown("£5 GBP")).toBe("= £5.00");
	});
});

describe("a currency code names which currency a shared symbol meant", () => {
	test.each([
		["$5 CAD", "CAD"],
		["$5 AUD", "AUD"],
		["¥500 CNY", "CNY"],
		["$5", "USD"],
	])("%s is in %s", (source, unit) => {
		expect(value(source).unit).toBe(unit);
	});

	test("a label word after money is still read and set aside", () => {
		expect(shown("£60,000 salary per month after tax")).toBe("= £3,779.78");
		expect(shown("$50,000 salary per year")).toBe("= 50,000.00 USD/year");
	});

	test("rates written after money are unchanged", () => {
		expect(shown("$20 per hour")).toBe("= 20.00 USD/hour");
		expect(shown("$20/hour * 8 hours")).toBe("= $160.00");
	});
});

describe("a degree word before a temperature scale names the scale", () => {
	test.each([
		["20 degrees C in F", "= 68.00 F"],
		["20° C in F", "= 68.00 F"],
		["20 deg C", "= 20.00 C"],
		["20 degrees celsius in fahrenheit", "= 68.00 fahrenheit"],
	])("%s is %s", (source, expected) => {
		// This reading used to lean on a second unit relabelling the first (an
		// angle in degrees relabelled as Celsius); the degree rule reads it now.
		expect(shown(source)).toBe(expected);
	});

	test("while an angle in degrees is still an angle", () => {
		expect(shown("90 degrees in radians")).toBe("= 1.57 radians");
	});
});
