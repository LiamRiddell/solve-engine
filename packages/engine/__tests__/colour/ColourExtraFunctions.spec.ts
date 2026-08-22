/**
 * The extended colour function set: channel extractors, the HSV/HWB
 * constructors, tint/shade/tone, the accessibility helpers (isdark/islight/
 * readable) and negate. Hex is written with the literal form here; the values
 * are the ones the engine actually produces.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType, type ColourData } from "@solve-js/vm/Value";

function evalValue(source: string) {
	const engine = newTrackedEngine("en");
	return engine.evaluateExpression(source)[0];
}

function colour(source: string): ColourData {
	const v = evalValue(source);
	expect(v.type).toBe(ValueType.Colour);
	return v.value as ColourData;
}

describe("channel extractors return numbers", () => {
	test("red/green/blue read the sRGB channels", () => {
		expect(evalValue("red(#3366cc)").toNumber()).toBe(51);
		expect(evalValue("green(#3366cc)").toNumber()).toBe(102);
		expect(evalValue("blue(#3366cc)").toNumber()).toBe(204);
	});

	test("hue/saturation/lightness read the HSL channels", () => {
		expect(evalValue("hue(#ff0000)").toNumber()).toBe(0);
		expect(evalValue("saturation(#ff0000)").toNumber()).toBe(100);
		expect(evalValue("lightness(#ff0000)").toNumber()).toBe(50);
		expect(evalValue("hue(#3366cc)").toNumber()).toBe(220);
	});

	test("alpha reads the alpha when given one argument", () => {
		expect(evalValue("alpha(rgba(255, 0, 0, 0.5))").toNumber()).toBeCloseTo(0.5, 6);
		expect(evalValue("alpha(#ff0000)").toNumber()).toBe(1);
	});
});

describe("HSV and HWB constructors", () => {
	test("hsv/hsb build from hue, saturation, value", () => {
		expect(colour("hsv(0, 100, 100)")).toMatchObject({ r: 255, g: 0, b: 0 });
		expect(colour("hsv(120, 100, 100)")).toMatchObject({ r: 0, g: 255, b: 0 });
		expect(colour("hsb(0, 100, 100)")).toMatchObject({ r: 255, g: 0, b: 0 });
	});

	test("hsva carries alpha", () => {
		expect(colour("hsva(0, 100, 100, 0.5)")).toMatchObject({ r: 255, g: 0, b: 0, a: 0.5 });
	});

	test("hwb builds from hue, whiteness, blackness", () => {
		expect(colour("hwb(0, 0, 0)")).toMatchObject({ r: 255, g: 0, b: 0 });
		expect(colour("hwb(0, 50, 0)")).toMatchObject({ r: 255, g: 128, b: 128 });
		expect(colour("hwb(0, 0, 100)")).toMatchObject({ r: 0, g: 0, b: 0 });
	});
});

describe("tint / shade / tone", () => {
	test("tint mixes toward white, shade toward black, tone toward grey", () => {
		expect(colour("tint(#ff0000, 50%)")).toMatchObject({ r: 255, g: 128, b: 128 });
		expect(colour("shade(#ff0000, 50%)")).toMatchObject({ r: 128, g: 0, b: 0 });
		expect(colour("tone(#ff0000, 50%)")).toMatchObject({ r: 192, g: 64, b: 64 });
	});
});

describe("accessibility helpers", () => {
	function isTrue(source: string): boolean {
		const v = evalValue(source);
		expect(v.type).toBe(ValueType.Boolean);
		return v.value === true;
	}

	test("isdark / islight classify by WCAG readability", () => {
		expect(isTrue("isdark(#000000)")).toBe(true);
		expect(isTrue("isdark(#ffffff)")).toBe(false);
		expect(isTrue("islight(#ffffff)")).toBe(true);
	});

	test("readable returns the higher-contrast of black or white", () => {
		expect(colour("readable(#000000)")).toMatchObject({ r: 255, g: 255, b: 255 });
		expect(colour("readable(#ffffff)")).toMatchObject({ r: 0, g: 0, b: 0 });
		// A mid blue is dark enough that white text is more readable.
		expect(colour("readable(#3366cc)")).toMatchObject({ r: 255, g: 255, b: 255 });
	});
});

test("negate is a full invert", () => {
	expect(colour("negate(#ff0000)")).toMatchObject({ r: 0, g: 255, b: 255 });
});

describe("WCAG contrast compliance", () => {
	function evalBool(source: string): boolean {
		const v = evalValue(source);
		expect(v.type).toBe(ValueType.Boolean);
		return v.value === true;
	}
	function evalString(source: string): string {
		const v = evalValue(source);
		expect(v.type).toBe(ValueType.String);
		return v.value as string;
	}

	test("iscontrastcompliant defaults to AA (4.5:1) for normal text", () => {
		expect(evalBool("iscontrastcompliant(#ffffff, #000000)")).toBe(true);
		expect(evalBool("iscontrastcompliant(#ffffff, #767676)")).toBe(true);
		expect(evalBool("iscontrastcompliant(#ffffff, #777777)")).toBe(false);
	});

	test("a level name or a numeric threshold overrides the default", () => {
		expect(evalBool('iscontrastcompliant(#ffffff, #767676, "AAA")')).toBe(false);
		expect(evalBool('iscontrastcompliant(#ffffff, #949494, "AA large")')).toBe(true);
		expect(evalBool("iscontrastcompliant(#ffffff, #949494, 3)")).toBe(true);
	});

	test("wcaglevel reports the best rating two colours pass", () => {
		expect(evalString("wcaglevel(#ffffff, #000000)")).toBe("AAA");
		expect(evalString("wcaglevel(#ffffff, #767676)")).toBe("AA");
		expect(evalString("wcaglevel(#ffffff, #949494)")).toBe("AA Large");
		expect(evalString("wcaglevel(#ffffff, #cccccc)")).toBe("Fail");
		expect(evalString("wcag(#000000, #ffffff)")).toBe("AAA");
	});
});
