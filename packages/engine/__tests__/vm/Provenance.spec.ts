/**
 * The provenance merge rules (`vm/Provenance.ts`), on their own.
 *
 * Arithmetic carries a value's sources by merging lists, so the merge has to
 * keep every distinct record once, keep the left operand's first, and hand back
 * one of its inputs whenever nothing new is added: the common case of a sourced
 * value meeting a plain number must allocate nothing.
 */
import { describe, expect, test } from "@jest/globals";
import { combineSources, sourcesOfValues, stampFrozen, withSources, type ValueSource } from "@solve-js/vm/Provenance";
import { numberValue } from "@solve-js/vm/Value";

const bank: ValueSource = { provider: "Test Bank", kind: "primed", fetchedAt: 1_000, subject: "USD/GBP" };
const feed: ValueSource = { provider: "Frankfurter", kind: "live", fetchedAt: 2_000, subject: "EUR/GBP" };
const past: ValueSource = { provider: "host", kind: "historical", fetchedAt: 3_000, subject: "USD/GBP", asOf: "2024-01-15" };

describe("combineSources", () => {
	test("nothing on either side is nothing", () => {
		expect(combineSources(undefined, undefined)).toBeUndefined();
	});

	test("one side empty hands back the other side's list itself", () => {
		const list = [bank];
		expect(combineSources(list, undefined)).toBe(list);
		expect(combineSources(undefined, list)).toBe(list);
	});

	test("the same list twice is that list", () => {
		const list = [bank, feed];
		expect(combineSources(list, list)).toBe(list);
	});

	test("two lists merge, left first, each record once", () => {
		expect(combineSources([bank, feed], [feed, past])).toEqual([bank, feed, past]);
	});

	test("records equal in every field count as one, however they were built", () => {
		const copy: ValueSource = { ...bank };
		const left = [bank];
		expect(combineSources(left, [copy])).toBe(left);
	});

	test("a record differing only in its freeze time is a different record", () => {
		expect(combineSources([bank], [{ ...bank, frozenAt: 5_000 }])).toHaveLength(2);
	});
});

describe("sourcesOfValues", () => {
	test("gathers every value's sources in order, and none when none carry any", () => {
		const a = numberValue(1);
		a.sources = [bank];
		const b = numberValue(2);
		const c = numberValue(3);
		c.sources = [feed, bank];
		expect(sourcesOfValues([a, b, c])).toEqual([bank, feed]);
		expect(sourcesOfValues([b, numberValue(4)])).toBeUndefined();
	});
});

describe("stampFrozen", () => {
	test("stamps every record with the freeze time, keeping a record's earlier stamp", () => {
		const earlier: ValueSource = { ...feed, frozenAt: 100 };
		expect(stampFrozen([bank, earlier], 900)).toEqual([{ ...bank, frozenAt: 900 }, earlier]);
	});

	test("a value with no sources stays without", () => {
		expect(stampFrozen(undefined, 900)).toBeUndefined();
	});
});

describe("withSources", () => {
	test("sets the sources on a fresh value, and leaves it alone when there are none", () => {
		const v = withSources(numberValue(1), [bank]);
		expect(v.sources).toEqual([bank]);
		expect(withSources(numberValue(2), undefined).sources).toBeUndefined();
	});

	test("a recycled arena Value never inherits another value's sources", () => {
		const v = numberValue(1);
		v.sources = [bank];
		v.frozen = { at: 1, key: "k" };
		v.recycle(0, 5);
		expect(v.sources).toBeUndefined();
		expect(v.frozen).toBeUndefined();
	});
});
