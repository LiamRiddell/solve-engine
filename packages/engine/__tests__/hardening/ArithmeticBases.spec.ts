/**
 * Writing a number in another base.
 *
 * A base is a notation, not a kind of quantity, so the engine keeps the number
 * a number and only tags it with how to display it (`vm/Value.ts`'s
 * `hexValue()`). That decision is what makes `(255 as hex) + 1` equal 256
 * rather than 1, and it is worth holding onto: the moment a converted value
 * becomes a string, every expression built on top of it silently reads as
 * zero.
 *
 * So these tests assert two things at once for every conversion: the numeric
 * value (which must not move) and the rendered literal (which is the whole
 * point of asking). Every expected literal was worked out by hand from the
 * decimal value rather than read back from the engine.
 *
 * The `in`/`to` spellings are covered alongside `as` because they are supposed
 * to be the same operation said differently, and until this pass `255 in hex`
 * and `255 to bin` did not parse at all while `255 in binary` did.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();
/** The rendered answer with the leading "= " the formatter prefixes. */
const shown = (source: string) => formatValue(evaluate(source)).replace(/^= /, "");

describe("hexadecimal", () => {
	test("renders the digits, uppercase, with a 0x prefix", () => {
		// 255 = 15*16 + 15 = FF. 4095 = FFF. 4096 = 1000.
		expect(shown("255 as hex")).toBe("0xFF");
		expect(shown("4095 as hex")).toBe("0xFFF");
		expect(shown("4096 as hex")).toBe("0x1000");
		expect(shown("0 as hex")).toBe("0x0");
	});

	test("keeps the value a number, so arithmetic on it still works", () => {
		expect(evaluate("255 as hex").type).toBe(ValueType.Hex);
		expect(num("255 as hex")).toBe(255);
		expect(num("(255 as hex) + 1")).toBe(256);
		expect(num("(255 as hex) * 2")).toBe(510);
	});

	test("puts the minus sign outside the literal", () => {
		// "-0xFF", not "0x-FF": the sign belongs to the quantity, and a hex
		// literal has no way to write one.
		expect(shown("-255 as hex")).toBe("-0xFF");
		expect(num("-255 as hex")).toBe(-255);
	});

	test("truncates a fraction rather than inventing fractional digits", () => {
		// 255.7 in raw JS renders as "ff.b3333333333", which is not a
		// notation anyone reads. The value is truncated toward zero first.
		expect(shown("255.7 as hex")).toBe("0xFF");
		expect(shown("255.5 as hex")).toBe("0xFF");
		expect(shown("0.9 as hex")).toBe("0x0");
	});

	test("and a value with no digits in any base renders as itself", () => {
		// `Infinity.toString(16)` is the word "Infinity", which arrived on
		// screen as the literal `0xINFINITY`: a hex number containing letters
		// that are not hex digits, which reads back as nothing.
		expect(shown("1 / 0 as hex")).toBe("Infinity");
		expect(shown("-1 / 0 as hex")).toBe("-Infinity");
		expect(shown("0 / 0 as hex")).toBe("NaN");
		expect(shown("1 / 0 as binary")).toBe("Infinity");
		expect(shown("0 / 0 as octal")).toBe("NaN");
	});
});

describe("binary and octal", () => {
	test("binary renders with a 0b prefix", () => {
		// 255 is eight ones; 8 is 1000; 5 is 101.
		expect(shown("255 as binary")).toBe("0b11111111");
		expect(shown("8 as binary")).toBe("0b1000");
		expect(shown("5 as binary")).toBe("0b101");
		expect(shown("0 as binary")).toBe("0b0");
	});

	test("octal renders with a 0o prefix", () => {
		// 255 = 3*64 + 7*8 + 7 = 377. 1023 = 1777.
		expect(shown("255 as octal")).toBe("0o377");
		expect(shown("1023 as octal")).toBe("0o1777");
		expect(shown("7 as octal")).toBe("0o7");
	});

	test("both keep their numeric value", () => {
		expect(num("255 as binary")).toBe(255);
		expect(num("255 as octal")).toBe(255);
		expect(num("(255 as binary) * 2")).toBe(510);
	});

	test("and both take the sign outside the literal", () => {
		expect(shown("-5 as binary")).toBe("-0b101");
		expect(shown("-255 as octal")).toBe("-0o377");
	});
});

describe("the same conversion, said three ways", () => {
	test("as, in, and to all reach the same converter", () => {
		expect(shown("255 as hex")).toBe("0xFF");
		expect(shown("255 in hex")).toBe("0xFF");
		expect(shown("255 to hex")).toBe("0xFF");
	});

	test("including the abbreviated names", () => {
		// "bin" lexes as FUNC rather than CONVERTER_NAME, because `bin(255)`
		// also has to work. The preposition rewrite has to know that, or
		// `255 in bin` parses as a unit conversion into a unit called "bin".
		expect(shown("255 in bin")).toBe("0b11111111");
		expect(shown("255 to bin")).toBe("0b11111111");
		expect(shown("255 as bin")).toBe("0b11111111");
		expect(shown("255 in binary")).toBe("0b11111111");
		expect(shown("255 in oct")).toBe("0o377");
		expect(shown("255 in octal")).toBe("0o377");
	});

	test("and the call spellings, which is why those names are FUNC", () => {
		expect(shown("hex(255)")).toBe("0xFF");
		expect(shown("bin(255)")).toBe("0b11111111");
	});

	test("the numeric target names the same three radixes", () => {
		expect(shown("255 as base 16")).toBe("0xFF");
		expect(shown("255 as base 8")).toBe("0o377");
		expect(shown("255 as base 2")).toBe("0b11111111");
	});

	test("a radix with no renderer says so rather than guessing", () => {
		expect(() => evaluate("255 as base 7")).toThrow(/base/i);
	});
});

describe("literals in every base parse back to the same number", () => {
	test("hexadecimal", () => {
		expect(num("0xFF")).toBe(255);
		expect(num("0xff")).toBe(255);
		expect(num("0x10")).toBe(16);
		expect(num("0xFFFFFFFF")).toBe(4294967295);
	});

	test("binary and octal", () => {
		expect(num("0b1010")).toBe(10);
		expect(num("0b11111111")).toBe(255);
		expect(num("0o17")).toBe(15);
		expect(num("0o377")).toBe(255);
	});

	test("and they are ordinary numbers in arithmetic", () => {
		expect(num("0xff + 1")).toBe(256);
		expect(num("0x10 * 0x10")).toBe(256);
		expect(num("0b1010 + 0o17")).toBe(25);
	});

	test("a malformed literal is rejected instead of read as zero", () => {
		expect(() => evaluate("0x")).toThrow(/hex/i);
		expect(() => evaluate("0xGG")).toThrow(/hex/i);
	});
});

describe("round trips", () => {
	/**
	 * Every value goes out to a base and comes back, which is the property
	 * that actually matters: a renderer can be wrong in a way that looks
	 * plausible (a dropped leading digit, a sign in the wrong place) and only
	 * a round trip notices.
	 */
	const cases: ReadonlyArray<readonly [number, string, string, string]> = [
		[0, "0x0", "0b0", "0o0"],
		[1, "0x1", "0b1", "0o1"],
		[7, "0x7", "0b111", "0o7"],
		[8, "0x8", "0b1000", "0o10"],
		[63, "0x3F", "0b111111", "0o77"],
		[64, "0x40", "0b1000000", "0o100"],
		[255, "0xFF", "0b11111111", "0o377"],
		[256, "0x100", "0b100000000", "0o400"],
		[65535, "0xFFFF", "0b1111111111111111", "0o177777"],
	];

	for (const [value, hex, bin, oct] of cases) {
		test(`${value} renders and reads back in all three bases`, () => {
			expect(shown(`${value} as hex`)).toBe(hex);
			expect(shown(`${value} as binary`)).toBe(bin);
			expect(shown(`${value} as octal`)).toBe(oct);
			expect(num(hex)).toBe(value);
			expect(num(bin)).toBe(value);
			expect(num(oct)).toBe(value);
		});
	}

	test("and a value already tagged with one base can be retagged", () => {
		expect(shown("(255 as hex) as binary")).toBe("0b11111111");
		expect(shown("(0xFF as binary) as octal")).toBe("0o377");
	});
});
