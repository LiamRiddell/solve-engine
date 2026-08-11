/**
 * The `solve-engine/utilities` subpath, which is a published entry point and
 * therefore code a consumer can call directly.
 *
 * Four of its five exports had no test of any kind before this file, and
 * `utilities/Number.ts` was the least-covered file in the whole engine at
 * 54.5% of lines. That is not an accounting curiosity: the uncovered half is
 * `removeThousandsSeparators()`, which is the entire code path taken whenever
 * a host turns thousands separators OFF, and it was wrong in two independent
 * ways. Both defects are described and pinned below, with the value a reader
 * would expect worked out by hand rather than read back from the function.
 *
 * Every number here was worked out by hand from the documented contract, not
 * read back from the function.
 */

import { describe, expect, test } from "@jest/globals";
import { djb2Hash } from "@solve-js/utilities/Hash";
import { autoFormatIntegerOrFloat } from "@solve-js/utilities/Number";
import { countLines, stripQuotes } from "@solve-js/utilities/Strings";
import { createTimeoutSignal } from "@solve-js/utilities/TimeoutSignal";

describe("djb2Hash", () => {
	/*
	 * The three worked examples below are the algorithm run by hand, which is
	 * the only way to tell "this implements djb2" apart from "this implements
	 * something deterministic". A property test alone cannot see the
	 * difference, and DocumentModel's change detection depends on the exact
	 * function staying the exact function across versions: a host that
	 * persisted line hashes and upgraded would otherwise silently treat every
	 * line as changed.
	 */
	test("the empty string hashes to the seed", () => {
		// The loop body never runs, so the answer is the initial 5381.
		expect(djb2Hash("")).toBe(5381);
	});

	test("one character is (seed * 33) + charCode", () => {
		// 5381 << 5 is 5381 * 32 = 172192; + 5381 = 177573; + "a" (97) = 177670.
		expect(djb2Hash("a")).toBe(177670);
	});

	test("and the next character folds the running hash the same way", () => {
		// 177670 * 32 = 5685440; + 177670 = 5863110; + "b" (98) = 5863208.
		expect(djb2Hash("ab")).toBe(5863208);
	});

	test("the result is an unsigned 32-bit integer, never negative", () => {
		/*
		 * The `>>> 0` at the end is what makes this true, and it is load
		 * bearing: the `| 0` inside the loop produces a signed value, so
		 * without the final coercion roughly half of all inputs would hash
		 * negative. A caller storing hashes in a typed array or a keyed map
		 * would be handed something outside the range the doc comment
		 * promises. These inputs are long enough to have overflowed.
		 */
		const inputs = [
			"the quick brown fox jumps over the lazy dog",
			"1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10",
			"x".repeat(200),
			"\u00e9\u00e8\u00ea\u00eb",
		];
		for (const input of inputs) {
			const hash = djb2Hash(input);
			expect(Number.isInteger(hash)).toBe(true);
			expect(hash).toBeGreaterThanOrEqual(0);
			expect(hash).toBeLessThanOrEqual(0xffffffff);
		}
	});

	test("a one-character edit changes the hash", () => {
		// The whole point of hashing a line is noticing when it changed. These
		// pairs differ by a single character in a position that matters.
		expect(djb2Hash("1 + 1")).not.toBe(djb2Hash("1 + 2"));
		expect(djb2Hash("total")).not.toBe(djb2Hash("Total"));
		expect(djb2Hash("ab")).not.toBe(djb2Hash("ba"));
	});
});

describe("stripQuotes", () => {
	test("removes one surrounding pair", () => {
		expect(stripQuotes('"hello"')).toBe("hello");
		expect(stripQuotes('""')).toBe("");
	});

	test("removes exactly one pair, not every pair", () => {
		// A payload that is itself quoted keeps its own quotes, which is what
		// distinguishes "strip the delimiters" from "delete all quotes".
		expect(stripQuotes('""nested""')).toBe('"nested"');
	});

	test("leaves anything not fully wrapped alone", () => {
		expect(stripQuotes("hello")).toBe("hello");
		expect(stripQuotes('"unterminated')).toBe('"unterminated');
		expect(stripQuotes('unopened"')).toBe('unopened"');
		expect(stripQuotes("")).toBe("");
	});

	test("a lone quote character is not a pair", () => {
		/*
		 * `"` starts with a quote and ends with a quote, so the length check
		 * is the only thing standing between this and slice(1, -1) returning
		 * the empty string for a one-character input.
		 */
		expect(stripQuotes('"')).toBe('"');
	});
});

describe("countLines", () => {
	test("agrees with split(\"\\n\").length on the shapes that matter", () => {
		/*
		 * The doc comment says this exists to avoid allocating the array that
		 * `split` would, so agreeing with `split` is its actual contract, and
		 * the trailing-newline case is where a hand-rolled counter usually
		 * diverges: "a\n" is two lines, the second one empty.
		 */
		expect(countLines("")).toBe(1);
		expect(countLines("a")).toBe(1);
		expect(countLines("a\nb")).toBe(2);
		expect(countLines("a\n")).toBe(2);
		expect(countLines("\n")).toBe(2);
		expect(countLines("\n\n")).toBe(3);
		expect(countLines("a\nb\nc\nd")).toBe(4);
	});

	test("stops counting once the answer is past what the caller asked about", () => {
		/*
		 * A caller about to refuse an over-long document does not need the
		 * real count, only "more than this", and walking the rest of a
		 * multi-megabyte string to produce a number nobody reads is the cost
		 * this parameter exists to avoid. Four lines with a ceiling of two
		 * must report three, one past the ceiling, without looking further.
		 */
		expect(countLines("a\nb\nc\nd", 2)).toBe(3);
		expect(countLines("a\nb\nc\nd\ne\nf\ng\nh", 2)).toBe(3);
	});

	test("a document at or under the ceiling still gets its real count", () => {
		expect(countLines("a\nb", 2)).toBe(2);
		expect(countLines("a\nb", 5)).toBe(2);
		expect(countLines("a", 5)).toBe(1);
	});

	test("CRLF still counts as one line break", () => {
		// Windows documents are ordinary input. The carriage return is part of
		// the line's text, not a second terminator.
		expect(countLines("a\r\nb")).toBe(2);
	});
});

describe("autoFormatIntegerOrFloat", () => {
	test("an integer is never padded out to the decimal places", () => {
		// The documented branch: integers render with zero fractional digits
		// regardless of what `decimalPlaces` says.
		expect(autoFormatIntegerOrFloat(5, 2, true)).toBe("5");
		expect(autoFormatIntegerOrFloat(0, 2, true)).toBe("0");
		expect(autoFormatIntegerOrFloat(-7, 4, true)).toBe("-7");
	});

	test("a non-integer is rendered to the requested decimal places", () => {
		// 1.005 to 2 places is 1.00 or 1.01 depending on the rounding of a
		// value that is not exactly representable, so these use values that
		// are exact in binary or unambiguous at the requested precision.
		expect(autoFormatIntegerOrFloat(1.5, 2, true)).toBe("1.50");
		expect(autoFormatIntegerOrFloat(1.25, 1, true)).toBe("1.3");
		expect(autoFormatIntegerOrFloat(0.5, 3, true)).toBe("0.500");
	});

	test("separators on: groups of three, per the locale", () => {
		expect(autoFormatIntegerOrFloat(1234, 2, true, "en-US")).toBe("1,234");
		expect(autoFormatIntegerOrFloat(1234567, 2, true, "en-US")).toBe("1,234,567");
		expect(autoFormatIntegerOrFloat(1234, 2, true, "de-DE")).toBe("1.234");
	});

	test("separators off: a four-digit integer comes back bare", () => {
		// This is the one input size the separators-off path gets right, and
		// it is the reason the defects below went unnoticed.
		expect(autoFormatIntegerOrFloat(1234, 2, false, "en-US")).toBe("1234");
		expect(autoFormatIntegerOrFloat(-1234, 2, false, "en-US")).toBe("-1234");
		expect(autoFormatIntegerOrFloat(1234.5, 2, false, "en-US")).toBe("1234.50");
	});

	/*
	 * Defect 1: only the FIRST separator was removed.
	 *
	 * `removeThousandsSeparators()` called `String.prototype.replace` with a
	 * string pattern, which replaces one occurrence. Below a million there is
	 * only one separator to remove, so the function looked correct; at a
	 * million and above every separator after the first survived, and the
	 * survivor read as a decimal point in en-US. A host that turned separators
	 * off was shown "1234,567" for one million two hundred thousand-odd, which
	 * is not the requested formatting and not any formatting.
	 */
	test("separators off strips every separator, not just the first", () => {
		expect(autoFormatIntegerOrFloat(1234567, 2, false, "en-US")).toBe("1234567");
		expect(autoFormatIntegerOrFloat(1234567890, 2, false, "en-US")).toBe("1234567890");
		expect(autoFormatIntegerOrFloat(1234567.5, 2, false, "en-US")).toBe("1234567.50");
		expect(autoFormatIntegerOrFloat(1234567, 2, false, "de-DE")).toBe("1234567");
	});

	/*
	 * Defect 2, and the more serious of the two: the separator to strip was
	 * chosen by a two-case switch over the locale string, "de-DE" or
	 * everything else. Everything else stripped ",".
	 *
	 * In French, Spanish, Italian, Portuguese, Dutch and every other
	 * comma-decimal locale, "," is the DECIMAL separator. Stripping it did
	 * not remove grouping, it removed the decimal point, so 1.5 rendered as
	 * "150" and the reader was shown a number a hundred times too large with
	 * nothing to suggest anything had gone wrong. The thousands separator in
	 * those locales (a narrow no-break space in fr) was left in place, so the
	 * one thing the function was asked to do was also not done.
	 *
	 * `decimalSeparatorLocale` is a host-supplied string with no validation
	 * anywhere, and `format/FormattingSettings.ts` documents no restriction
	 * on it, so this was reachable by any host that formats in a
	 * comma-decimal locale with grouping switched off.
	 *
	 * Both defects went away at once by asking `Intl` for an ungrouped
	 * rendering (`useGrouping: false`) instead of formatting with grouping and
	 * then deleting characters. There is then no separator to identify and
	 * none to miss.
	 */
	test("separators off respects the locale's own decimal separator", () => {
		// French: group separator is a narrow no-break space, decimal is ",".
		// Removing grouping from 1.5 leaves 1.5, spelled "1,50" in French.
		expect(autoFormatIntegerOrFloat(1.5, 2, false, "fr-FR")).toBe("1,50");
		expect(autoFormatIntegerOrFloat(1234.5, 2, false, "fr-FR")).toBe("1234,50");
		// Spanish groups with "." and separates decimals with ",", the same
		// way German does, but is not the one locale the switch names.
		expect(autoFormatIntegerOrFloat(1234.5, 2, false, "es-ES")).toBe("1234,50");
	});
});

describe("createTimeoutSignal", () => {
	test("a caller that has already aborted produces an already-aborted signal", () => {
		/*
		 * `addEventListener("abort", ...)` on a signal that has already fired
		 * never calls the listener, so without the upfront `aborted` check the
		 * fetch would go out despite the caller having cancelled. The reason
		 * has to survive too: a host distinguishing "user typed another
		 * keystroke" from "the network took too long" reads it.
		 */
		const caller = new AbortController();
		caller.abort(new Error("keystroke"));

		const { signal, cleanup } = createTimeoutSignal(caller.signal, 60_000, "test fetch");

		expect(signal.aborted).toBe(true);
		expect((signal.reason as Error).message).toBe("keystroke");
		// Nothing was armed, so cleanup must be safe to call anyway: the
		// caller has no way to know which branch it got.
		expect(() => cleanup()).not.toThrow();
	});

	test("a caller aborting later aborts the derived signal with the same reason", () => {
		const caller = new AbortController();
		const { signal, cleanup } = createTimeoutSignal(caller.signal, 60_000, "test fetch");

		expect(signal.aborted).toBe(false);
		caller.abort(new Error("superseded"));

		expect(signal.aborted).toBe(true);
		expect((signal.reason as Error).message).toBe("superseded");
		cleanup();
	});

	test("the timeout aborts with a TimeoutError naming the label and the budget", async () => {
		/*
		 * The label and the millisecond count are the only things that tell a
		 * host WHICH request timed out, and `name === "TimeoutError"` is what
		 * lets it tell a timeout apart from a cancellation without string
		 * matching.
		 */
		const { signal, cleanup } = createTimeoutSignal(undefined, 1, "currency rates");

		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(signal.aborted).toBe(true);
		const reason = signal.reason as DOMException;
		expect(reason.name).toBe("TimeoutError");
		expect(reason.message).toContain("currency rates");
		expect(reason.message).toContain("1ms");
		cleanup();
	});

	test("cleanup disarms the timer, so a completed request cannot abort later", async () => {
		/*
		 * This is the leak the cleanup callback exists to prevent: a fetch
		 * that finished in 1ms leaves a 30-second timer holding the process
		 * open, and in Node a pending timer is enough to stop it exiting. The
		 * observable half is that the signal must NOT abort after cleanup.
		 */
		const { signal, cleanup } = createTimeoutSignal(undefined, 5, "quick request");
		cleanup();

		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(signal.aborted).toBe(false);
	});

	test("cleanup unsubscribes from the caller, so a long-lived caller stops driving it", async () => {
		/*
		 * The other half of the same leak. A host holding one AbortController
		 * for a whole editing session would otherwise accumulate one listener
		 * per request on it, each closing over a controller that no longer
		 * matters.
		 */
		const caller = new AbortController();
		const { signal, cleanup } = createTimeoutSignal(caller.signal, 60_000, "quick request");
		cleanup();

		caller.abort(new Error("too late"));

		expect(signal.aborted).toBe(false);
	});
});
