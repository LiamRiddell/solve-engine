/**
 * User-controlled words used as plain-object keys.
 *
 * Several parse-time tables are looked up by a word the user typed: a converter
 * name (`as hex`), a rounding increment (`to nearest ten`), a compounding
 * interval (`compounding monthly`), a timezone (`in Tokyo`). Each was a plain
 * object read with `TABLE[word]`, so a word that names an INHERITED property,
 * `constructor` or `__proto__`, read a truthy value off `Object.prototype`
 * instead of missing. The lookup then treated that inherited function or object
 * as if it were a real entry, and the expression returned a confident wrong
 * answer (`5 as constructor` was `5`, `5 to nearest constructor` was `NaN`) or
 * leaked an internal error (`2026-04-03 in constructor` surfaced a bytecode
 * fault rather than "unknown zone").
 *
 * No table was ever WRITTEN through one of these keys: `Object.prototype` is
 * untouched, verified at the end. The bug was a read, and the fix is a
 * `hasOwnProperty` guard at each read, so a prototype name misses like any other
 * unknown word. The test is by input, not by table: the malicious word must give
 * the same honest "unknown" the engine gives any other non-word, and the real
 * word must still work.
 */

import { describe, expect, test } from "@jest/globals";
import { EngineError } from "@solve-js/errors/EngineError";
import { ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The two inherited names that survive a `.toLowerCase()` onto a real `Object.prototype` member. */
const PROTO_WORDS = ["constructor", "__proto__"] as const;

/**
 * A code that leaks an engine internal rather than a clean "unknown X": an
 * inherited value emitted into bytecode surfaces as a bytecode/operand fault or
 * an unhandled error, never as the honest refusal the user should see.
 */
function isInternalLeak(code: string | undefined): boolean {
	if (!code) return false;
	return code.includes("BYTECODE") || code === "UNEXPECTED_ERROR" || code === "NON_ENGINE_THROW" || code.includes("INTERNAL");
}

type Outcome =
	| { kind: "value"; value: unknown }
	| { kind: "error"; code: string | undefined }
	| { kind: "throw"; code: string };

/** Evaluate on a throwaway engine, normalising "returned error value", "thrown error" and "plain value" into one shape. */
function outcome(source: string): Outcome {
	const engine = newTrackedEngine();
	try {
		const value = engine.evaluateExpression(source);
		return value.type === ValueType.Error ? { kind: "error", code: value.errorCode } : { kind: "value", value: value.value };
	} catch (thrown) {
		return { kind: "throw", code: thrown instanceof EngineError ? thrown.code : "NON_ENGINE_THROW" };
	} finally {
		engine.clear();
	}
}

/** The floor every guarded site must clear: no confident wrong value, and no leaked internal error. */
function expectHonestUnknown(source: string): void {
	const result = outcome(source);
	expect(result.kind).not.toBe("value");
	if (result.kind !== "value") expect(isInternalLeak(result.code)).toBe(false);
}

describe("a prototype name used as a lookup key misses like any other unknown word", () => {
	test("`as <name>` converter: constructor/__proto__ are unknown, not the operand echoed back", () => {
		for (const word of PROTO_WORDS) {
			const result = outcome(`5 as ${word}`);
			expect(result).toEqual({ kind: "error", code: "UNKNOWN_AS_CONVERTER" });
		}
		// The same answer a plainly-unknown name gets, and the real names still work.
		expect(outcome("5 as totallyMadeUp")).toEqual({ kind: "error", code: "UNKNOWN_AS_CONVERTER" });
		expect(outcome("255 as hex")).toEqual({ kind: "value", value: 255 });
	});

	test("`to nearest <word>` rounding increment: a prototype name does not become a NaN answer", () => {
		for (const word of PROTO_WORDS) expectHonestUnknown(`5 to nearest ${word}`);
		// A real increment still rounds.
		expect(outcome("5 to nearest 10").kind).toBe("value");
	});

	test("`compounding <interval>`: a prototype name does not become a NaN future value", () => {
		for (const word of PROTO_WORDS) expectHonestUnknown(`1000 after 5 years at 3% compounding ${word}`);
		expect(outcome("1000 after 5 years at 3% compounding monthly").kind).toBe("value");
	});

	test("`<date> in <zone>`: a prototype name is an unknown zone, not a leaked bytecode fault", () => {
		for (const word of PROTO_WORDS) {
			expectHonestUnknown(`2026-04-03 in ${word}`);
			expectHonestUnknown(`time in ${word}`);
		}
		// A real zone still resolves.
		expect(outcome("2026-04-03 in Tokyo").kind).toBe("value");
	});
});

describe("a prototype name whose lookup result is emitted or used, not just membership-tested", () => {
	// The dangerous, easy-to-miss shape: the inherited value is not merely tested
	// for presence, it is emitted into bytecode or used as a number, so a miss
	// surfaced as an internal bytecode fault or a NaN answer rather than a clean
	// refusal. Each is now guarded at the read.

	test("a map/reduce function name: `map(constructor, ...)` is an unknown function, not a bytecode-operand fault", () => {
		for (const word of PROTO_WORDS) {
			expectHonestUnknown(`map(${word}, [1,2,3])`);
			expectHonestUnknown(`reduce(${word}, [1,2,3])`);
		}
		expect(outcome("map(x*2, [1,2,3])").kind).toBe("value");
	});

	test("a percentage repeat count: `100 up 10% constructor times` is rejected, not a NaN answer", () => {
		for (const word of PROTO_WORDS) expectHonestUnknown(`100 up 10% ${word} times`);
		expect(outcome("100 up 10% 3 times").kind).toBe("value");
	});

	test("a cooking ingredient name: `300g constructor in cups` is an unknown ingredient, not a NaN conversion", () => {
		for (const word of PROTO_WORDS) expectHonestUnknown(`300g ${word} in cups`);
		expect(outcome("300g flour in cups").kind).toBe("value");
	});

	test("a large-number suffix word: `5 constructor` / `5valueOf` does not silently drop to the bare number", () => {
		for (const word of PROTO_WORDS) expectHonestUnknown(`5 ${word}`);
		// The adjacent suffix table is NOT lowercased, so it is reachable by the
		// mixed-case inherited names too.
		expectHonestUnknown("5valueOf");
		expectHonestUnknown("5toString");
		// A real magnitude word still scales.
		expect(outcome("5 thousand")).toEqual({ kind: "value", value: 5000 });
	});
});

describe("none of these lookups pollutes the global prototype", () => {
	test("Object.prototype is untouched after every prototype-keyed attempt", () => {
		const engine = newTrackedEngine();
		const attempts = PROTO_WORDS.flatMap((word) => [
			`5 as ${word}`,
			`5 to nearest ${word}`,
			`2026-04-03 in ${word}`,
			`1000 after 5 years at 3% compounding ${word}`,
		]);
		try {
			for (const source of attempts) {
				try {
					engine.evaluateExpression(source);
				} catch {
					// A throw is a valid "unknown" outcome; this test asserts only that
					// the shared prototype is untouched, however each attempt ends.
				}
			}
		} finally {
			engine.clear();
		}
		const fresh = {} as Record<string, unknown>;
		expect(fresh.polluted).toBeUndefined();
		expect(fresh.constructor).toBe(Object);
		expect(Object.getPrototypeOf({})).toBe(Object.prototype);
		// No stray own-property was grafted onto the shared prototype.
		expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain("polluted");
	});
});
