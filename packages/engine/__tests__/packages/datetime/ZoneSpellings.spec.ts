/**
 * Which spellings of a zone `in <zone>` reads, and which it does not.
 *
 * A two-word city name was advertised by the refusal message and by the docs
 * and was unreachable: the time package fuses `New York` into one token, and
 * the parselet that reads `in <target>` did not accept that token, so the line
 * threw a parse error instead of answering. It is accepted now.
 *
 * A signed offset is still not read, and this pins that so it cannot change
 * silently. `2026-04-03 in GMT+9` parses as `(2026-04-03 in GMT) + 9`, and
 * adding a bare number to a date adds milliseconds, so the answer is the same
 * day one hour in rather than nine hours on. The root of it is that a date
 * plus a bare number is milliseconds at all, which is a separate question from
 * zones; until that is settled the docs name the boundary and point at the
 * spellings that work.
 */

import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

const answer = (expression: string): string => {
	const engine = newTrackedEngine();
	try {
		return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
	} finally {
		engine.clear();
	}
};

describe("the spellings that work", () => {
	test("a one-word city", () => {
		expect(answer("3 April 2026 in Tokyo")).toBe("Friday, April 3, 2026");
	});

	test("a two-word city, which used to throw a parse error", () => {
		expect(answer("3 April 2026 in New York")).toBe("Friday, April 3, 2026");
		expect(answer("3 April 2026 in Los Angeles")).toBe("Friday, April 3, 2026");
	});

	test("a standard abbreviation, and UTC", () => {
		expect(answer("3 April 2026 in JST")).toBe("Friday, April 3, 2026");
		expect(answer("3 April 2026 in UTC")).toContain("April 3, 2026");
	});
});

describe("the spelling that does not, named as a boundary", () => {
	test("a signed offset is read as an addition, not as a zone", () => {
		// `(3 April 2026 in GMT) + 9`, nine milliseconds. Documented on the
		// time page, which points at `in Tokyo` and `in JST` instead.
		expect(answer("3 April 2026 in GMT+9")).toBe(answer("3 April 2026 in GMT"));
	});
});

describe("what a name that is no zone does", () => {
	test("a unit and an unknown name are refused differently", () => {
		expect(answer("3 April 2026 in furlongs")).toContain("cannot be read in");
		expect(answer("3 April 2026 in Atlantis")).toContain("not a time zone");
	});
});
