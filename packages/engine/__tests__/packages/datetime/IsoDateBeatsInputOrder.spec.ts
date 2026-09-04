/**
 * An ISO date is read as ISO whatever input order is configured.
 *
 * `date.inputOrder` fixes how an ambiguous numeric date is read. DMY and MDY
 * require a one- or two-digit leading group, so a hyphen date starting with a
 * four-digit year declined every reading, the rule fell through, and the line
 * became the arithmetic it is spelled identically to: a host that set MDY for
 * its US readers turned `2026-04-03` into 2,019 and `2026-04-03 + 1 day` into
 * "2,020 day", in every document, silently. A four-digit leading group is
 * neither a day nor a month, so there is nothing for an order to resolve; the
 * ISO reading is now taken before the order is consulted.
 *
 * The boundary: hyphen only. A slash date starting with four digits
 * (`2026/04/03`) is claimed by `YMD` alone, which is what the input-order
 * table on the date-literals page documents, and is unchanged here.
 */

import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { DateInputOrder } from "@solve-js/constants/Configuration";
import { formatValue } from "@solve-js/format/FormatEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";

const ORDERS: DateInputOrder[] = ["auto", "DMY", "MDY", "YMD"];

const read = (expression: string, inputOrder: DateInputOrder): string => {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES, config: { date: { inputOrder } } });
	try {
		return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
	} finally {
		engine.clear();
	}
};

describe("a hyphen date with a four-digit year", () => {
	test("is that date under every input order", () => {
		for (const order of ORDERS) {
			expect(read("2026-04-03", order)).toBe("Friday, April 3, 2026");
			expect(read("2023-12-25", order)).toBe("Monday, December 25, 2023");
		}
	});

	test("stays a date when it is used in arithmetic", () => {
		for (const order of ORDERS) {
			expect(read("2026-04-03 + 1 day", order)).toBe("Saturday, April 4, 2026");
		}
	});

	test("is still refused when its groups are not a calendar date", () => {
		for (const order of ORDERS) {
			// Month 13 is no date under any order, so the line stays arithmetic.
			expect(read("2026-13-03", order)).toBe("2,010");
		}
	});

	test("and an unpadded one reads the same way", () => {
		for (const order of ORDERS) {
			expect(read("2024-5-3", order)).toBe("Friday, May 3, 2024");
		}
	});
});

describe("what the order still decides", () => {
	test("a slash date, as the input-order table documents", () => {
		expect(read("12/25/2023", "MDY")).toBe("Monday, December 25, 2023");
		expect(read("25/12/2023", "DMY")).toBe("Monday, December 25, 2023");
		expect(read("2023/12/25", "YMD")).toBe("Monday, December 25, 2023");
	});

	test("and a two-digit-leading hyphen date, which really is ambiguous", () => {
		expect(read("12-25-2023", "MDY")).toBe("Monday, December 25, 2023");
		expect(read("25-12-2023", "DMY")).toBe("Monday, December 25, 2023");
	});

	test("a spaced chain is arithmetic under every order, as before", () => {
		for (const order of ORDERS) {
			expect(read("2024 - 5 - 3", order)).toBe("2,016");
		}
	});
});
