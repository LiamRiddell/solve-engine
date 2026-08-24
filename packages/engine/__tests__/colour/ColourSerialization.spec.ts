/**
 * A colour result must reach a frontend with enough structure to draw a swatch,
 * on BOTH host paths: the live `Value` (read directly in-process) and the
 * clone-safe `SerializedValue` a worker host receives. This pins the `colour`
 * DTO shape and that it survives the two boundaries a host sends it across.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";
import { serializeValue } from "@solve-js/worker/serialize";

function evalValue(source: string) {
	const engine = newTrackedEngine();
	return engine.evaluateExpression(source)[0];
}

test("the colour DTO carries hex, channels, format and a render-ready css string", () => {
	const dto = serializeValue(evalValue('color("#ff0000")'));
	expect(dto.type).toBe(ValueType.Colour);
	expect(dto.number).toBe(0);
	expect(dto.colour).toEqual({ hex: "#ff0000", r: 255, g: 0, b: 0, a: 1, format: "hex", css: "#ff0000" });
});

test("css matches the authored format", () => {
	expect(serializeValue(evalValue("rgb(255, 128, 0)")).colour!.css).toBe("rgb(255, 128, 0)");
	expect(serializeValue(evalValue("rgba(255, 0, 0, 0.5)")).colour!.css).toBe("rgba(255, 0, 0, 0.5)");
	expect(serializeValue(evalValue('color("red")')).colour!.css).toBe("red");
});

test("alpha reaches the hex string", () => {
	expect(serializeValue(evalValue("rgba(255, 0, 0, 0.5)")).colour!.hex).toBe("#ff000080");
});

test("the DTO survives structuredClone and JSON", () => {
	const dto = serializeValue(evalValue("hsl(210, 50, 40)"));
	expect(structuredClone(dto)).toEqual(dto);
	expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
});

test("a non-colour result carries no colour field", () => {
	expect(serializeValue(evalValue("2 + 2")).colour).toBeUndefined();
});
