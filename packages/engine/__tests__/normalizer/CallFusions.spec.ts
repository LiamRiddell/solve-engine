/**
 * The shared call-fusion mechanism. Every package's `name(` word is fused by one
 * engine rule reading the merged `callFusions` map, replacing the seven
 * hand-written per-package rules. This pins that consolidation: each package's
 * calls still fuse and evaluate, and unregistering a package drops exactly its
 * call words, not another's.
 */
import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ValueType } from "@solve-js/vm/Value";

describe("callFusions: every package's name( still fuses and evaluates", () => {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	test.each([
		['sha256("hello")', "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"],
		['base64("Hi")', "SGk="],
		['upper("hi")', "HI"],
	])("%s", (source, expected) => {
		const v = engine.evaluateExpression(source);
		expect(v.type).not.toBe(ValueType.Error);
		expect(String(v.value)).toBe(expected);
	});

	test("numeric call forms too (ratio, percentile)", () => {
		expect(String(engine.evaluateExpression("ratio(1920, 1080)").value)).toBe("16:9");
		expect(engine.evaluateExpression("percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)").toNumber()).toBeCloseTo(9.1, 6);
	});

});

describe("unregistering a package drops exactly its call words", () => {
	const isHash = (s: string) => /^[0-9a-f]{64}$/.test(s);
	test("removing solve-hash unmakes sha256( but leaves base64(", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		// sha256( computes a 64-hex digest while the package is registered.
		expect(isHash(String(engine.evaluateExpression('sha256("hello")').value))).toBe(true);

		engine.unregisterPackage("solve-hash");

		// sha256 is no longer a call word (a fresh, uncached input), so `sha256(...)`
		// no longer fuses: it either fails to parse or does not compute a digest.
		// Either way it is not a hash. base64 (a different package) is untouched.
		let after: string;
		try {
			after = String(engine.evaluateExpression('sha256("world")').value);
		} catch {
			after = "did-not-parse";
		}
		expect(isHash(after)).toBe(false);
		expect(String(engine.evaluateExpression('base64("Ho")').value)).toBe("SG8=");
	});
});
