/**
 * The colour functions end to end through the engine: constructors, adjusters,
 * the measuring functions, the amount conventions, and the error cases. Hex is
 * written here via the `color("#...")` string form so these tests do not depend
 * on the `#hex` literal lexing (that is `ColourLiterals.spec.ts`).
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType, type ColourData } from "@solve-js/vm/Value";

function evalValue(source: string) {
	const engine = newTrackedEngine();
	return engine.evaluateExpression(source)[0];
}

function colour(source: string): ColourData {
	const v = evalValue(source);
	expect(v.type).toBe(ValueType.Colour);
	return v.value as ColourData;
}

describe("constructors", () => {
	test('color("#ff0000") parses hex', () => {
		expect(colour('color("#ff0000")')).toMatchObject({ r: 255, g: 0, b: 0, a: 1, format: "hex" });
	});

	test('color("red") and color("rebeccapurple") resolve names', () => {
		expect(colour('color("red")')).toMatchObject({ r: 255, g: 0, b: 0, format: "named", name: "red" });
		expect(colour('color("rebeccapurple")')).toMatchObject({ r: 102, g: 51, b: 153 });
	});

	test("rgb and rgba build from channels", () => {
		expect(colour("rgb(255, 128, 0)")).toMatchObject({ r: 255, g: 128, b: 0, a: 1, format: "rgb" });
		expect(colour("rgba(255, 0, 0, 0.5)")).toMatchObject({ r: 255, g: 0, b: 0, a: 0.5, format: "rgba" });
	});

	test("hsl accepts bare and percent saturation/lightness alike", () => {
		expect(colour("hsl(0, 100, 50)")).toMatchObject({ r: 255, g: 0, b: 0, format: "hsl" });
		expect(colour("hsl(0, 100%, 50%)")).toMatchObject({ r: 255, g: 0, b: 0 });
		expect(colour("hsl(120, 100, 50)")).toMatchObject({ r: 0, g: 255, b: 0 });
	});

	test("channels clamp to range", () => {
		expect(colour("rgb(300, -5, 0)")).toMatchObject({ r: 255, g: 0, b: 0 });
	});
});

describe("adjusters", () => {
	test("the three ways of writing an amount agree", () => {
		const frac = colour('lighten(color("#3366cc"), 0.2)');
		expect(colour('lighten(color("#3366cc"), 20%)')).toEqual(frac);
		expect(colour('lighten(color("#3366cc"), 20)')).toEqual(frac);
	});

	test("lighten raises and darken lowers luminance", () => {
		const base = evalValue('luminance(color("#3366cc"))').toNumber();
		expect(evalValue('luminance(lighten(color("#3366cc"), 0.2))').toNumber()).toBeGreaterThan(base);
		expect(evalValue('luminance(darken(color("#3366cc"), 0.2))').toNumber()).toBeLessThan(base);
	});

	test("rotate spins the hue (red + 120deg = green)", () => {
		expect(colour('rotate(color("#ff0000"), 120)')).toMatchObject({ r: 0, g: 255, b: 0 });
		expect(colour('spin(color("#ff0000"), 120)')).toMatchObject({ r: 0, g: 255, b: 0 });
	});

	test("complement, grayscale, invert", () => {
		expect(colour('grayscale(color("#3366cc"))')).toMatchObject({ r: expect.any(Number) });
		const g = colour('greyscale(color("#3366cc"))');
		expect(g.r).toBe(g.b);
		expect(colour('invert(color("#000000"))')).toMatchObject({ r: 255, g: 255, b: 255 });
	});

	test("mix blends, weighting toward the second colour", () => {
		expect(colour('mix(color("#ff0000"), color("#0000ff"))')).toMatchObject({ r: 128, g: 0, b: 128 });
		expect(colour('mix(color("#000000"), color("#ffffff"), 0.25)').r).toBeCloseTo(64, 0);
	});

	test("alpha / opacity / fade set the alpha channel", () => {
		// A hex colour keeps hex display and expresses alpha as #rrggbbaa; an rgb
		// colour upgrades to rgba so the alpha shows.
		expect(colour('alpha(color("#ff0000"), 0.5)')).toMatchObject({ a: 0.5, format: "hex" });
		expect(colour('opacity(color("#ff0000"), 25%)')).toMatchObject({ a: 0.25 });
		expect(colour("fade(rgb(255, 0, 0), 0.5)")).toMatchObject({ a: 0.5, format: "rgba" });
	});
});

describe("measurements return numbers", () => {
	test("contrast of black on white is 21", () => {
		expect(evalValue('contrast(color("#ffffff"), color("#000000"))').toNumber()).toBeCloseTo(21, 5);
	});

	test("luminance of white is 1, black is 0", () => {
		expect(evalValue('luminance(color("#ffffff"))').toNumber()).toBeCloseTo(1, 6);
		expect(evalValue('luminance(color("#000000"))').toNumber()).toBeCloseTo(0, 6);
	});
});

describe("errors are coded, not silent", () => {
	function isError(source: string): boolean {
		return evalValue(source).type === ValueType.Error;
	}

	test("wrong arity", () => {
		expect(isError("rgb(255, 0)")).toBe(true);
		expect(isError("hsl(0)")).toBe(true);
	});

	test("a non-colour where a colour is required", () => {
		expect(isError("lighten(5, 0.2)")).toBe(true);
		expect(isError("contrast(5, 6)")).toBe(true);
	});

	test("an unparseable colour string", () => {
		expect(isError('color("notacolour")')).toBe(true);
		expect(isError('color("#12345")')).toBe(true);
	});
});
