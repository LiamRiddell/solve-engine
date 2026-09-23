/**
 * Primes, factorisation, modular arithmetic, `n choose k` and `5!` (#514).
 *
 * All over exact integers, so a number past 2^53 is worked on at its true
 * digits. Reference values are well known (Mersenne primes, Carmichael numbers,
 * Project Euler 3's factorisation) or were checked with BigInt arithmetic in
 * plain JavaScript. See vm/NumberTheory.ts.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { isPrime, nextPrime, modPow, modInverse, factorInteger, formatFactorisation } from "@solve-js/vm/NumberTheory";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source));
const code = (source: string) => newTrackedEngine().evaluateExpression(source).errorCode;

describe("the arithmetic", () => {
	test("primality, including Carmichael numbers that fool a simple test", () => {
		expect([2n, 3n, 97n, 2147483647n, (1n << 61n) - 1n].every(isPrime)).toBe(true);
		expect([0n, 1n, 4n, 561n, 1105n, 3215031751n].some(isPrime)).toBe(false);
	});

	test("the next prime", () => {
		expect(nextPrime(0n)).toBe(2n);
		expect(nextPrime(100n)).toBe(101n);
		expect(nextPrime(1n << 53n)).toBe(9007199254740997n);
	});

	test("modular power and inverse", () => {
		expect(modPow(7n, 77n, 13n)).toBe(11n);
		expect(modPow(2n, 100n, 1000000007n)).toBe(976371285n);
		expect(modInverse(3n, 11n)).toBe(4n);
		expect(modInverse(4n, 8n)).toBeUndefined();
	});

	test("factorisation", () => {
		expect(formatFactorisation(factorInteger(360n))).toBe("2^3 * 3^2 * 5");
		expect(formatFactorisation(factorInteger(600851475143n))).toBe("71 * 839 * 1471 * 6857");
		expect(formatFactorisation(factorInteger((1n << 64n) - 1n))).toBe("3 * 5 * 17 * 257 * 641 * 65537 * 6700417");
	});
});

describe("through the engine", () => {
	test.each([
		["isprime(97)", "= true"],
		["isprime(561)", "= false"],
		["isprime(2^61 - 1)", "= true"],
		["nextprime(100)", "= 101"],
		["nextprime(2^53)", "= 9,007,199,254,740,997"],
		["modpow(7, 77, 13)", "= 11"],
		["powmod(2, 100, 1000000007)", "= 976,371,285"],
		["modinv(3, 11)", "= 4"],
		["factor(360)", "= 2^3 * 3^2 * 5"],
		["factor(-12)", "= -1 * 2^2 * 3"],
		["factor(97)", "= 97"],
		["factor(1)", "= 1"],
		["factor(2^64)", "= 2^64"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("a factorisation reads back as the number", () => {
		expect(shown("2^3 * 3^2 * 5")).toBe("= 360");
	});

	test("factor of an expression with an unknown still factors the polynomial", () => {
		expect(shown("factor(x^2 - 1)")).toBe("(x-1)*(x+1)");
	});
});

describe("n choose k and n!", () => {
	test.each([
		["5!", "= 120"],
		["0!", "= 1"],
		["25!", "= 15,511,210,043,330,985,984,000,000"],
		["2^3!", "= 64"],
		["-3!", "= -6"],
		["3! + 1", "= 7"],
		["10 choose 3", "= 120"],
		["52 choose 5", "= 2,598,960"],
		["10 choose 3 * 2", "= 240"],
		["nCr(10, 3)", "= 120"],
		["binomial(10, 3)", "= 120"],
	])("%s is %s", (source, expected) => {
		expect(shown(source)).toBe(expected);
	});

	test("!= is still not-equal", () => {
		expect(shown("5 != 4")).toBe("= true");
	});
});

describe("refusals", () => {
	test.each([
		["isprime(3.5)", "NUMBER_THEORY_EXPECTED_INTEGER"],
		["factor(3.5)", "NUMBER_THEORY_EXPECTED_INTEGER"],
		["factor(0)", "NUMBER_THEORY_DOMAIN"],
		["factor(2^64 + 1)", "FACTOR_TOO_LARGE"],
		["modpow(2, -1, 5)", "NUMBER_THEORY_DOMAIN"],
		["modpow(2, 3, 0)", "NUMBER_THEORY_DOMAIN"],
		["modinv(4, 8)", "NUMBER_THEORY_NO_INVERSE"],
		["(3.5)!", "INVALID_FACTORIAL_INPUT"],
		["171!", "FACTORIAL_OVERFLOW"],
	])("%s is %s", (source, expected) => {
		expect(code(source)).toBe(expected);
	});
});

describe("a count that is not whole", () => {
	test("is refused rather than truncated", () => {
		// combination(5.5, 2) used to answer the 10 of combination(5, 2).
		expect(code("combination(5.5, 2)")).toBe("NOT_WHOLE_NUMBER");
		expect(code("5.5 choose 2")).toBe("NOT_WHOLE_NUMBER");
		expect(code("permutation(5, 2.5)")).toBe("NOT_WHOLE_NUMBER");
		expect(shown("combination(5.5, 2)")).toBe("combination counts whole things: 5.5 is not a whole number.");
		expect(shown("combination(5, 2)")).toBe("= 10");
	});
});
