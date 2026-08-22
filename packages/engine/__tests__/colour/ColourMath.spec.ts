/**
 * The pure colour maths: hex parsing, named colours, RGB<->HSL, the WCAG
 * luminance/contrast formulas, and the channel operations. These are the
 * correctness anchors the plugin handlers and the swatch renderer both build on,
 * so they are tested in isolation, with no engine involved.
 */
import { describe, expect, test } from "@jest/globals";
import * as Colour from "@solve-js/packages/colour/ColourMath";

describe("parseHex", () => {
	test("3-digit form doubles each nibble", () => {
		expect(Colour.parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1, format: "hex" });
		expect(Colour.parseHex("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1, format: "hex" });
	});

	test("6-digit form reads channel pairs", () => {
		expect(Colour.parseHex("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 1, format: "hex" });
		expect(Colour.parseHex("#3366cc")).toEqual({ r: 51, g: 102, b: 204, a: 1, format: "hex" });
	});

	test("8-digit form carries the alpha byte", () => {
		expect(Colour.parseHex("#ff0000ff")!.a).toBe(1);
		expect(Colour.parseHex("#ff000080")!.a).toBeCloseTo(128 / 255, 6);
		expect(Colour.parseHex("#ff000000")!.a).toBe(0);
	});

	test("4-digit form doubles the alpha nibble too", () => {
		expect(Colour.parseHex("#f008")!.a).toBeCloseTo(0x88 / 255, 6);
	});

	test("case-insensitive and the # is optional", () => {
		expect(Colour.parseHex("FF0000")).toEqual(Colour.parseHex("#ff0000"));
	});

	test("wrong lengths and non-hex return null", () => {
		expect(Colour.parseHex("#12345")).toBeNull();
		expect(Colour.parseHex("#1234567")).toBeNull();
		expect(Colour.parseHex("#123456789")).toBeNull();
		expect(Colour.parseHex("#gggggg")).toBeNull();
		expect(Colour.parseHex("#ff00zz")).toBeNull();
	});
});

describe("named colours", () => {
	test("common and level-4 keywords resolve", () => {
		expect(Colour.namedColour("red")).toMatchObject({ r: 255, g: 0, b: 0, a: 1, name: "red" });
		expect(Colour.namedColour("rebeccapurple")).toMatchObject({ r: 102, g: 51, b: 153 });
		expect(Colour.namedColour("RED")).toMatchObject({ r: 255, g: 0, b: 0 });
	});

	test("transparent is fully transparent black", () => {
		expect(Colour.namedColour("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0, format: "named", name: "transparent" });
	});

	test("an unknown name is null", () => {
		expect(Colour.namedColour("notacolour")).toBeNull();
	});
});

describe("RGB <-> HSL", () => {
	const cases: Array<[number, number, number]> = [
		[255, 0, 0],
		[51, 102, 204],
		[0, 128, 0],
		[123, 45, 200],
		[240, 240, 240],
	];
	test.each(cases)("round-trips (%i, %i, %i)", (r, g, b) => {
		const { h, s, l } = Colour.rgbToHsl(r, g, b);
		const back = Colour.hslToRgb(h, s, l);
		expect(back.r).toBeCloseTo(r, 0);
		expect(back.g).toBeCloseTo(g, 0);
		expect(back.b).toBeCloseTo(b, 0);
	});

	test("grey is achromatic (s = 0)", () => {
		expect(Colour.rgbToHsl(128, 128, 128).s).toBe(0);
	});
});

describe("WCAG luminance and contrast", () => {
	const white = Colour.parseHex("#ffffff")!;
	const black = Colour.parseHex("#000000")!;

	test("luminance of white is 1 and black is 0", () => {
		expect(Colour.relativeLuminance(white)).toBeCloseTo(1, 6);
		expect(Colour.relativeLuminance(black)).toBeCloseTo(0, 6);
	});

	test("black on white is the maximum 21:1", () => {
		expect(Colour.contrastRatio(black, white)).toBeCloseTo(21, 5);
		expect(Colour.contrastRatio(white, white)).toBeCloseTo(1, 6);
	});

	test("the AA threshold grey #767676 on white is about 4.54:1", () => {
		expect(Colour.contrastRatio(Colour.parseHex("#767676")!, white)).toBeCloseTo(4.54, 1);
	});

	test("contrast is symmetric", () => {
		const a = Colour.parseHex("#3366cc")!;
		expect(Colour.contrastRatio(a, white)).toBeCloseTo(Colour.contrastRatio(white, a), 10);
	});
});

describe("operations", () => {
	const red = Colour.parseHex("#ff0000")!;

	test("mix midpoint of black and white is mid grey", () => {
		const mid = Colour.mix(Colour.parseHex("#000000")!, Colour.parseHex("#ffffff")!, 0.5);
		expect(mid).toMatchObject({ r: 128, g: 128, b: 128 });
	});

	test("mix weight toward the second colour", () => {
		const m = Colour.mix(Colour.parseHex("#000000")!, Colour.parseHex("#ffffff")!, 0.25);
		expect(m.r).toBeCloseTo(64, 0);
	});

	test("invert is its own inverse", () => {
		expect(Colour.invert(Colour.invert(red))).toMatchObject({ r: 255, g: 0, b: 0 });
	});

	test("complement twice returns the original hue", () => {
		const twice = Colour.complement(Colour.complement(red));
		expect(twice).toMatchObject({ r: 255, g: 0, b: 0 });
	});

	test("grayscale equalises the channels", () => {
		const g = Colour.grayscale(Colour.parseHex("#3366cc")!);
		expect(g.r).toBe(g.g);
		expect(g.g).toBe(g.b);
	});

	test("lighten then darken by the same amount returns within a rounding step", () => {
		// HSL round-trips re-quantise integer channels, so one lighten+darken can
		// drift by at most 1 per channel. What matters is it does not accumulate:
		// the pair returns to the original, give or take that single step.
		const c = Colour.parseHex("#3366cc")!;
		const back = Colour.darken(Colour.lighten(c, 0.2), 0.2);
		expect(Math.abs(back.r - c.r)).toBeLessThanOrEqual(1);
		expect(Math.abs(back.g - c.g)).toBeLessThanOrEqual(1);
		expect(Math.abs(back.b - c.b)).toBeLessThanOrEqual(1);
	});

	test("rotate wraps the hue", () => {
		const full = Colour.rotateHue(red, 360);
		expect(full).toMatchObject({ r: 255, g: 0, b: 0 });
	});

	test("channels clamp on construction and adjustment", () => {
		expect(Colour.clamp255(300)).toBe(255);
		expect(Colour.clamp255(-5)).toBe(0);
		expect(Colour.lighten(Colour.parseHex("#ffffff")!, 0.5)).toMatchObject({ r: 255, g: 255, b: 255 });
	});
});

describe("display", () => {
	test("hex renders lowercase and adds alpha only when < 1", () => {
		expect(Colour.toHexString({ r: 255, g: 0, b: 0, a: 1, format: "hex" })).toBe("#ff0000");
		expect(Colour.toHexString({ r: 255, g: 0, b: 0, a: 0.5, format: "hex" })).toBe("#ff000080");
	});

	test("formatColour follows the authored format", () => {
		expect(Colour.formatColour({ r: 255, g: 128, b: 0, a: 1, format: "rgb" })).toBe("rgb(255, 128, 0)");
		expect(Colour.formatColour({ r: 255, g: 0, b: 0, a: 0.5, format: "rgba" })).toBe("rgba(255, 0, 0, 0.5)");
		expect(Colour.formatColour({ r: 255, g: 0, b: 0, a: 1, format: "hsl" })).toBe("hsl(0, 100%, 50%)");
		expect(Colour.formatColour({ r: 255, g: 0, b: 0, a: 1, format: "named", name: "red" })).toBe("red");
	});
});
