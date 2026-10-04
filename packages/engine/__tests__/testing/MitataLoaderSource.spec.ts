import { describe, expect, test } from "@jest/globals";
import { uniqueLoadMark } from "@tools/testUtils";

/**
 * The benchmark helper loads mitata through a `Function` whose source must
 * differ on every load. V8 caches a `Function`'s compiled code by its source,
 * and the cached copy keeps the dynamic-import callback of the test file that
 * first compiled it, so with one source for every file a later benchmark file
 * reached a torn-down file's callback and failed inside jest-runtime.
 */
describe("uniqueLoadMark", () => {
	test("no two marks are the same, within a file or across many loads", () => {
		const marks = new Set(Array.from({ length: 2_000 }, () => uniqueLoadMark()));
		expect(marks.size).toBe(2_000);
	});

	test("a mark names the process and is safe inside a line comment", () => {
		const mark = uniqueLoadMark();
		expect(mark.startsWith(`${process.pid}-`)).toBe(true);
		expect(mark).toMatch(/^[0-9a-z-]+$/);
		// Only [0-9a-z-], so it cannot hold a line break that would end the comment.
		expect(/^[0-9a-z-]+$/.test(mark)).toBe(true);
	});
});
