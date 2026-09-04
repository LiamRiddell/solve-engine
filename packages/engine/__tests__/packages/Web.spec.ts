/**
 * Web: the sums a front-end or an image needs, beside the ones units already do.
 *
 * `px in rem` ships as an ordinary unit conversion against the CSS default root
 * font size of 16px. What is pinned here is the three things that default
 * cannot answer: a page whose root is not 16px, the shape of a screen or an
 * image, and the other side of a resize.
 *
 * The thing to get wrong is the claim, not the arithmetic. `x` between two
 * numbers is a multiplication for anyone whose `x4` is a variable, `resize` is
 * an ordinary word, and `at` is the rate operator everywhere else in the
 * engine. Each form is claimed only when its whole shape is there, so the last
 * describe block asserts what those three still mean.
 */

import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { aspectRatioOf, atRootFontSize, resizeToSide } from "@solve-js/packages/web";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Evaluate a line, returning the display or the message a refusal carries. */
const answer = (expression: string): string => {
	const engine = newTrackedEngine();
	try {
		return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
	} catch (error) {
		return (error as Error).message;
	} finally {
		engine.clear();
	}
};

describe("the shape of a screen or an image", () => {
	test("a pair written the way a screen is sold", () => {
		expect(answer("1920x1080 as ratio")).toBe("16:9");
		expect(answer("3840x2160 as ratio")).toBe("16:9");
		expect(answer("1024x768 as ratio")).toBe("4:3");
	});

	test("with or without the spaces, and with `in` as well as `as`", () => {
		expect(answer("1920 x 1080 as ratio")).toBe("16:9");
		expect(answer("1920x1080 in ratio")).toBe("16:9");
	});
});

describe("resizing, keeping the shape", () => {
	test("a target width sets the height, and a target height sets the width", () => {
		expect(answer("resize 4000x3000 to 1200 wide")).toBe("1200 x 900");
		expect(answer("resize 4000x3000 to 900 tall")).toBe("1200 x 900");
	});

	test("the other side is whole pixels, because an image file is", () => {
		// 333 * 500 / 1000 is 166.5, and half a pixel is not a size a file has.
		expect(answer("resize 1000x333 to 500 wide")).toBe("500 x 167");
	});

	test("the words for each side that a person actually writes", () => {
		expect(answer("resize 4000x3000 to 1200 width")).toBe("1200 x 900");
		expect(answer("resize 4000x3000 to 900 high")).toBe("1200 x 900");
	});
});

describe("a root font size that is not the default", () => {
	test("a rem becomes pixels against the stated base", () => {
		expect(answer("1.5rem at 16px base")).toBe("24.00 px");
		expect(answer("1.5rem at 20px base")).toBe("30.00 px");
	});

	test("and pixels become rem the same way", () => {
		expect(answer("24px at 20px base")).toBe("1.20 rem");
	});

	test("it binds to the size beside it, not to the sum", () => {
		// 8px against a 20px root is 0.4rem, added to the 2rem on the left.
		expect(answer("2rem + 8px at 20px base")).toBe("2.40 rem");
	});
});

describe("what is refused, and how", () => {
	test("a size in a unit a root font size does not relate", () => {
		expect(answer("5 kg at 20px base")).toContain('"kg" is neither');
	});

	test("a root font size that is not a size at all", () => {
		expect(answer("1.5rem at 0px base")).toContain("above zero");
	});

	test("a resize missing the size it resizes to", () => {
		expect(answer("resize 4000x3000")).toContain('expects "to"');
	});

	test("a resize that does not say which side the size is", () => {
		expect(answer("resize 4000x3000 to 1200")).toContain('"wide" or "tall"');
	});
});

describe("what these forms deliberately leave alone", () => {
	test("`x` between two numbers is still a multiplication", () => {
		expect(answer("3x4")).toContain("x4");
		expect(answer("1920x1080")).toContain("x1080");
	});

	test("`at` is still the rate operator", () => {
		expect(answer("30 hours at $30/hour")).toBe("$900.00");
	});

	test("and the 16px default conversion is untouched", () => {
		expect(answer("16px in rem")).toBe("1.00 rem");
		expect(answer("1.5rem in px")).toBe("24.00 px");
	});
});

describe("the arithmetic, directly", () => {
	test("a ratio is only for whole positive counts of pixels", () => {
		expect(aspectRatioOf(1920, 1080)).toBe("16:9");
		expect(aspectRatioOf(1920.5, 1080)).toBeNull();
		expect(aspectRatioOf(0, 1080)).toBeNull();
	});

	test("a resize rounds to the nearest whole pixel and never to zero", () => {
		expect(resizeToSide(1000, 333, 500, "width")).toEqual({ width: 500, height: 167 });
		expect(resizeToSide(4000, 3000, 900, "height")).toEqual({ width: 1200, height: 900 });
		expect(resizeToSide(4000, 10, 100, "width")).toEqual({ width: 100, height: 1 });
	});

	test("a root font size relates the two units and refuses the rest", () => {
		expect(atRootFontSize(1.5, "rem", 20)).toEqual({ amount: 30, unit: "px" });
		expect(atRootFontSize(24, "px", 20)).toEqual({ amount: 1.2, unit: "rem" });
		expect(atRootFontSize(24, "em", 20)).toBeNull();
		expect(atRootFontSize(24, "px", 0)).toBeNull();
	});
});
