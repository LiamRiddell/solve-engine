/**
 * The `#hex` literal, and the disambiguation that lets it coexist with markdown.
 * `#` is otherwise a heading (line start) and a comment (mid-line), so this pins
 * both the new colour cases and the markdown cases that must NOT change. The full
 * CSS hex grammar is supported (3/4/6/8 digits), which means an all-hex `#`-run of
 * one of those lengths now reads as a colour, a deliberate, tested flip.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType, type ColourData } from "@solve-js/vm/Value";

/** The colour a whole line evaluates to, or null if the line is not a colour. */
function lineColour(line: string): ColourData | null {
	const engine = newTrackedEngine();
	const result = engine.parseDocument(line);
	const v = result.lines[0]?.result;
	return v && v.type === ValueType.Colour ? (v.value as ColourData) : null;
}

function evalValue(source: string) {
	const engine = newTrackedEngine();
	return engine.evaluateExpression(source)[0];
}

describe("hex literals are colours", () => {
	test.each([
		["#f00", 255, 0, 0],
		["#ff0000", 255, 0, 0],
		["#3366CC", 51, 102, 204],
		["#DEADBE", 222, 173, 190],
		["#face", 255, 170, 204],
		["#c0ffee", 192, 255, 238],
		["#deadbeef", 222, 173, 190],
	])("%s is a colour", (lit, r, g, b) => {
		expect(lineColour(lit)).toMatchObject({ r, g, b });
	});

	test("8-digit literal carries alpha", () => {
		expect(lineColour("#ff000080")!.a).toBeCloseTo(128 / 255, 6);
	});

	test("a hex literal works inside an expression", () => {
		const lit = evalValue("lighten(#3366cc, 20%)");
		expect(lit.type).toBe(ValueType.Colour);
		expect(evalValue("mix(#ff0000, #0000ff)").type).toBe(ValueType.Colour);
		expect((evalValue("#ff0000 as hsl").value as ColourData).format).toBe("hsl");
	});
});

describe("markdown meaning of # is unchanged", () => {
	test.each(["# Heading", "## Heading", "#tag", "#todo", "#project", "#faced", "#facebook"])(
		"%s is not a colour",
		(line) => {
			expect(lineColour(line)).toBeNull();
		},
	);

	test("a mid-line # comment is still a comment", () => {
		expect(evalValue("1 + 2 # note").toNumber()).toBe(3);
	});

	test("a hex-length run with a trailing word char is not a colour", () => {
		// #ff0000zz is 6 hex then letters: a comment, not a colour truncated to 6.
		expect(lineColour("#ff0000zz")).toBeNull();
	});
});
