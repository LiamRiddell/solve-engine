/**
 * Text-encoding converters (issue #188): base64, URL and hex bytes, each with
 * an encode (`as`) and a decode (`from`) direction, plus the `base64(...)`
 * function spelling. Encoding turns text into a safe plain form; decoding reads
 * it back, so the two round-trip.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";

const text = (source: string) => String(newTrackedEngine().evaluateExpression(source).value);
/** The displayed result, for values whose text form differs from their raw value (e.g. a hex number). */
const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");

describe("encode with `as`", () => {
	test("base64", () => {
		expect(text('"hello" as base64')).toBe("aGVsbG8=");
	});

	test("the function spelling agrees with the converter", () => {
		expect(text('base64("Hello, World!")')).toBe("SGVsbG8sIFdvcmxkIQ==");
	});

	test("url encoding escapes the space, ampersand and equals", () => {
		expect(text('"a b&c=1" as url')).toBe("a%20b%26c%3D1");
	});

	test("hex bytes is the two-word target, distinct from `as hex`", () => {
		expect(text('"Hi" as hex bytes')).toBe("48 69");
		// `as hex` keeps its own meaning: a number shown in base 16.
		expect(shown("255 as hex")).toBe("0xFF");
	});
});

describe("decode with `from`", () => {
	test("base64, url and hex bytes each read back", () => {
		expect(text('"aGVsbG8=" from base64')).toBe("hello");
		expect(text('"a%20b%26c%3D1" from url')).toBe("a b&c=1");
		expect(text('"48 69" from hex bytes')).toBe("Hi");
	});

	test("encode then decode is the identity", () => {
		expect(text('"round trip café" as base64 from base64')).toBe("round trip café");
	});

	test("a multi-byte character survives the round trip", () => {
		expect(text('"héllo 🌍" as base64 from base64')).toBe("héllo 🌍");
	});
});

describe("the boundaries", () => {
	test("encoding a non-text value is a clear error, not a silent coercion", () => {
		expect(newTrackedEngine().evaluateExpression("5 as base64").type).toBe(ValueType.Error);
	});

	test("decoding invalid input is reported, not returned as mangled text", () => {
		expect(newTrackedEngine().evaluateExpression('"not valid base64!" from base64').type).toBe(ValueType.Error);
	});

	test("`base64` stays usable as a variable name", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":base64 = 7");
		expect(engine.evaluateLine(2, "base64 + 1").toNumber()).toBe(8);
	});
});
