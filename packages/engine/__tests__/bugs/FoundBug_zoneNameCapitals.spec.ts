import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { zoneDisplayName } from "@solve-js/packages/time/parselets/shared/ZoneReference";

/**
 * Found bug: a multi-zone time list labelled "Rio de Janeiro" as "Rio De
 * Janeiro". The label is the reader's own text with each word capitalised, and
 * the capitalising raised every letter after a word boundary: the "de" of the
 * city's name, and the letter after an apostrophe.
 *
 * The label now comes from `zoneDisplayName`: a linking word after the first
 * ("de", "of", "es") keeps the case the reader wrote, only a letter that
 * begins a word or a hyphenated part is raised, and nothing the reader
 * capitalised is lowered.
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the lines that exposed it", () => {
	test.each([
		["3pm London in Tokyo, Rio de Janeiro, New York", "Tokyo 11:00 PM, Rio de Janeiro 11:00 AM, New York 10:00 AM"],
		["3pm london in rio de janeiro and new york", "Rio de Janeiro 11:00 AM, New York 10:00 AM"],
		["time difference between rio de janeiro and london", "London is 4 hours ahead of Rio de Janeiro"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("the other multi-word cities keep every word capitalised", () => {
		expect(shown("3pm London in new york, los angeles and hong kong")).toBe("New York 10:00 AM, Los Angeles 7:00 AM, Hong Kong 10:00 PM");
	});
});

describe("zoneDisplayName, the part that raised every letter", () => {
	test("ordinary names", () => {
		expect(zoneDisplayName("tokyo")).toBe("Tokyo");
		expect(zoneDisplayName("new york")).toBe("New York");
		expect(zoneDisplayName("rio de janeiro")).toBe("Rio de Janeiro");
		expect(zoneDisplayName("dar es salaam")).toBe("Dar es Salaam");
		expect(zoneDisplayName("port of spain")).toBe("Port of Spain");
	});

	test("what the reader capitalised is kept, and nothing is lowered", () => {
		expect(zoneDisplayName("Rio De Janeiro")).toBe("Rio De Janeiro");
		expect(zoneDisplayName("NYC")).toBe("NYC");
		expect(zoneDisplayName("UTC")).toBe("UTC");
		expect(zoneDisplayName("sAo paulo")).toBe("SAo Paulo");
	});

	test("apostrophes and hyphens", () => {
		expect(zoneDisplayName("st. john's")).toBe("St. John's");
		expect(zoneDisplayName("port-au-prince")).toBe("Port-Au-Prince");
		expect(zoneDisplayName("de")).toBe("De");
	});

	test("boundary and hostile arguments", () => {
		expect(zoneDisplayName("")).toBe("");
		expect(zoneDisplayName(" ")).toBe(" ");
		expect(zoneDisplayName("rio  de  janeiro")).toBe("Rio  de  Janeiro");
		expect(zoneDisplayName("‮tokyo")).toBe("‮tokyo");
		expect(zoneDisplayName("élan")).toBe("Élan");
		expect(zoneDisplayName("١٢")).toBe("١٢");
		for (const word of PROTOTYPE_WORDS) expect(zoneDisplayName(word)).toBe(word[0].toUpperCase() + word.slice(1));
		expect(zoneDisplayName("de ".repeat(10_000)).length).toBe(30_000);
	});
});

describe("adversarial", () => {
	test("security: prototype words as a zone, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`3pm London in ${word}`);
				expectHonestLine(`3pm London in Tokyo, ${word}`);
			}
		});
	});

	test("security: look-alike and markup-shaped text after the list", () => {
		for (const line of fill("3pm London in Tokyo, X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a time from the line above, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("# Call times\n3pm London in rio de janeiro and tokyo\ntime difference between rio de janeiro and tokyo");
		expect(incremental).toEqual(batch);
		expect(batch[1]).toBe("= Rio de Janeiro 11:00 AM, Tokyo 11:00 PM");
	});

	test("edge: a list of one, and a zone named twice", () => {
		expect(shown("3pm London in rio de janeiro")).toContain("11:00 AM");
		expect(shown("3pm London in rio de janeiro, Rio de Janeiro")).toBe("Rio de Janeiro 11:00 AM, Rio de Janeiro 11:00 AM");
	});
});
