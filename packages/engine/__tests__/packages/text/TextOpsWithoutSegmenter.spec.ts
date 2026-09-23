/**
 * The text operations in a runtime with no `Intl.Segmenter` (issue #531).
 *
 * Counting and reversal use grapheme clusters where the runtime can segment
 * them, and fall back to code points where it cannot. The fallback still keeps
 * an emoji's two surrogate halves together; it only loses the joining of
 * modifiers, flags and combining marks, which is the best a runtime without a
 * segmenter can do.
 */

import { afterAll, beforeAll, describe, expect, jest, test } from "@jest/globals";

describe("without Intl.Segmenter the count falls back to code points", () => {
	const intl = Intl as unknown as { Segmenter?: unknown };
	const original = intl.Segmenter;
	let ops: typeof import("@solve-js/packages/text/TextOps");

	beforeAll(() => {
		delete intl.Segmenter;
		// A fresh copy of the module, so its cached segmenter is built now,
		// against the runtime with the segmenter removed.
		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			ops = require("@solve-js/packages/text/TextOps");
		});
	});

	afterAll(() => {
		intl.Segmenter = original;
	});

	test("a surrogate pair is still one character", () => {
		expect(ops.textLength("a😀b")).toBe(3);
		expect(ops.textReverse("a😀b")).toBe("b😀a");
	});

	test("a modifier is its own code point", () => {
		expect(ops.textLength("👍🏽")).toBe(2);
	});
});
