/**
 * The numeral conversions against known values, including the awkward cases: the
 * Roman subtractive forms, the British "and" placement, and the ordinal
 * exceptions around 11–13.
 */
import { describe, expect, test } from "@jest/globals";
import { numberToRoman, romanToNumber, numberToOrdinal, numberToWords } from "@solve-js/packages/numerals/NumeralOps";

describe("number to Roman", () => {
	test.each([
		[4, "IV"], [9, "IX"], [40, "XL"], [90, "XC"], [400, "CD"], [900, "CM"],
		[1994, "MCMXCIV"], [2024, "MMXXIV"], [3888, "MMMDCCCLXXXVIII"], [1, "I"], [3999, "MMMCMXCIX"],
	])("%i -> %s", (n, s) => expect(numberToRoman(n)).toBe(s));

	test("out of range is null", () => {
		expect(numberToRoman(0)).toBeNull();
		expect(numberToRoman(4000)).toBeNull();
		expect(numberToRoman(2.5)).toBeNull();
	});
});

describe("Roman to number", () => {
	test.each([
		["MMXXIV", 2024], ["MCMXCIV", 1994], ["IV", 4], ["mmxxiv", 2024],
	])("%s -> %i", (s, n) => expect(romanToNumber(s)).toBe(n));

	test("malformed or non-canonical is null", () => {
		expect(romanToNumber("IIII")).toBeNull();
		expect(romanToNumber("VV")).toBeNull();
		expect(romanToNumber("IC")).toBeNull();
		expect(romanToNumber("hello")).toBeNull();
		expect(romanToNumber("")).toBeNull();
	});
});

describe("ordinal", () => {
	test.each([
		[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"],
		[13, "13th"], [21, "21st"], [22, "22nd"], [23, "23rd"], [100, "100th"], [111, "111th"], [113, "113th"],
	])("%i -> %s", (n, s) => expect(numberToOrdinal(n)).toBe(s));
});

describe("words (British)", () => {
	test.each([
		[0, "zero"],
		[7, "seven"],
		[21, "twenty-one"],
		[105, "one hundred and five"],
		[1234, "one thousand two hundred and thirty-four"],
		[1000000, "one million"],
		[1000001, "one million and one"],
		[1000020, "one million and twenty"],
		[2500, "two thousand five hundred"],
		[-42, "minus forty-two"],
	])("%i -> %s", (n, s) => expect(numberToWords(n)).toBe(s));

	test("a decimal is read digit by digit", () => {
		expect(numberToWords(3.5)).toBe("three point five");
		expect(numberToWords(3.14)).toBe("three point one four");
	});
});
