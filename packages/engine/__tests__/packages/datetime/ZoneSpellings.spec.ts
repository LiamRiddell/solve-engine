/**
 * Which spellings of a zone `in <zone>` reads, and which it does not.
 *
 * A two-word city name was advertised by the refusal message and by the docs
 * and was unreachable: the time package fuses `New York` into one token, and
 * the parselet that reads `in <target>` did not accept that token, so the line
 * threw a parse error instead of answering. It is accepted now.
 *
 * A signed offset was not read: `2026-04-03 in GMT+9` parsed as
 * `(2026-04-03 in GMT) + 9`, first nine milliseconds and then a refusal of the
 * bare 9. It is read as the fixed offset now (#730), and the full account of
 * that form is `__tests__/bugs/Issue730_signedUtcOffset.spec.ts`.
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

describe("a signed offset, read as the fixed offset it names (#730)", () => {
	test("the day on that clock, not an addition", () => {
		expect(answer("3 April 2026 in GMT+9")).toBe("Friday, April 3, 2026");
		expect(answer("3 April 2026 in UTC-5:30")).toBe("Friday, April 3, 2026");
	});

	test("a number with a unit after it is still arithmetic", () => {
		expect(answer("2026-04-03T15:00 in UTC - 5 hours")).toBe("Friday, April 3, 2026, 10:00:00 AM");
	});
});

describe("what a name that is no zone does", () => {
	test("a unit and an unknown name are refused differently", () => {
		expect(answer("3 April 2026 in furlongs")).toContain("cannot be read in");
		expect(answer("3 April 2026 in Atlantis")).toContain("not a time zone");
	});
});
