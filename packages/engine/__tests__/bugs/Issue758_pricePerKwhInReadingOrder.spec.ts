import { afterEach, describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { rateThroughQuantity } from "@solve-js/vm/UnitAlgebra";
import { unitQuotient } from "@solve-js/uom/Dimensions";
import { currencyExchangeService } from "@solve-js/uom/CurrencyExchange";
import { ValueType, numberValue, uomValue, uomValueExact } from "@solve-js/vm/Value";
import { decimalFromLiteral } from "@solve-js/decimal";

/**
 * Issue #758: an electricity cost said in reading order, the price, then the
 * power, then the time, was refused. Multiplication runs left to right, and a
 * rate could only meet a quantity of its own denominator's measure, so the
 * price met a power before the time had made it an energy:
 * `$0.30/kWh * 2 kW * 3 h` was `RATE_MUL_MEASURE_MISMATCH` while
 * `2 kW * 3 h * $0.30/kWh` was $1.80.
 *
 * A rate times a quantity of another measure now forms the rate per what is
 * left, when the rate's denominator over the quantity is a single unit the
 * engine names (`vm/UnitAlgebra.ts`'s `rateThroughQuantity`, over
 * `uom/Dimensions.ts`'s `unitQuotient`): a price per kWh times a power is a
 * price per hour, and times a time a price per kilowatt. The next factor then
 * cancels as against any rate, and the answer stays exact to the cent.
 */

afterEach(() => {
	currencyExchangeService.clearRates();
});

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line));
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

describe("the bill in reading order", () => {
	test.each([
		["$0.30/kWh * 2 kW * 3 h", "= $1.80"],
		["$0.30/kWh * 2 kW", "= $0.60/h"],
		["$0.30/kWh * 3 h", "= $0.90/kW"],
		["$0.30/kWh * 3 h * 2 kW", "= $1.80"],
		["$0.30/kWh * 180 min * 2 kW", "= $1.80"],
		["$0.30/kWh * 2 kW * 180 min", "= $1.80"],
		["$300/MWh * 2000 W * 3 h", "= $1.80"],
		["$0.30/kWh * 2 MW", "= $600.00/h"],
		["£0.28/kWh * 3 kW * 20 min", "= £0.28"],
		["€0.30/kWh * 2 kW * 3 h", "= €1.80"],
	])("%s is %s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("every order gives the bill the energy-first order gives", () => {
		const bill = shown("2 kW * 3 h * $0.30/kWh");
		for (const line of ["$0.30/kWh * 2 kW * 3 h", "$0.30/kWh * 3 h * 2 kW", "$0.30/kWh * (2 kW * 3 h)", "$0.30/kWh * 6 kWh", "3 h * $0.30/kWh * 2 kW"]) {
			expect({ line, bill: shown(line) }).toEqual({ line, bill });
		}
	});

	test("the answer is exact to the cent", () => {
		const value = newTrackedEngine().evaluateExpression("$0.305/kWh * 2 kW * 3 h");
		expect(value.exact).toBeDefined();
		expect(formatValue(value)).toBe("= $1.83");
		expect(shown("$0.15/kWh * 12.3 kW * 1 h")).toBe(shown("12.3 kWh * $0.15/kWh"));
		expect(shown("$0.005/kWh * 1 kW * 1 h")).toBe("= $0.01");
	});

	test("the explanation answers the bill, as the energy-first order's does", () => {
		const explanation = newTrackedEngine().explainLine("$0.30/kWh * 2 kW * 3 h");
		const energyFirst = newTrackedEngine().explainLine("2 kW * 3 h * $0.30/kWh");
		expect(explanation.result?.unit).toBe("USD");
		expect(explanation.result?.toNumber()).toBeCloseTo(1.8, 12);
		expect(explanation.steps).toEqual(energyFirst.steps);
	});
});

describe("what stays refused", () => {
	test("a rate times a quantity that makes nothing is refused by name", () => {
		expect(code("$0.30/kWh * 2 kg")).toBe("RATE_MUL_MEASURE_MISMATCH");
		expect(code("$5/hour * 3 kg")).toBe("RATE_MUL_MEASURE_MISMATCH");
		expect(code("$0.30/kWh * 2 kW * 3 kg")).toBe("RATE_MUL_MEASURE_MISMATCH");
		expect(code("100 kg * 10 m/s")).toBe("RATE_MUL_MEASURE_MISMATCH");
	});

	test("the refusal says what it means without a dash", () => {
		const reason = newTrackedEngine().evaluateExpression("$0.30/kWh * 2 kg").errorMessage;
		expect(reason).toBe("Cannot multiply a rate per kWh by a quantity in kg: they measure different things, and together they make no unit.");
		expect(reason).not.toMatch(/-denominated|—/);
	});
});

describe("unitQuotient", () => {
	test("a time, in hours for a watt-hour and otherwise the largest whole clock unit", () => {
		expect(unitQuotient("kWh", "kW")).toEqual({ unit: "h", size: 1 });
		expect(unitQuotient("kWh", "W")).toEqual({ unit: "h", size: 1000 });
		expect(unitQuotient("kWh", "MW")).toEqual({ unit: "h", size: 0.001 });
		expect(unitQuotient("J", "W")).toEqual({ unit: "s", size: 1 });
		expect(unitQuotient("kJ", "W")).toEqual({ unit: "s", size: 1000 });
		expect(unitQuotient("MJ", "kW")).toEqual({ unit: "s", size: 1000 });
		expect(unitQuotient("km", "km/h")).toEqual({ unit: "h", size: 1 });
		expect(unitQuotient("kWh", "kWh/h")).toEqual({ unit: "h", size: 1 });
	});

	test("a named unit", () => {
		expect(unitQuotient("kWh", "h")).toEqual({ unit: "kW", size: 1 });
		expect(unitQuotient("J", "m")).toEqual({ unit: "N", size: 1 });
	});

	test("nothing when the quotient is no single unit", () => {
		for (const [top, bottom] of [["h", "kg"], ["km", "h"], ["kWh", "USD"], ["USD", "kWh"], ["", "s"], ["kWh", ""]]) {
			expect({ top, bottom, quotient: unitQuotient(top, bottom) }).toEqual({ top, bottom, quotient: null });
		}
	});

	test("a word naming an inherited property is nothing", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(unitQuotient(word, "kW")).toBeNull();
				expect(unitQuotient("kWh", word)).toBeNull();
			}
		});
	});
});

describe("rateThroughQuantity", () => {
	test("a price per kWh times a power or a time", () => {
		const price = uomValueExact(0.3, "USD/kWh", decimalFromLiteral("0.30"));
		expect(rateThroughQuantity(price, uomValue(2, "kW"))).toMatchObject({ type: ValueType.Uom, unit: "USD/h" });
		expect(rateThroughQuantity(price, uomValue(2, "kW"))?.toNumber()).toBeCloseTo(0.6, 12);
		expect(rateThroughQuantity(price, uomValue(2, "kW"))?.exact).toBeDefined();
		expect(rateThroughQuantity(price, uomValue(3, "h"))?.unit).toBe("USD/kW");
	});

	test("a count per unit and a physical rate", () => {
		expect(rateThroughQuantity(uomValue(5, "/kWh"), uomValue(2, "kW"))).toMatchObject({ unit: "/h", value: 10 });
		expect(rateThroughQuantity(uomValue(10, "l/kWh"), uomValue(2, "kW"))).toMatchObject({ unit: "l/h", value: 20 });
	});

	test("nothing for a named rate, a plain number, a rate per nothing, or a quotient that names nothing", () => {
		expect(rateThroughQuantity(uomValue(60, "mph"), uomValue(2, "kg"))).toBeUndefined();
		expect(rateThroughQuantity(numberValue(3), uomValue(2, "kW"))).toBeUndefined();
		expect(rateThroughQuantity(uomValue(3, "USD/kWh"), numberValue(2))).toBeUndefined();
		expect(rateThroughQuantity(uomValue(3, "USD"), uomValue(2, "kW"))).toBeUndefined();
		expect(rateThroughQuantity(uomValue(3, "USD/kWh"), uomValue(2, "kg"))).toBeUndefined();
		expect(rateThroughQuantity(uomValue(3, "USD/"), uomValue(2, "kW"))).toBeUndefined();
		expect(rateThroughQuantity(uomValue(3, "USD/constructor"), uomValue(2, "kW"))).toBeUndefined();
	});
});

describe("adversarial: security", () => {
	test.each([...fill("$0.30/X * 2 kW * 3 h", PROTOTYPE_WORDS), ...fill("$0.30/kWh * 2 X * 3 h", PROTOTYPE_WORDS), ...fill("$0.30/kWh * 2 kW * 3 X", PROTOTYPE_WORDS)])("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a long chain of powers and times stays within its budget", () => {
		const chain = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? "1 kW" : "1 h")).join(" * ");
		expectHonestLine(`$0.30/kWh * ${chain}`, { budgetMs: 2_000 });
	});

	test("look-alike and markup-shaped text is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`$0.30/kWh * 2 kW * 3 h ${edge}`);
		expectHonestLine("$0.30/kWh * 2 k​W * 3 h");
		expectHonestLine("$0.30/kWh * 2 kW * 3 h <img src=x>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("values from the lines above, a check over it, and both document passes", () => {
		const { batch } = expectHonestDocument("price = $0.30/kWh\nheater = 2 kW\nhours = 3 h\nprice * heater * hours\ncheck price * heater * hours == $1.80\nprice * heater");
		expect(batch).toEqual(["= $0.30/kWh", "= 2.00 kW", "= 3.00 h", "= $1.80", "= ✓", "= $0.60/h"]);
	});

	test("a currency conversion inside the chain", () => {
		currencyExchangeService.primeRates("USD", { EUR: 0.9 }, { provider: "test" });
		expect(shown("$0.30/kWh * 2 kW * 3 h in EUR")).toBe("= €1.62");
		expect(shown("($0.30/kWh in €/kWh) * 2 kW * 3 h")).toBe("= €1.62");
	});
});

describe("adversarial: edge cases", () => {
	test.each([...fill("$0.30/kWh * X kW * 3 h", NUMERIC_EDGES), ...fill("$X/kWh * 2 kW * 3 h", NUMERIC_EDGES)])("%s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("zero, negatives and a half cent", () => {
		expect(shown("$0.30/kWh * 0 kW * 3 h")).toBe("= $0.00");
		expect(shown("$0.30/kWh * -2 kW * 3 h")).toBe("= -$1.80");
		expect(shown("$0.305/kWh * 1 kW * 1 h")).toBe("= $0.31");
	});
});
