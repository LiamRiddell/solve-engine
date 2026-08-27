/**
 * `plot <expr> from <a> to <b>` (issue #187): samples the sub-expression across
 * the range and answers with its (x, y) points and a plain-text label. The
 * points are metadata for a host that can draw; the label is the sensible answer
 * for one that cannot.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { serializeValue } from "@solve-js/worker/serialize";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type PlotData } from "@solve-js/vm/Value";

function plotOf(source: string): PlotData {
	const value = newTrackedEngine().evaluateExpression(source);
	expect(value.type).toBe(ValueType.Plot);
	return value.value as PlotData;
}

const label = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");

describe("plot samples an expression across a range", () => {
	test("a parabola is sampled endpoint to endpoint", () => {
		const p = plotOf("plot x^2 from -3 to 3");
		expect(p.points.length).toBe(64);
		expect(p.points[0]).toEqual([-3, 9]);
		expect(p.points[p.points.length - 1]).toEqual([3, 9]);
		expect(p.from).toBe(-3);
		expect(p.to).toBe(3);
	});

	test("the bound `to 2pi` is the range, not a unit conversion", () => {
		const p = plotOf("plot sin(x) from 0 to 2pi");
		expect(p.points[0][0]).toBe(0);
		expect(p.points[0][1]).toBeCloseTo(0, 10); // sin(0)
		expect(p.to).toBeCloseTo(2 * Math.PI, 10);
	});

	test("a compounding curve keeps its shape", () => {
		const p = plotOf("plot 1000 * 1.05^x from 0 to 10");
		expect(p.points[0]).toEqual([0, 1000]);
		expect(p.points[p.points.length - 1][1]).toBeCloseTo(1000 * 1.05 ** 10, 6);
	});

	test("a sample the body cannot evaluate is a gap, not a failure", () => {
		// 1/x at x = 0 is infinite, so that one point is dropped and the rest draw.
		const p = plotOf("plot 1/x from 0 to 4");
		expect(p.points.length).toBe(63);
		expect(p.points.every(([, y]) => Number.isFinite(y))).toBe(true);
	});

	test("the label reads the expression and the range", () => {
		expect(label("plot x^2 from -3 to 3")).toBe("x^2 over [-3, 3]");
		expect(label("plot sin(x) from 0 to 2pi")).toBe("sin(x) over [0, 6.28]");
		expect(label("plot 1000 * 1.05^x from 0 to 10")).toBe("1000 * 1.05^x over [0, 10]");
	});
});

describe("plot is not a reserved word", () => {
	test("`plot` still defines and reads as a variable", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":plot = 5");
		expect(engine.evaluateLine(2, "plot + 1").toNumber()).toBe(6);
	});
});

describe("plot serialisation", () => {
	test("the DTO carries the points and survives structuredClone", () => {
		const dto = serializeValue(newTrackedEngine().evaluateExpression("plot x^2 from -3 to 3"));
		expect(dto.plot?.expr).toBe("x^2");
		expect(dto.plot?.points.length).toBe(64);
		expect(dto.plot?.points[0]).toEqual([-3, 9]);
		expect(structuredClone(dto)).toEqual(dto);
		expect(JSON.parse(JSON.stringify(dto)).plot.to).toBe(3);
	});
});
