/**
 * `<colour> as rgb|rgba|hsl|hsla|hex` re-tags how a colour displays without
 * touching its channels. `rgb`/`hsl` route through the package's `asConverters`;
 * `hex` is a built-in converter the VM handles for colours directly.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType, type ColourData } from "@solve-js/vm/Value";

function evalValue(source: string) {
	const engine = newTrackedEngine();
	return engine.evaluateExpression(source);
}

function colour(source: string): ColourData {
	const v = evalValue(source);
	expect(v.type).toBe(ValueType.Colour);
	return v.value as ColourData;
}

test("as rgb / rgba / hsl / hsla change the format, not the channels", () => {
	expect(colour('color("#ff0000") as rgb')).toMatchObject({ r: 255, g: 0, b: 0, format: "rgb" });
	expect(colour('color("#ff0000") as hsl')).toMatchObject({ r: 255, g: 0, b: 0, format: "hsl" });
	expect(colour('color("#ff0000") as rgba')).toMatchObject({ r: 255, g: 0, b: 0, format: "rgba" });
});

test("as hex keeps the colour as hex and round-trips", () => {
	expect(colour('rgb(255, 0, 0) as hex')).toMatchObject({ r: 255, g: 0, b: 0, format: "hex" });
	expect(colour('color("#3366cc") as rgb as hex')).toMatchObject({ r: 51, g: 102, b: 204, format: "hex" });
});

test("a non-colour passes through as-rgb unchanged", () => {
	expect(evalValue("5 as rgb").toNumber()).toBe(5);
});
