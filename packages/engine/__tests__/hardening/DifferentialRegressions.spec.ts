/**
 * Findings from the 1.0.0 differential run against the last published build.
 *
 * `tools/differential/` ran 40,368 distinct expressions through
 * `solve-engine@1.0.0-beta.6` and through this tree, with the clock, timezone,
 * random source and network pinned on both sides, and compared formatted
 * output, value type, unit and thrown error code. 1,942 expressions answered
 * differently. Almost all of them are the deliberate changes this release made
 * or the sixty-odd defects it fixed. This file holds the ones that are not.
 *
 * Every case here began as `test.failing`, stating the answer the engine
 * SHOULD give, so that Jest failed the run the moment one of them started
 * passing and a fix could not land without someone coming back to promote the
 * row. All of them have been promoted, and each carries the decision that was
 * made and why. A comment recording a known-wrong answer rots; a test does not.
 *
 * The suite could not have found any of these on its own, and in one case
 * actively hid it: `UnitsCurrencyAndRates.spec.ts`'s rate-conversion cases were
 * `test.failing` with the type asserted before the number, so the engine going
 * from a visible error to a confident `0.00 /s` moved the FIRST assertion from
 * failing to passing while the test went on failing on the second, and the run
 * stayed green. Those cases are restructured now (one assertion each, so no
 * assertion can hide behind a later one), but comparing two builds is what
 * surfaced it; an assertion about what someone expected cannot.
 *
 * To reproduce: `tools/differential/README.md`.
 */

import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** One line through a real engine. */
function evaluate(source: string): Value {
	const engine = newTrackedEngine("en");
	return engine.evaluateExpression(source)[0];
}

/** The formatted result with the leading "= " stripped, as a reader would see it. */
function display(source: string): string {
	return formatValue(evaluate(source)).replace(/^=\s*/, "");
}

/**
 * Whether a source was refused, by either mechanism the engine uses.
 *
 * A safety limit may come back as an Error Value or as a thrown `EngineError`,
 * and a test about whether the engine refused at all should not care which.
 */
function refused(source: string): boolean {
	try {
		return evaluate(source).type === ValueType.Error;
	} catch {
		return true;
	}
}

// ── REGRESSION ─────────────────────────────────────────────────────────────

describe("a conversion error survives being fed into another conversion", () => {
	/*
	 * REGRESSION, found by differential run 20260811 against 1.0.0-beta.6.
	 * FIXED, and these rows are what keeps it fixed.
	 *
	 * This release made a cross-measure conversion report an error instead of
	 * handing its input back, which is right and is one of the changes it set
	 * out to make. `UOM_CONVERT_TO` did not check whether its OWN operand was
	 * already an Error, so a second conversion read the error as a number, got
	 * zero, and dressed it in the requested unit.
	 *
	 * The result was the failure mode this release existed to remove. `+` and
	 * `*` both propagated the Error correctly, so the value carried the fault
	 * everywhere except through the one operator that turned it into an answer:
	 *
	 *   5 kg to m           Error: cannot convert kg to m       (correct)
	 *   (5 kg to m) + 1     Error: cannot convert kg to m       (correct)
	 *   (5 kg to m) to s    0.00 s                              (the bug)
	 *
	 * Against beta.6 two of these were unambiguously worse rather than merely
	 * differently wrong. `60 km/h in m/s` and `$100/hour in $/day` used to
	 * answer with a visible Error Value ("km/h/s: that is already a rate"), and
	 * answered `0.00 /s` and `0.00 /day`: a plausible number, in a malformed
	 * unit with no numerator, with nothing on screen saying anything went wrong.
	 *
	 * The fix is `faultedOperand()` in vm/Value.ts and the fifty-odd opcode
	 * cases that now call it, since the conversion opcodes were the visible
	 * instance of a shape the whole dispatch loop had: every site that read an
	 * operand's number without asking its type first. `abs(5 kg to m)` in the
	 * last row is the same defect reached through `VMBuiltins` instead, which
	 * is why it is asserted separately.
	 */

	test("a chain of two conversions reports the first failure", () => {
		expect(evaluate("5 kg to m to s").type).toBe(ValueType.Error);
		expect(evaluate("4 yen in kilobytes into nibbles").type).toBe(ValueType.Error);
	});

	test("and does not answer zero in the unit that was asked for", () => {
		// The shape of the wrong answer matters as much as its being wrong. It
		// arrives with the target unit attached, which is what makes it look
		// like a conversion that worked.
		expect(display("5 kg to m to s")).not.toBe("0.00 s");
	});

	test("an unconvertible rate stays an error rather than becoming zero", () => {
		// `60 km/h in m/s` is now a real conversion (see #89), so the case that
		// guards the "read a failure as zero" shape is the one still not
		// implemented: a money rate whose target is written with a currency
		// symbol and a slash, `in $/day`. Not implemented has to keep looking
		// like not implemented, never like `0.00 /day`.
		expect(refused("$100/hour in $/day")).toBe(true);
		expect(display("$100/hour in $/day")).not.toBe("0.00 /day");
	});

	test("and the rate conversions that #89 did implement answer a real value", () => {
		// The other half of the same guard: now that it is implemented, it must
		// answer the quantity, not zero in the asked-for unit.
		expect(evaluate("60 km/h in m/s").type).toBe(ValueType.Uom);
		expect(evaluate("60 km/h in m/s").toNumber()).toBeCloseTo(60_000 / 3600, 6);
	});

	test("a builtin does not read a conversion error as zero either", () => {
		// Same root cause, reached through `VMBuiltins` rather than through a
		// second conversion. Listed separately because fixing the conversion
		// operator alone would leave this one standing.
		expect(evaluate("abs(5 kg to m)").type).toBe(ValueType.Error);
	});
});

// ── DECIDED ────────────────────────────────────────────────────────────────
//
// Differences that were changes rather than defects, and needed a decision
// rather than a fix. Each row below records the decision that was made and
// pins it, so the next person to change one of these has to argue with a test
// instead of guessing what the current answer was meant to be.

describe("an exact shift or power past the ceiling", () => {
	/*
	 * DECIDED: both refuse. Differential run 20260811.
	 *
	 * `DenialOfServiceUnboundedWork.spec.ts` bounded `<<` at the same 65,536
	 * bits `^` uses, which was right and needed doing: beta.6 would build a
	 * 125MB integer for `1n << 1000000000` and then spend eleven seconds
	 * formatting it. The two spellings of that shift then disagreed about how to
	 * refuse, and one of them did not refuse at all:
	 *
	 *   1n << 66000      Infinity, as a plain Number, no error   (beta.6: exact)
	 *   1 << 100000n     throws BIGINT_SHIFT_LIMIT_EXCEEDED      (beta.6: exact)
	 *
	 * `1n << 66000` is what settled it. It is a perfectly well-defined
	 * 19,870-digit integer, and `Infinity` says two false things about it: that
	 * it is beyond counting, and that nothing was refused. The counter-argument
	 * was that `2n ^ 100000` had answered Infinity since long before this
	 * release, so the shift was only being made to match. That is real, and it
	 * is why the resolution went the other way round instead: `^` refuses at its
	 * ceiling too now (`BIGINT_POW_LIMIT_EXCEEDED`), so the two operators still
	 * agree, on the answer that does not invent a magnitude.
	 *
	 * The line this draws is the one the codebase already draws between its two
	 * numeric types one operator over: `1 / 0` is Infinity and `1n / 0n` is
	 * refused, because exact integer arithmetic does not hand back
	 * approximations. Doubles keep IEEE 754 semantics throughout, so
	 * `2 ^ 100000` is still Infinity.
	 *
	 * The ceiling and the operators either side of it are covered in
	 * `DenialOfServiceUnboundedWork.spec.ts`; these two rows are the ones this
	 * run raised.
	 */

	test("both spellings refuse, rather than one of them answering Infinity", () => {
		expect(refused("1 << 100000n")).toBe(true);
		expect(refused("1n << 100000")).toBe(true);
	});

	test("a shift just past the ceiling is not silently Infinity", () => {
		expect(refused("1n << 66000")).toBe(true);
	});
});

describe("one to the power of infinity", () => {
	/*
	 * DECIDED: C99/IEEE 754, so this is 1. Differential run 20260811.
	 *
	 *   1^2^3^4^5      beta.6: 1      before this fix: NaN
	 *
	 * The associativity change was intended and was never in question: `^`
	 * groups right, so this is 1^(2^(3^(4^5))), the tower overflows to Infinity,
	 * and the outermost step is 1^Infinity. beta.6 grouped left and reached 1 by
	 * luck rather than by being right.
	 *
	 * What was left is that `1 ^ Infinity` was NaN, and had been since before
	 * this release. ECMAScript defines `1 ** Infinity` as NaN, reading it as the
	 * indeterminate FORM from the calculus of limits; C99, IEEE 754, Python and
	 * Ruby all define `pow(1, y)` as 1 for every y, reading the base as the
	 * number one rather than as something approaching it.
	 *
	 * C99 wins here for a reason specific to this engine rather than to the
	 * standards: the Infinity in that tower is a rounding artefact of doubles,
	 * not something the reader wrote, and letting an artefact three levels down
	 * turn an expression whose every base is 1 into "not a number" is the
	 * confidently-derived-from-nothing shape this whole release removes. See
	 * `power()` in vm/VMConversion.ts, which `^`, `pow()` and `root()` all use,
	 * so the spelled-out forms cannot drift from the operator.
	 */

	test("a tower of powers based on one is one", () => {
		expect(evaluate("1^2^3^4^5").toNumber()).toBe(1);
		expect(evaluate("1 ^ (1/0)").toNumber()).toBe(1);
	});

	test("and the two spelled-out forms agree with the operator", () => {
		expect(evaluate("pow(1, 1/0)").toNumber()).toBe(1);
		// pow(-1, +-infinity) is 1 under C99 as well, but pow(-1, NaN) is not:
		// only the base +1 extends the rule to a NaN exponent.
		expect(evaluate("pow(-1, 1/0)").toNumber()).toBe(1);
		expect(evaluate("pow(2, 1/0)").toNumber()).toBe(Infinity);
	});

	test("without disturbing the ordinary powers around it", () => {
		expect(evaluate("2^3^2").toNumber()).toBe(512);
		expect(evaluate("2 ^ 0.5").toNumber()).toBeCloseTo(Math.SQRT2, 12);
		expect(evaluate("0 ^ 0").toNumber()).toBe(1);
	});
});

describe("an ISO 8601 timestamp carrying a UTC offset", () => {
	/*
	 * DECIDED: parse it. Differential run 20260811.
	 *
	 *   2019-04-01T15:30:00+11:00
	 *     beta.6:        1,778,756,400,000, a bare Number
	 *     before this fix: "Thursday, May 14, 2026, 11:00:00 AM"
	 *
	 * Both were the same wrong instant: today at 11:00, because the trailing
	 * `+11:00` was read as adding a time literal to the date on its left rather
	 * than as the offset it is. The engine parsed the string correctly when it
	 * was quoted, so the capability was there and the bare form did not reach it:
	 *
	 *   "2019-04-01T15:30:00+11:00" to date   Monday, April 1, 2019, 4:30:00 AM
	 *
	 * Of the two available resolutions, refusing the bare form and parsing it,
	 * refusing is the harder one to defend: `2019-04-01` on its own has parsed
	 * as a date for two releases, so a reader who writes the same date with a
	 * time on the end is not asking for something new, and a bare form that
	 * refuses only once a time appears is a rule nobody can predict. The
	 * normalizer already settled the half of the ambiguity that is real (a date
	 * is written as one uninterrupted run of characters, so `2024 - 5 - 3` stays
	 * arithmetic); no chain of subtractions contains a `T15:30`.
	 *
	 * See `fuseIsoTimestamp()` in packages/datetime/normalizer/DateLiteralNormalizerRule.ts.
	 * It hands the text to the same `parseIso8601()` the quoted form uses, so
	 * the two spellings cannot drift apart.
	 */

	test("means the instant it names", () => {
		const parsed = evaluate("2019-04-01T15:30:00+11:00");
		expect(parsed.type).toBe(ValueType.Datetime);
		expect(parsed.toNumber()).toBe(Date.UTC(2019, 3, 1, 4, 30, 0));
	});

	test("and agrees with the quoted spelling of the same instant", () => {
		expect(evaluate("2019-04-01T15:30:00+11:00").toNumber())
			.toBe(evaluate('"2019-04-01T15:30:00+11:00" to date').toNumber());
		expect(evaluate("2019-04-01T15:30:00Z").toNumber()).toBe(Date.UTC(2019, 3, 1, 15, 30, 0));
	});

	test("a timestamp with no offset is local time, like every other date literal", () => {
		// Not UTC: a bare date literal is local midnight (see buildDateToken),
		// and the native Date parser reads an offset-less date-TIME as local for
		// the same reason. The assertion is written through the host's own
		// offset so it holds in any timezone the suite runs in.
		expect(evaluate("2019-04-01T15:30:00").toNumber())
			.toBe(new Date(2019, 3, 1, 15, 30, 0).getTime());
	});

	test("and a space is still two things", () => {
		// The fusion requires the tokens to be adjacent in the source, so a
		// reader who typed a space typed a date and then something else. This is
		// what keeps the rule from swallowing ordinary arithmetic written next
		// to a date.
		expect(evaluate("2024 - 5 - 3").toNumber()).toBe(2016);
		expect(refused("2019-04-01 + 11:00")).toBe(true);
	});
});
