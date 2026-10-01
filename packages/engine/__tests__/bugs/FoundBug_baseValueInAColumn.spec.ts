import { describe, expect, test } from "@jest/globals";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { ValueType, bigIntValue, hexValue, numberValue, stringValue, uomValue } from "@solve-js/vm/Value";
import { numberOfBase } from "@solve-js/vm/ExactIntegers";

/**
 * Found bug: a value shown in a base could not go into `total above`: `255 in
 * hex` above it was refused as "not a plain number or unit value". The span
 * aggregates (`total above`, `sum above`, `average above`, `count`, `min`,
 * `max` and `median above`, a line range, a section total and a tag total or
 * breakdown) took a Number or a quantity and refused every other type, and a
 * number in a base has a type of its own. `in hex` changes only how a number
 * is written, so each now reads the line through `numberOfBase`, which turns a
 * value in a base into the plain number it is, exact past 2^53, before its
 * type test. The total is a plain decimal number, since the lines above can be
 * in different bases; `total above in hex` writes it in one.
 */

/** A document's lines through both passes, which must agree. */
function both(text: string): string[] {
	const { batch, incremental } = expectHonestDocument(text);
	expect(incremental).toEqual(batch);
	return batch;
}

describe("the lines that exposed it", () => {
	test("each above aggregate reads a number in a base as its number", () => {
		const doc = "255 in hex\n0b1010 as binary\n5\n";
		expect(both(`${doc}total above`)[3]).toBe("= 270");
		expect(both(`${doc}sum above`)[3]).toBe("= 270");
		expect(both(`${doc}average above`)[3]).toBe("= 90");
		expect(both(`${doc}count above`)[3]).toBe("= 3");
		expect(both(`${doc}min above`)[3]).toBe("= 5");
		expect(both(`${doc}max above`)[3]).toBe("= 255");
		expect(both(`${doc}median above`)[3]).toBe("= 10");
		expect(both(`${doc}total above in hex`)[3]).toBe("= 0x10E");
	});

	test("a line range, a section and a tag read it too", () => {
		expect(both("255 in hex\n1\nsum(line 1 : line 2)")[2]).toBe("= 256");
		expect(both("255 in hex\n1\naverage(line 1 : line 2)")[2]).toBe("= 128");
		expect(both("# Ports\n0x50 as hex\n0x1BB in hex\ntotal of section \"Ports\"")[3]).toBe("= 523");
		expect(both("255 in hex #a\n10 #a\ntotal of #a")[2]).toBe("= 265");
		expect(both("255 in hex #a\n45 #b\ntotal by tag")[2]).toBe("= a 255 (85%) · b 45 (15%)");
	});

	test("what was right stays right: text and a date are still refused, a plain column totals as before", () => {
		expect(both("\"x\"\n1\ntotal above")[2]).toMatch(/^ERROR Line 1 is not a plain number or unit value/);
		expect(both("10\n20\ntotal above")[2]).toBe("= 30");
		expect(both("$5\n255 in hex\ntotal above")[2]).toBe(both("$5\n255\ntotal above")[2]);
	});
});

describe("numberOfBase", () => {
	test("ordinary: a number in a base is its plain number; anything else is returned as it is", () => {
		const v = numberOfBase(hexValue(255, "hex"));
		expect(v.type).toBe(ValueType.Number);
		expect(v.value).toBe(255);
		const plain = numberValue(3);
		expect(numberOfBase(plain)).toBe(plain);
		const metres = uomValue(3, "m");
		expect(numberOfBase(metres)).toBe(metres);
	});

	test("boundary: zero, a negative, a bigint past 2^53 exact, one past the largest double, and sources kept", () => {
		expect(Object.is(numberOfBase(hexValue(-0, "hex")).value, 0)).toBe(true);
		expect(numberOfBase(hexValue(-255, "bin")).value).toBe(-255);
		const big = numberOfBase(hexValue(9007199254740993n, "hex"));
		expect(big.type).toBe(ValueType.Number);
		expect(big.rational?.n).toBe(9007199254740993n);
		expect(numberOfBase(hexValue(1n << 2000n, "hex")).type).toBe(ValueType.BigInt);
		const sourced = hexValue(1, "hex");
		sourced.sources = [];
		expect(numberOfBase(sourced).sources).toBe(sourced.sources);
	});

	test("hostile: text, a big integer and a value whose payload is not a number pass through", () => {
		const text = stringValue("0xFF");
		expect(numberOfBase(text)).toBe(text);
		const n = bigIntValue(5n);
		expect(numberOfBase(n)).toBe(n);
	});
});

describe("adversarial", () => {
	test("security: prototype words, a long column, a huge base value and look-alike text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestDocument(`${word} = 255 in hex\n${word}\n1\ntotal above`);
				expectHonestDocument(`# ${word}\n255 in hex\ntotal of section "${word}"`, { agree: false });
				expectHonestDocument(`255 in hex #${word}\ntotal of #${word}`);
			}
		});
		expectHonestDocument(RESOURCE_PROBES.manyLines(1_000, "prev in hex") + "\ntotal above", { budgetMs: 10_000 });
		expectHonestDocument("(2n^4000) in hex\n1\ntotal above");
		for (const line of fill("X in hex", TEXT_EDGES)) expectHonestDocument(`${line}\n1\ntotal above`);
		expectHonestLine("255 in hex + total above");
	});

	test("realistic: a base from a variable, a what-if, a check of the total, an edit, both passes agree", () => {
		// The assignment is a figure of the column too, as `port = 80` would be.
		const lines = both("port = 0x50 as hex\nport\n0x1BB in hex\ntotal above\ncheck total above == 603");
		expect(lines[3]).toBe("= 603");
		expect(lines[4]).toBe("= ✓");
		expect(both("a = 255\na in hex\n1\ntotal above\nline 4 with a = 15")[4]).toBe("= 31");
	});

	test("edge: every numeric edge in a base, in a column", () => {
		for (const text of fill("X in hex\n1\ntotal above\naverage above", NUMERIC_EDGES)) {
			expectHonestDocument(text, { allowNaN: text.includes("0/0") });
		}
	});
});
