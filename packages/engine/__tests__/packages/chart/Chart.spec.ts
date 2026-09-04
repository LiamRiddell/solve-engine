/**
 * Charts as data (issues #186, #187): `<vector> as sparkline` and `plot <expr>
 * from <a> to <b>` both produce one `ValueType.Chart`, a specification a host
 * draws. The engine emits points, a domain, a range and a label, never pixels.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { serializeValue } from "@solve-js/worker/serialize";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type ChartData } from "@solve-js/vm/Value";
import { EngineError } from "@solve-js/errors/EngineError";

function chartOf(source: string): ChartData {
	const value = newTrackedEngine().evaluateExpression(source);
	expect(value.type).toBe(ValueType.Chart);
	return value.value as ChartData;
}

const label = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");

describe("as sparkline", () => {
	test("a numeric vector becomes a sparkline chart", () => {
		const c = chartOf("[120, 135, 128, 150, 162] as sparkline");
		expect(c.kind).toBe("sparkline");
		expect(c.points).toEqual([[0, 120], [1, 135], [2, 128], [3, 150], [4, 162]]);
		expect(c.range).toEqual([120, 162]);
		expect(c.domain).toEqual([0, 4]);
	});

	test("a mapped range is a sparkline", () => {
		expect(chartOf("map(x^2, 0:5) as sparkline").points).toEqual([[0, 0], [1, 1], [2, 4], [3, 9], [4, 16], [5, 25]]);
	});

	test("the label keeps the series, so a no-canvas reader still sees the numbers", () => {
		expect(label("[120, 135, 128, 150, 162] as sparkline")).toBe("[120, 135, 128, 150, 162]");
	});

	test("a scalar is declined with a clear error, not a silent pass-through", () => {
		const value = newTrackedEngine().evaluateExpression("5 as sparkline");
		expect(value.type).toBe(ValueType.Error);
	});
});

describe("plot", () => {
	test("a plot is a chart of sampled points", () => {
		const c = chartOf("plot x^2 from -3 to 3");
		expect(c.kind).toBe("plot");
		expect(c.points.length).toBe(64);
		expect(c.points[0]).toEqual([-3, 9]);
		expect(c.points[63]).toEqual([3, 9]);
		expect(c.domain).toEqual([-3, 3]);
		expect(c.expr).toBe("x^2");
	});

	test("`to 2pi` is the range, not a unit conversion", () => {
		const c = chartOf("plot sin(x) from 0 to 2pi");
		expect(c.domain[1]).toBeCloseTo(2 * Math.PI, 10);
		expect(c.points[0][1]).toBeCloseTo(0, 10);
	});

	test("a sample the body cannot evaluate is a gap, not a failure", () => {
		expect(chartOf("plot 1/x from 0 to 4").points.length).toBe(63);
	});

	test("the label reads the expression and the range", () => {
		expect(label("plot sin(x) from 0 to 2pi")).toBe("sin(x) over [0, 6.28]");
		expect(label("plot 1/x from 0.5 to 5")).toBe("1/x over [0.5, 5]");
	});

	test("`plot` is not a reserved word", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":plot = 5");
		expect(engine.evaluateLine(2, "plot + 1").toNumber()).toBe(6);
	});

	/*
	 * What a sample may hide and what it may not. The sample loop used to
	 * swallow every throw, so `plot x + f(x)` with `f` undefined drew an empty
	 * chart, and the operands each failed body left on the shared stack then
	 * tripped the depth guard, which reported the undefined function as a
	 * stack-limit error. Only a fault of the one point (a whole-number
	 * operation meeting the fraction x happens to be) is a gap now.
	 */
	test("an undefined function in the body is the line's error, named, not an empty chart", () => {
		let thrown: unknown;
		try {
			newTrackedEngine().evaluateExpression("plot x + f(x) from 0 to 1");
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(EngineError);
		expect((thrown as EngineError).code).toBe("UNDEFINED_FUNCTION");
		expect((thrown as EngineError).message).toContain("f");
	});

	test("a fault of one point is still a gap", () => {
		// `x * 2n` has an answer only where x is a whole number: at 0 and at 1.
		// Every other sample throws BIGINT_INEXACT_OPERAND, which is that
		// point's fault rather than the expression's.
		const c = chartOf("plot x * 2n from 0 to 1");
		expect(c.points).toEqual([[0, 0], [1, 2]]);
	});

	test("a body with no value at any point is reported, not drawn as a flat line at zero", () => {
		// `5 kg to m` is an Error value, and an Error reads as zero through
		// toNumber(), so this used to plot sixty-four points at y = 0.
		const value = newTrackedEngine().evaluateExpression("plot x + (5 kg to m) from 0 to 1");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("INCOMPATIBLE_UNITS");
		expect(String(value.unit)).toContain("plot");
		expect(String(value.unit)).toContain("x + (5 kg to m)");
	});
});

describe("chart serialisation", () => {
	test("a sparkline DTO carries its specification and survives structuredClone", () => {
		const dto = serializeValue(newTrackedEngine().evaluateExpression("[3, 1, 4, 1, 5] as sparkline"));
		expect(dto.chart?.kind).toBe("sparkline");
		expect(dto.chart?.points[0]).toEqual([0, 3]);
		expect(dto.chart?.range).toEqual([1, 5]);
		expect(structuredClone(dto)).toEqual(dto);
	});

	test("a plot DTO carries its points and expression", () => {
		const dto = serializeValue(newTrackedEngine().evaluateExpression("plot x^2 from -3 to 3"));
		expect(dto.chart?.kind).toBe("plot");
		expect(dto.chart?.expr).toBe("x^2");
		expect(dto.chart?.points.length).toBe(64);
		expect(JSON.parse(JSON.stringify(dto)).chart.domain).toEqual([-3, 3]);
	});
});

describe("the chart package is removable", () => {
	test("without it, `plot` reads as an ordinary word rather than a chart clause", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-chart") });
		// With no chart package, nothing mints the PLOT token, so `plot ...` is not
		// a chart clause: it either fails to parse or reads `plot` as an ordinary
		// (here undefined) word. Either way, no chart is produced. The plot grammar
		// is per-engine, unlike the shared `as`-converter registry.
		let isChart = false;
		try {
			isChart = slim.evaluateLine(1, "plot x^2 from -3 to 3").type === ValueType.Chart;
		} catch {
			isChart = false;
		}
		expect(isChart).toBe(false);
	});
});
