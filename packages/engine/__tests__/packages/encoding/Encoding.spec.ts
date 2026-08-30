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

const JWT =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const CLAIMS = '{"sub":"1234567890","name":"John Doe","iat":1516239022}';

describe("reading a token apart", () => {
	test("jwt decodes the payload claims, function and `from` spellings agreeing", () => {
		expect(text(`jwt("${JWT}")`)).toBe(CLAIMS);
		expect(text(`"${JWT}" from jwt`)).toBe(CLAIMS);
	});

	test("the signature is neither required nor checked", () => {
		// The same token with its signature dropped still reads: this reports what
		// a token says, not whether it is genuine.
		const unsigned = `${JWT.split(".").slice(0, 2).join(".")}.`;
		expect(text(`jwt("${unsigned}")`)).toBe(CLAIMS);
	});

	test("a malformed token is a clear error, not a half-read result", () => {
		expect(newTrackedEngine().evaluateExpression('jwt("not-a-token")').type).toBe(ValueType.Error);
		expect(newTrackedEngine().evaluateExpression('jwt("a.b.c")').type).toBe(ValueType.Error);
	});

	test("query parses a query string, decoding escapes and `+`, both spellings", () => {
		expect(text('query("name=John+Doe&page=2")')).toBe('{"name":"John Doe","page":"2"}');
		expect(text('"a%20b=1&c=2" from query')).toBe('{"a b":"1","c":"2"}');
	});

	test("`jwt` and `query` stay usable as variable names", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":jwt = 3");
		expect(engine.evaluateLine(2, "jwt + 1").toNumber()).toBe(4);
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
