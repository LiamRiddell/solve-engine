/**
 * Arbitrary-precision integers, and the seam where they meet doubles.
 *
 * A BigInt exists in this engine for exactly one reason: to hold a value a
 * double cannot. So every test here uses a number past 2^53 and checks the
 * digits that a double would have lost. A test on `2n + 2n` would pass whether
 * the type worked or not.
 *
 * The literal needs its `n` suffix (see `BigIntNumberParselet`); a bare
 * `12345678901234567890` is an ordinary double and rounds at parse time. That
 * is a deliberate design decision rather than an oversight, and it is pinned
 * below so that a change to it is a decision someone makes rather than
 * something that drifts.
 *
 * Three areas were reported rather than pinned when this file was written: the
 * bitwise operators, the comparison operators, and `^`. Each of them routed a
 * BigInt operand through `toNumber()` before doing its work, so each destroyed
 * the precision that is the entire point of the type, and writing that down as
 * expected behaviour would have been writing down the bug. All three have
 * since been fixed and are covered below, along with `as hex`, which had the
 * same defect.
 *
 * The reference for every expected value is BigInt arithmetic evaluated in
 * plain JavaScript, computed separately and written in by hand.
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

/** The raw bigint, which is the only representation that has not lost anything. */
function big(source: string): bigint {
	const value = evaluate(source);
	expect(value.type).toBe(ValueType.BigInt);
	return value.value as bigint;
}

describe("a suffixed literal keeps every digit", () => {
	test("past the double's integer ceiling", () => {
		expect(big("12345678901234567890n")).toBe(12345678901234567890n);
		expect(big("9007199254740993n")).toBe(9007199254740993n);
		expect(big("99999999999999999999n")).toBe(99999999999999999999n);
	});

	test("and the same digits without the suffix do not", () => {
		// Not a defect: a bare literal is a double, and this is what a double
		// does with those digits. It is here so the difference between the two
		// spellings stays a visible, chosen thing.
		const plain = evaluate("12345678901234567890");
		expect(plain.type).toBe(ValueType.Number);
		expect(plain.toNumber()).toBe(12345678901234568000);
	});
});

describe("addition and subtraction stay exact", () => {
	test("adding one actually moves the last digit", () => {
		// A double cannot do this: 12345678901234567890 + 1 rounds straight
		// back to itself.
		expect(big("12345678901234567890n + 1")).toBe(12345678901234567891n);
		expect(big("9007199254740993n + 1")).toBe(9007199254740994n);
	});

	test("subtracting two near-identical giants leaves the small difference", () => {
		expect(big("100000000000000000001n - 100000000000000000000n")).toBe(1n);
		expect(big("12345678901234567890n - 12345678901234567889n")).toBe(1n);
	});

	test("a whole double operand joins in without corrupting the bigint", () => {
		// The bigint side must be read as a bigint, not routed through
		// toNumber() first; doing that used to turn 12345678901234567890n into
		// 12345678901234567168n before the addition even ran.
		expect(big("12345678901234567890n + 0")).toBe(12345678901234567890n);
		expect(big("12345678901234567890n - 0")).toBe(12345678901234567890n);
		expect(big("100n - 1")).toBe(99n);
	});
});

describe("multiplication and division stay exact", () => {
	test("doubling keeps the low digits a double would drop", () => {
		expect(big("12345678901234567890n * 2")).toBe(24691357802469135780n);
		expect(big("9007199254740993n * 2")).toBe(18014398509481986n);
	});

	test("division truncates toward zero rather than producing a fraction", () => {
		// There is no fractional bigint, so 7n / 2n is 3n. Worth pinning
		// because the same expression in doubles is 3.5, and a reader moving
		// between the two needs the difference to be predictable.
		expect(big("7n / 2n")).toBe(3n);
		expect(big("-7n / 2n")).toBe(-3n);
		expect(big("12345678901234567890n / 7")).toBe(1763668414462081127n);
	});

	test("and the truncated quotient times the divisor plus the remainder returns", () => {
		// 1763668414462081127 * 7 + 1 = 12345678901234567890, so the quotient
		// and the remainder agree with each other.
		expect(big("12345678901234567890n mod 7")).toBe(1n);
		expect(big("1763668414462081127n * 7 + 1")).toBe(12345678901234567890n);
	});

	test("modulo takes the sign of the left operand, as it does for doubles", () => {
		expect(big("7n mod 2n")).toBe(1n);
		expect(big("-7n mod 2n")).toBe(-1n);
		expect(big("7n mod -2n")).toBe(1n);
	});
});

describe("negation", () => {
	test("reads the bigint directly rather than through a double", () => {
		expect(big("-12345678901234567890n")).toBe(-12345678901234567890n);
		expect(big("-(12345678901234567890n)")).toBe(-12345678901234567890n);
	});
});

describe("the operations with no answer say so", () => {
	/** The engine error a source line raises, failing if it raises nothing. */
	function errorFrom(source: string) {
		try {
			evaluate(source);
		} catch (thrown) {
			return thrown as { code: string; category: string; recoverable: boolean; message: string };
		}
		throw new Error(`expected "${source}" to raise`);
	}

	test("dividing by zero raises rather than returning an infinity", () => {
		// A bigint has no infinity to return, so unlike `1 / 0` this has to be
		// an error. The two behaving differently is correct and deliberate: a
		// bigint division is exact integer division (`7n / 2n` is 3n above), and
		// integer division by zero has no answer in any language that has both.
		expect(() => evaluate("10n / 0n")).toThrow(/division by zero/i);
		expect(() => evaluate("10n mod 0n")).toThrow(/division by zero/i);
	});

	test("and it is the engine's own error, not V8's", () => {
		// This assertion is the one that was missing. The two above passed for
		// years against a raw `RangeError` thrown by BigInt division itself,
		// whose message happens to read "Division by zero"; the VM caught it and
		// relabelled it UNEXPECTED_ERROR/INTERNAL, so a user dividing by zero
		// was told the engine had broken. A fuzz run found it as a leaked
		// internal error.
		for (const source of ["10n / 0n", "10n mod 0n", "10n / 0", '3n / ""']) {
			const error = errorFrom(source);
			expect(error.code).toBe("BIGINT_DIVISION_BY_ZERO");
			expect(error.recoverable).toBe(true);
		}
	});

	test("a fractional operand cannot join a bigint expression", () => {
		// There is no bigint with a fraction in it, so this is refused rather
		// than silently truncating the 1.5 to 1 and answering 11.
		expect(() => evaluate("10n + 1.5")).toThrow();
		expect(() => evaluate("1.5 + 10n")).toThrow();
		expect(() => evaluate("10n * 0.5")).toThrow();
	});

	test("and says which operand it was, for every operator that reads one", () => {
		// Same story as division by zero: these all threw `BigInt()`'s own
		// RangeError, which arrived as UNEXPECTED_ERROR naming no operand.
		// Every operator that converts an operand to a bigint is listed, since
		// the conversion is shared and a new caller of it inherits the fix.
		// `^` is not among them: a fractional exponent never reaches the bigint
		// arm at all (see `exactPowFits`), it falls through to Math.pow, so
		// `2n ^ 0.5` is the square root of two rather than a refusal. That is
		// its own decision and not this fix's to change.
		for (const source of ["1n + 0.5", "1n & 1.5", "1n | 1.5", "1n << 1.5", "5n / pi", "e / 8n"]) {
			const error = errorFrom(source);
			expect(error.code).toBe("BIGINT_INEXACT_OPERAND");
			expect(error.recoverable).toBe(true);
		}
	});

	test("an infinity or a NaN is refused the same way", () => {
		// Reached through arithmetic rather than typed directly, which is how
		// the fuzzer found it: `9 / ""` is Infinity, and Infinity has no
		// whole-number form either.
		expect(errorFrom('9 / "" / 6n').code).toBe("BIGINT_INEXACT_OPERAND");
		expect(errorFrom("(0/0) + 1n").code).toBe("BIGINT_INEXACT_OPERAND");
	});
});

describe("the literal reads its own thousands grouping", () => {
	// The lexer coalesces a group of exactly three digits after a "." or a ","
	// into the number it is building, and for a BIGINT nothing undid that
	// before `BigInt()` saw it. So `1.000n` reached BigInt("1.000") and threw a
	// raw SyntaxError, while `1.01n` and `1.1n` were fine, since a group is
	// exactly three digits. Six characters of ordinary input reported as an
	// internal engine error.
	test("the locale's own thousands separator is grouping and is stripped", () => {
		expect(big("1,000n")).toBe(1000n);
		expect(big("12,345,678,901,234,567,890n")).toBe(12345678901234567890n);
	});

	test("chained dot groups are grouping in any locale", () => {
		// Two or more dot-separated groups of three cannot be a decimal point,
		// so this needs no locale to resolve. Same rule the NUMBER path uses.
		expect(big("1.234.567n")).toBe(1234567n);
	});

	test("a single dot group is a decimal point in en, and is refused", () => {
		// Refused rather than guessed at: reading it as grouping would answer
		// 1000 for something an English writer means as 1, and reading it as a
		// decimal has no whole-number answer at all.
		for (const source of ["1.000n", "1.001n", "0.023n", "12.345n"]) {
			let code = "";
			try {
				evaluate(source);
			} catch (thrown) {
				code = (thrown as { code: string }).code;
			}
			expect(`${source}: ${code}`).toBe(`${source}: INVALID_NUMBER_LITERAL`);
		}
	});

	test("an ungrouped literal is untouched", () => {
		expect(big("123n")).toBe(123n);
		expect(big("12345678901234567890n")).toBe(12345678901234567890n);
	});
});

describe("results stay BigInt through a chain", () => {
	test("so precision is not lost at an intermediate step", () => {
		expect(big("(12345678901234567890n + 1) - 1")).toBe(12345678901234567890n);
		expect(big("(12345678901234567890n * 2) / 2")).toBe(12345678901234567890n);
		expect(evaluate("12345678901234567890n + 1").type).toBe(ValueType.BigInt);
	});

	test("and the rendered answer shows every digit", () => {
		// Not the double's "12,345,678,901,234,568,000".
		expect(evaluate("12345678901234567891n").value?.toString()).toBe("12345678901234567891");
	});
});

describe("the bitwise operators read the bigint rather than a double of it", () => {
	test("the low bit survives, which a double's rounding destroys", () => {
		// The sharpest case in the file. 12345678901234567891 is odd, so
		// `& 1n` is 1; as a double it rounds to ...7168, an even number, and
		// the answer came back 0. One bit, and it was the wrong one.
		expect(big("12345678901234567891n & 1n")).toBe(1n);
		expect(big("12345678901234567890n & 1n")).toBe(0n);
	});

	test("a shift moves every digit, not just the ones a double kept", () => {
		expect(big("12345678901234567890n << 1")).toBe(24691357802469135780n);
		expect(big("12345678901234567891n << 1")).toBe(24691357802469135782n);
		expect(big("12345678901234567890n >> 1")).toBe(6172839450617283945n);
	});

	test("and or/xor/not keep the digits too", () => {
		expect(big("12345678901234567890n | 1n")).toBe(12345678901234567891n);
		// The word, not "^": in this engine "^" is exponentiation.
		expect(big("12345678901234567891n xor 1n")).toBe(12345678901234567890n);
		expect(big("~12345678901234567890n")).toBe(-12345678901234567891n);
	});
});

describe("the comparison operators compare the bigints", () => {
	const near = "12345678901234567890n";
	const nearPlusOne = "12345678901234567891n";

	test("two giants one apart are not equal", () => {
		// Both round to the same double, so comparing the doubles answered
		// true to a question whose answer is plainly false.
		expect(evaluate(`${near} == ${nearPlusOne}`).value).toBe(false);
		expect(evaluate(`${near} != ${nearPlusOne}`).value).toBe(true);
	});

	test("and they order the way their digits do", () => {
		expect(evaluate(`${near} < ${nearPlusOne}`).value).toBe(true);
		expect(evaluate(`${near} <= ${nearPlusOne}`).value).toBe(true);
		expect(evaluate(`${near} > ${nearPlusOne}`).value).toBe(false);
		expect(evaluate(`${nearPlusOne} > ${near}`).value).toBe(true);
		expect(evaluate(`${near} >= ${near}`).value).toBe(true);
	});

	test("a bigint compares against a whole double exactly", () => {
		expect(evaluate("10n == 10").value).toBe(true);
		expect(evaluate("10n < 11").value).toBe(true);
		expect(evaluate("10n > 11").value).toBe(false);
	});

	test("and against a fraction, where there is no exact bigint to compare", () => {
		// No bigint has a fractional part, so this falls back to the ordinary
		// double comparison, which is the right answer at this magnitude.
		expect(evaluate("10n > 9.5").value).toBe(true);
		expect(evaluate("10n < 10.5").value).toBe(true);
		expect(evaluate("10n == 10.5").value).toBe(false);
	});
});

describe("exponentiation stays exact", () => {
	test("so a power of two is the integer and not an approximation of it", () => {
		// Math.pow answered 1.2676506002282294e+30, which is not 2^100.
		expect(big("2n ^ 100")).toBe(1267650600228229401496703205376n);
		expect(big("2n ^ 64")).toBe(18446744073709551616n);
		expect(big("10n ^ 30")).toBe(1000000000000000000000000000000n);
	});

	test("and the small cases still behave", () => {
		expect(big("2n ^ 0")).toBe(1n);
		expect(big("2n ^ 1")).toBe(2n);
		expect(big("(-2n) ^ 3")).toBe(-8n);
	});

	test("a negative exponent has no bigint answer, so it is a double", () => {
		// There is no reciprocal bigint. Answering 0.5 is better than
		// answering 0, and better than refusing an expression with a value.
		expect(evaluate("2n ^ -1").toNumber()).toBe(0.5);
	});
});

describe("writing a bigint in another base", () => {
	test("keeps every digit, which is the whole reason to ask", () => {
		// Rounded through a double this ended 0800; the value ends 0AD2.
		expect(formatValue(evaluate("12345678901234567890n as hex"))).toBe("= 0xAB54A98CEB1F0AD2");
		expect(formatValue(evaluate("255n as hex"))).toBe("= 0xFF");
	});

	test("in binary and octal too", () => {
		expect(formatValue(evaluate("12345678901234567890n as binary")))
			.toBe("= 0b1010101101010100101010011000110011101011000111110000101011010010");
		expect(formatValue(evaluate("255n as octal"))).toBe("= 0o377");
	});
});
