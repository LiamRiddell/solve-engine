import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { expectHonestDocument, expectHonestLine, fill, NUMERIC_EDGES } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { numberValue, uomValue, ValueType } from "@solve-js/vm/Value";
import { unspelledUnitRefused, quantityOperandRefused } from "@solve-js/vm/VMConversion";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { serializeValue, deserializeValue } from "@solve-js/engine/EngineSnapshot";
import { BUILTIN_PACKAGES } from "@solve-js/packages";

/**
 * Issue #648: the physical constants without an engine unit were plain
 * numbers, and a plain number takes the unit of the quantity it meets, so
 * `boltzmann * 300 K` was 4.14e-21 K and `planck * 5e14 Hz` 3.31e-19 Hz.
 * `boltzmann` carries J/K now, which the engine reads and cancels, so it gives
 * joules. The others need a dimension the engine does not have yet (charge,
 * the mole, a product of units), and meeting a quantity is refused by name
 * rather than lending the answer the other operand's unit.
 */

function shown(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line));
}

function code(line: string): string | undefined {
	return newTrackedEngine().evaluateExpression(line).errorCode;
}

describe("boltzmann carries joules per kelvin", () => {
	test.each([
		["boltzmann", "= 1.38e-23 J/K"],
		["boltzmann * 300 K", "= 4.14e-21 J"],
		["300 K * boltzmann", "= 4.14e-21 J"],
		["boltzmann / 2", "= 6.9e-24 J/K"],
		["boltzmann * 300", "= 4.14e-21 J/K"],
		["boltzmann in J/K", "= 1.38e-23 J/K"],
		["(boltzmann * 300 K) in J", "= 4.14e-21 J"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("the same as the constant written out with its unit", () => {
		expect(shown("boltzmann * 300 K")).toBe(shown("1.380649e-23 J/K * 300 K"));
	});
});

describe("a constant whose unit the engine cannot spell refuses a quantity", () => {
	test.each([
		"planck * 5e14 Hz",
		"5e14 Hz * planck",
		"planck / 2 s",
		"2 s / planck",
		"planck + 1 kg",
		"planck * $5",
		"elementary charge * 3 V",
		"gas constant * 300 K",
		"avogadro * 5 kg",
		"planck in J",
	])("%s", (line) => {
		expect(code(line)).toBe("CONSTANT_UNIT_UNSUPPORTED");
	});

	test("the message names the unit the constant is really in", () => {
		expect(shown("planck * 5e14 Hz")).toBe(
			"A constant measured in J·s and a quantity in Hz cannot be multiplied: the engine cannot spell J·s yet, so the answer would wrongly be in Hz. Leave the unit off the other side and read the result in the unit it should have.",
		);
		expect(shown("planck in J")).toBe("A constant measured in J·s cannot be converted to J: the engine cannot spell J·s yet, so the constant is a plain number.");
	});
});

describe("the boundary: a constant with a plain number, and the dimensioned constants, are unchanged", () => {
	test.each([
		["planck", "= 6.63e-34"],
		["planck * 2", "= 1.33e-33"],
		["planck * 5e14", "= 3.31e-19"],
		["avogadro * 2", "= 1,204,428,152,000,000,000,000,000"],
		["gas constant", "= 8.31"],
		["elementary charge", "= 1.6e-19"],
		["planck ^ 2", "= 4.39e-67"],
		["-planck", "= -6.63e-34"],
		["tau * 2 m", "= 12.57 m"],
		["speed of light * 2 s", "= 599,584,916.00 m"],
		["electron mass", "= 9.11e-31 kg"],
	])("%s", (line, expected) => {
		expect(shown(line)).toBe(expected);
	});

	test("boltzmann squared has no unit, and is refused as any such power is", () => {
		expect(code("boltzmann ^ 2")).toBe("UNIT_POWER_UNSUPPORTED");
	});
});

describe("adversarial", () => {
	test("every numeric edge beside a constant is answered honestly", () => {
		for (const line of fill("planck * X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("boltzmann * X K", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("a constant held in a variable keeps its refusal, through both passes", () => {
		const { batch } = expectHonestDocument("h = planck\nh * 5e14 Hz\nh * 5e14\nk = boltzmann\nk * 300 K");
		expect(batch[0]).toBe("= 6.63e-34");
		expect(batch[1]).toMatch(/^ERROR A constant measured in J·s and a quantity in Hz cannot be multiplied/);
		expect(batch[2]).toBe("= 3.31e-19");
		expect(batch[4]).toBe("= 4.14e-21 J");
	});

	test("the mark survives a clone and is cleared by recycling", () => {
		const constant = newTrackedEngine().evaluateExpression("planck");
		expect(constant.unspelledUnit).toBe("J·s");
		expect(constant.clone().unspelledUnit).toBe("J·s");
		const reused = constant.clone();
		reused.recycle(ValueType.Number, 1);
		expect(reused.unspelledUnit).toBeUndefined();
	});
});

describe("unspelledUnitRefused", () => {
	const planck = numberValue(6.62607015e-34);
	planck.unspelledUnit = "J·s";

	test("refuses a conversion and each operation by name", () => {
		expect(unspelledUnitRefused(planck, "J")?.errorCode).toBe("CONSTANT_UNIT_UNSUPPORTED");
		for (const op of ["add", "sub", "mul", "div"] as const) {
			expect(formatValue(unspelledUnitRefused(planck, "Hz", op)!)).toContain(`cannot be ${{ add: "added", sub: "subtracted", mul: "multiplied", div: "divided" }[op]}`);
		}
	});

	test("an ordinary number is not refused", () => {
		expect(unspelledUnitRefused(numberValue(2), "Hz", "mul")).toBeNull();
	});

	test("quantityOperandRefused asks it for arithmetic but not for a remainder", () => {
		expect(quantityOperandRefused(planck, uomValue(5, "Hz"), "mul")?.errorCode).toBe("CONSTANT_UNIT_UNSUPPORTED");
		expect(quantityOperandRefused(uomValue(5, "Hz"), planck, "div")?.errorCode).toBe("CONSTANT_UNIT_UNSUPPORTED");
		expect(quantityOperandRefused(planck, uomValue(5, "Hz"))).toBeNull();
	});
});

describe("a snapshot keeps the constant's unit", () => {
	// Value.unspelledUnit is a sidecar, so a snapshot that dropped it would
	// restore `x = planck` as a plain number and lend `x * 5e14 Hz` hertz again.
	function restoredAfter(line: string): ExpressionEngine {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, line);
		const snapshot = JSON.parse(JSON.stringify(engine.toJSON()));
		return ExpressionEngine.fromJSON(snapshot, { packages: BUILTIN_PACKAGES });
	}

	test("a variable holding a constant is still refused beside a quantity after a restore", () => {
		const restored = restoredAfter("x = planck");
		try {
			expect(restored.evaluateExpression("x * 5e14 Hz").errorCode).toBe("CONSTANT_UNIT_UNSUPPORTED");
			expect(formatValue(restored.evaluateExpression("x * 2"))).toBe("= 1.33e-33");
		} finally {
			restored.clear();
		}
	});

	test("the sidecar is written as uu and read back", () => {
		const value = numberValue(6.62607015e-34);
		value.unspelledUnit = "J·s";
		const serialized = serializeValue(value);
		expect(serialized).toMatchObject({ t: ValueType.Number, uu: "J·s" });
		expect(deserializeValue(serialized).unspelledUnit).toBe("J·s");
		expect(serializeValue(numberValue(2))).not.toHaveProperty("uu");
	});

	test.each([5, "", null, { unit: "J·s" }])("a hand-edited uu of %j is refused as malformed", (uu) => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "x = planck");
		const snapshot = JSON.parse(JSON.stringify(engine.toJSON()));
		const entry = JSON.stringify(snapshot).includes('"uu"');
		expect(entry).toBe(true);
		const tampered = JSON.parse(JSON.stringify(snapshot).replace('"uu":"J·s"', `"uu":${JSON.stringify(uu)}`));
		expect(() => ExpressionEngine.fromJSON(tampered, { packages: BUILTIN_PACKAGES })).toThrow(/uu/);
	});
});
