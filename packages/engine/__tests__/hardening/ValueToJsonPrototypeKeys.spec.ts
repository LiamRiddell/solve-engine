/**
 * `Value.toJSON` copies a payload's keys as data, whatever they are named.
 *
 * The JSON-safe walk behind it built each plain object by assignment,
 * `out[k] = ...`. A payload key spelled `__proto__` (an own property, as
 * `JSON.parse` makes one) was then read as a request to replace the new
 * object's prototype: the key vanished from the output and the object
 * inherited from the payload's value instead. CodeQL reported the write as a
 * remote property injection. The walk now defines each key as an own property.
 */

import { describe, expect, test } from "@jest/globals";
import { Value, ValueType } from "@solve-js/vm/Value";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";

function payloadJson(payload: unknown): Record<string, unknown> {
	return new Value(ValueType.Symbolic, payload as never).toJSON().value as Record<string, unknown>;
}

describe("Value.toJSON reads every payload key as data", () => {
	test("an own __proto__ key stays a key and does not become the prototype", () => expectPrototypeUntouched(() => {
		const payload = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
		const out = payloadJson(payload);

		expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
		expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
		expect(Object.getOwnPropertyDescriptor(out, "__proto__")?.value).toEqual({ polluted: true });
		expect((out as { polluted?: unknown }).polluted).toBeUndefined();
		expect(out.a).toBe(1);
	}));

	test("every prototype word survives as an own key, nested too", () => expectPrototypeUntouched(() => {
		for (const word of PROTOTYPE_WORDS) {
			const payload = JSON.parse(`{${JSON.stringify(word)}: {${JSON.stringify(word)}: 5}}`);
			const out = payloadJson(payload);
			const inner = Object.getOwnPropertyDescriptor(out, word)?.value as Record<string, unknown>;
			expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
			expect(Object.getOwnPropertyDescriptor(inner, word)?.value).toBe(5);
		}
	}));

	test("bigints still become strings at any depth, and the output is plain JSON", () => {
		const out = payloadJson({ n: 12345678901234567890n, list: [1n, { m: -2n }], s: "x", nil: null });
		expect(out).toEqual({ n: "12345678901234567890", list: ["1", { m: "-2" }], s: "x", nil: null });
		expect(() => JSON.stringify(out)).not.toThrow();
	});

	test("an empty payload object and a scalar payload are unchanged", () => {
		expect(payloadJson({})).toEqual({});
		expect(new Value(ValueType.Number, 0).toJSON().value).toBe(0);
		expect(new Value(ValueType.String, "__proto__").toJSON().value).toBe("__proto__");
	});
});
