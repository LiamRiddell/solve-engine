import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #801: `compounding semi-annually` was refused, and the refusal listed
 * semi-annually as accepted: the hyphen split the word before the interval was
 * looked up, so the lookup saw `semi`. `compounded monthly`, the commoner
 * English, was a trailing token.
 */

function one(text: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(text) as Value);
	} catch (error) {
		return `THROWS ${(error as { code?: string }).code}: ${(error as Error).message}`;
	}
}

const ON = "interest on 1000 over 3 years at 5%";

describe("twice-yearly compounding", () => {
	test.each(["semi-annually", "semiannually", "half-yearly", "Semi-Annually"])("compounding %s", (interval) => {
		expect(one(`${ON} compounding ${interval}`)).toBe("= 159.69");
	});

	test("it sits between annual and quarterly", () => {
		expect(one(`${ON} compounding annually`)).toBe("= 157.63");
		expect(one(`${ON} compounding quarterly`)).toBe("= 160.75");
	});

	test("the growth form reads it too", () => {
		expect(one("$1000 after 3 years at 5% compounding semi-annually")).toBe("= $1,159.69");
	});
});

describe("compounded", () => {
	test("reads as compounding after a rate", () => {
		expect(one(`${ON} compounded monthly`)).toBe(one(`${ON} compounding monthly`));
		expect(one(`${ON} compounded semi-annually`)).toBe("= 159.69");
	});

	test("stays an ordinary name everywhere else", () => {
		expect(one("compounded = 3")).toBe("= 3");
	});
});

describe("adversarial", () => {
	test("a half-written interval is still refused by name", () => {
		expect(one(`${ON} compounding semi`)).toMatch(/^THROWS UNKNOWN_COMPOUNDING_INTERVAL: compounding semi: expected one of/);
	});

	test("a hyphenated word that is not an interval is refused, not partly read", () => {
		expect(one(`${ON} compounding semi-weekly`)).toMatch(/^THROWS UNKNOWN_COMPOUNDING_INTERVAL/);
	});

	test("every interval the refusal lists is one it reads", () => {
		const message = one(`${ON} compounding never`);
		const listed = message.slice(message.indexOf("expected one of ") + "expected one of ".length).split(", ");
		expect(listed.length).toBeGreaterThan(5);
		for (const interval of listed) expect(one(`${ON} compounding ${interval}`)).toMatch(/^= /);
	});
});
