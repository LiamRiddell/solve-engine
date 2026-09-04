/**
 * `Value.clone()` carries every field, and `persistentValue()` is that clone.
 *
 * What was wrong: `persistentValue()` copied the sidecars it knew by name
 * (`exact`, `rational`, `uncertainty`) and silently dropped the two it did not
 * (`decimalPlaces`, `timedOut`). It runs on every HALT and STORE_VAR while the
 * arena is on, which is exactly the viewport path, so `3.14159 to 4 dp`
 * displayed as 3.14 there and as 3.1416 on a single line.
 *
 * What is pinned: the clone is a fresh object equal to the original in every
 * own field, including ones this test does not know the name of (it stamps a
 * sentinel on every field `recycle()` clears, so a sidecar added later and
 * cleared there is checked without being named here); the two dropped sidecars
 * survive `persistentValue()`; and the copy is independent of the original.
 */

import { describe, expect, test } from "@jest/globals";
import { Value, ValueType, numberValue, persistentValue } from "@solve-js/vm/Value";
import { decimalFromLiteral } from "@solve-js/decimal";
import { rational } from "@solve-js/symbolic/Rational";

/** A Number Value with every sidecar the class declares set to something. */
function fullyLoaded(): Value {
	const v = numberValue(3.1416);
	v.exact = decimalFromLiteral("3.1416");
	v.rational = rational(31416n, 10000n);
	v.uncertainty = 0.0005;
	v.decimalPlaces = 4;
	v.timedOut = true;
	return v;
}

describe("Value.clone()", () => {
	test("is a fresh object equal to the original in every own field", () => {
		const original = fullyLoaded();
		const copy = original.clone();
		expect(copy).not.toBe(original);
		for (const key of Object.keys(original) as (keyof Value)[]) {
			expect(copy[key]).toBe(original[key]);
		}
	});

	test("carries a field it was never told the name of", () => {
		// recycle() assigns every declared field, which makes each one an own
		// property even when it is undefined; stamping a sentinel on those is how
		// a sidecar added later (and cleared in recycle(), as they all must be)
		// is checked here without this test naming it.
		const original = new Value(ValueType.Number, 0);
		original.recycle(ValueType.Number, 2.5);
		const stamped = original as unknown as Record<string, unknown>;
		const sentinel = { marker: "sentinel" };
		for (const key of Object.keys(stamped)) {
			if (stamped[key] === undefined) stamped[key] = sentinel;
		}
		const copy = original.clone() as unknown as Record<string, unknown>;
		for (const key of Object.keys(stamped)) {
			expect(copy[key]).toBe(stamped[key]);
		}
	});

	test("the copy is independent of the original", () => {
		const original = fullyLoaded();
		const copy = original.clone();
		copy.decimalPlaces = 1;
		copy.uncertainty = undefined;
		expect(original.decimalPlaces).toBe(4);
		expect(original.uncertainty).toBe(0.0005);
	});

	test("a unit and a cached number come across too", () => {
		const original = new Value(ValueType.Uom, 5, "kg");
		const copy = original.clone();
		expect(copy.type).toBe(ValueType.Uom);
		expect(copy.unit).toBe("kg");
		expect(copy.toNumber()).toBe(5);
	});
});

describe("persistentValue()", () => {
	test("keeps the display precision and the timed-out flag it used to drop", () => {
		const original = fullyLoaded();
		const persisted = persistentValue(original);
		expect(persisted).not.toBe(original);
		expect(persisted.decimalPlaces).toBe(4);
		expect(persisted.timedOut).toBe(true);
	});

	test("still keeps the three sidecars it always copied", () => {
		const original = fullyLoaded();
		const persisted = persistentValue(original);
		expect(persisted.exact).toBe(original.exact);
		expect(persisted.rational).toBe(original.rational);
		expect(persisted.uncertainty).toBe(0.0005);
	});
});
