/**
 * Inputs that ask one opcode to work forever.
 *
 * `RobustnessResourceLimits.spec.ts` covers the counters that run BETWEEN
 * opcodes, and `ResourceGuardAllocation.spec.ts` covers the budget that counts
 * what opcodes allocate. Neither can see the shape collected here: work that is
 * neither an allocation nor a second instruction, but a loop inside the body of
 * a single opcode whose trip count is a number the user typed.
 *
 * The instruction counter is structurally blind to it. `executeBytecode()`
 * checks `localInstructionCount` once per dispatch, so an opcode that runs a
 * hundred million iterations of its own before returning is one instruction as
 * far as the counter is concerned. The allocation budget is blind to a
 * different half: a loop that allocates nothing at all, or one whose product is
 * a single bigint rather than a countable number of elements.
 *
 * The engine already knows this shape and already guards it once. `vm/VM.ts`'s
 * `MAX_EXACT_POW_BITS` exists because `2n ^ 1000000000` "is a single
 * instruction that would spend minutes building a ~125MB integer", in its own
 * words. Every case below is that same sentence with a different operator in
 * it, which is why the guard being right in one place and absent in four is the
 * finding rather than any one input.
 *
 * SIZING. Every input here is scaled down until it is merely slow, and the
 * input that is actually fatal is named in the comment above the case. A test
 * cannot assert on a process that V8 aborted, so the fatal ones are documented
 * rather than run. Measured on the release/1.0.0 worktree, Node 24, 512MB heap:
 *
 *   1n << 1000000000                      no answer inside 30 seconds
 *   1n << 100000                          12.5MB bigint, then 11.1 SECONDS
 *                                         inside formatValue() turning it into
 *                                         a 30,103,002-character string
 *   today + 100000000 workdays            13.2 seconds, answers "Invalid Date"
 *   today + 1000000000000 workdays        no answer inside 30 seconds
 *   permutation(1000000000000, 1e12)      no answer inside 30 seconds
 *   a 22-line doubling chain of functions  fatal OOM in under one second
 */

import { describe, expect, test } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { errorValue, Value, ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** The first Value a source evaluates to, or the thrown error turned into one. */
function evaluate(engine: ExpressionEngine, source: string): Value {
	try {
		return engine.evaluateExpression(source)[0];
	} catch (thrown) {
		// A safety limit may report either way round: `maxCollectionSize` comes
		// back as an Error Value while `maxInstructions` throws. Both are a
		// refusal, and a test about whether the engine refuses at all should not
		// care which mechanism carried it.
		return errorValue((thrown as { code?: string }).code ?? "THREW", String(thrown));
	}
}

/** Whether a source was refused, by either of the two mechanisms above. */
function refused(engine: ExpressionEngine, source: string): boolean {
	return evaluate(engine, source).type === ValueType.Error;
}

/** Runs `lines` as one document and returns the last line's result. */
function lastLineOf(lines: string[]): Value | null {
	const engine = newTrackedEngine("en");
	const document = new DocumentModel();
	document.setDocument(lines.join("\n"));
	new ThreeTierEvaluator(document, engine).evaluate({ startLine: 1, endLine: lines.length });
	return document.getLineAt(lines.length)?.result ?? null;
}

// ── Bigint growth ──────────────────────────────────────────────────────────

describe("an exact bigint is bounded by how many bits it may reach", () => {
	test("exponentiation is the operator that has the guard", () => {
		// Establishes that the ceiling exists and works, so the next case is
		// about one operator having been missed rather than about the limit
		// being wrong. 100,000 bits is above MAX_EXACT_POW_BITS (65,536).
		const engine = newTrackedEngine("en");
		expect(refused(engine, "2n ^ 100000")).toBe(true);
	});

	test("and past it the exact operators refuse rather than answering Infinity", () => {
		// DECIDED (1.0.0, differential run 20260811). This used to fall through
		// to the ordinary double path, which for a number this size answers
		// Infinity, and the shift was made to agree with it. That agreement was
		// the right instinct about the wrong answer: `2n ^ 100000` names a
		// 30,103-digit integer, and Infinity says both that it is beyond
		// counting and that nothing was refused, neither of which is true.
		//
		// The engine already draws this line one operator over, for the same
		// reason: `1 / 0` is Infinity and `1n / 0n` is refused, because exact
		// integer arithmetic does not hand back approximations. The double
		// spellings are untouched, so `2 ^ 100000` is still Infinity.
		const engine = newTrackedEngine("en");
		expect(evaluate(engine, "2n ^ 100000").value).toBe("BIGINT_POW_LIMIT_EXCEEDED");
		expect(evaluate(engine, "1n << 100000").value).toBe("BIGINT_SHIFT_LIMIT_EXCEEDED");
		// The double path keeps IEEE 754's answer, which is the whole reason
		// the two types are different types.
		const asDoubles = evaluate(engine, "2 ^ 100000");
		expect(asDoubles.type).toBe(ValueType.Number);
		expect(asDoubles.value).toBe(Infinity);
	});

	test("and an exact answer that costs nothing is still given", () => {
		// The ceiling is on the size of the result, not on the size of the
		// exponent, so the bases whose powers stay one bit wide are answered
		// however absurd the exponent is. Without this the guard would refuse
		// `1n ^ 1000000`, whose answer is 1.
		const engine = newTrackedEngine("en");
		expect(evaluate(engine, "1n ^ 1000000").value).toBe(BigInt(1));
		expect(evaluate(engine, "0n << 10000000").value).toBe(BigInt(0));
		// A fractional or negative exponent has no exact answer to bound, so
		// those keep the double path rather than being refused with it.
		expect(evaluate(engine, "4n ^ 0.5").value).toBe(2);
		expect(evaluate(engine, "2n ^ -1").value).toBe(0.5);
	});

	test("both spellings agree while they are small enough to be exact", () => {
		// `1n << k` and `2n ^ k` are the same number written two ways, which is
		// what makes the disagreement in the next case a defect rather than a
		// difference of opinion between two operators.
		// Written through `BigInt()` rather than as a `1099511627776n` literal:
		// the test tsconfig compiles below ES2020, where the literal form is a
		// compile error even though the runtime handles it fine.
		const engine = newTrackedEngine("en");
		expect(evaluate(engine, "1n << 40").value).toBe(evaluate(engine, "2n ^ 40").value);
		expect(evaluate(engine, "1n << 40").value).toBe(BigInt("1099511627776"));
	});

	test("and shifting is bounded by the same ceiling as raising to a power", () => {
		// `<<` used to have no ceiling of any kind. `1n << 100000` built an exact
		// 100,001-bit integer, 30,103 decimal digits, where `2n ^ 100000` asks
		// for the identical value and was refused. The shift kept going all the
		// way to V8's own maximum bigint size: `1n << 1000000000` is a 125MB
		// integer, and `1n << 10000000000` is the first size large enough that
		// V8 itself says no.
		//
		// The evaluation is not even the expensive half. A bigint is built by
		// zeroing a buffer, so the shift returns in single-digit milliseconds; it
		// is `format/FormatEngine.ts`'s `formatBigInt()`, which is a bare `= ${value}`
		// template, that then spends 11.1 seconds converting `1n << 100000000`
		// into a 30-million-character string. The host has no way to opt out of
		// that: displaying the answer is what it asked the engine for.
		//
		// Fixing the shift fixes the formatter, since the formatter is only ever
		// as slow as the largest bigint the VM will hand it.
		const engine = newTrackedEngine("en");
		expect(refused(engine, "1n << 100000")).toBe(true);
	});

	test("the same ceiling applies however the shift is spelled", () => {
		// `VMConversion.ts`'s BigInt branch triggers when EITHER operand is one,
		// so a bigint on the right of an ordinary number reaches the same shift,
		// and `>>`'s sibling case needs the same guard: a bigint `>>` with a
		// negative count grows exactly as fast as a `<<` with a positive one.
		//
		// The four spellings answering the same way is the point. The one just
		// past the ceiling is the case that decided it: `1n << 66000` is an
		// ordinary 19,870-digit integer, and it used to come back as Infinity,
		// with nothing on screen to say a limit had been reached.
		const engine = newTrackedEngine("en");
		expect(refused(engine, "1 << 100000n")).toBe(true);
		expect(refused(engine, "1n << 66000")).toBe(true);
		expect(refused(engine, "1n >> -100000")).toBe(true);
		expect(refused(engine, "1 >> -100000n")).toBe(true);
	});
});

// ── Walking a calendar one day at a time ───────────────────────────────────

describe("a date offset costs the same whatever it is", () => {
	test("a plain calendar offset is arithmetic, not a walk", () => {
		// `addCalendarDays()` moves the day field once and lets Date recompute,
		// so a hundred thousand days costs exactly what one day costs. This is
		// the control: the next case uses the same magnitude in a unit that is
		// handled by a loop instead, and that is the only difference between them.
		const engine = newTrackedEngine("en");
		expect(evaluate(engine, "today + 100000 days").type).toBe(ValueType.Datetime);
	});

	test("including one counted in workdays", () => {
		// BUG. `vm/VM.ts`'s `addBusinessDays()` steps `date.setDate()` one
		// calendar day at a time and decrements a counter on the five days of the
		// week that are not a weekend, so the loop runs for as many days as the
		// user asked for. Nothing looks at the number first.
		//
		// The count here is a hundred thousand workdays, roughly 384 years, which
		// is already past `date.maxOffsetYears` in `constants/Configuration.ts`.
		// That field is declared, documented as a "safety limit", and read
		// nowhere in the engine, so it bounds nothing at all today.
		//
		// A hundred thousand only takes about 23 milliseconds. The reason this is
		// in this file and not in a performance one is that the cost is linear
		// and the input is three characters longer per factor of ten:
		// `today + 100000000 workdays` freezes the host for 13.2 seconds and then
		// answers "Invalid Date", and `today + 1000000000000 workdays` has no
		// answer at all. The instruction counter never runs during any of it,
		// because the whole walk happens inside one ADD.
		//
		// Which refusal is right is the guard author's call: rejecting an offset
		// past `date.maxOffsetYears` and rejecting one whose target date is not
		// representable both work. Walking it is what must not happen.
		const engine = newTrackedEngine("en");
		expect(refused(engine, "today + 100000 workdays")).toBe(true);
	});

	test("an offset a person would actually type still works", () => {
		// Pinned so a guard on the case above cannot be written by refusing
		// workday arithmetic outright.
		const engine = newTrackedEngine("en");
		const near = evaluate(engine, "today + 100 workdays");
		expect(near.type).toBe(ValueType.Datetime);
		expect(Number.isFinite(near.value as number)).toBe(true);
	});
});

// ── Counting products nobody can represent ─────────────────────────────────

describe("a combinatorial function refuses what it cannot answer", () => {
	test("factorial states its own ceiling and stops there", () => {
		// The precedent, and the reason the two cases below are inconsistent
		// rather than merely unguarded. `fact` knows that 171! is not a
		// representable double and says so instead of multiplying its way to
		// Infinity.
		const engine = newTrackedEngine("en");
		expect(evaluate(engine, "fact(171)").value).toBe("FACTORIAL_OVERFLOW");
		expect(evaluate(engine, "fact(170)").value).toBe(7.257415615307994e306);
	});

	test("and so does permutation, which is the same product", () => {
		// BUG. `VMBuiltins.ts` index 40 runs `for (let i = 0; i < r; i++)` with
		// `r` straight off the stack, having checked only that `0 <= r <= n`. The
		// running product passes MAX_VALUE within the first couple of hundred
		// iterations and is Infinity for the remaining million, so every one of
		// those iterations is spent multiplying Infinity by a number.
		//
		// A million iterations is six milliseconds, which is why this input is
		// safe to run. `permutation(1000000000, 1000000000)` is 650 milliseconds,
		// and the cost is exactly linear from there:
		// `permutation(1000000000000, 1000000000000)` had not returned after 30
		// seconds, and nothing in the grammar stops the exponent going higher.
		//
		// The correct answer is the one `fact` already gives: an argument whose
		// factorial-family product cannot be represented is refused up front.
		const engine = newTrackedEngine("en");
		expect(evaluate(engine, "permutation(1000000, 1000000)").type).toBe(ValueType.Error);
	});

	test("and combination, which loops over the smaller half of it", () => {
		// BUG, same shape, index 41. `k = min(r, n-r)` halves the trip count and
		// bounds nothing: the loop still runs five hundred thousand times here
		// and five hundred billion times for `combination(1e12, 5e11)`.
		const engine = newTrackedEngine("en");
		expect(evaluate(engine, "combination(1000000, 500000)").type).toBe(ValueType.Error);
	});

	test("the sizes these functions are actually for are untouched", () => {
		// Pinned for the same reason as the workday case above: the guard has to
		// be a ceiling, not a removal.
		const engine = newTrackedEngine("en");
		expect(evaluate(engine, "permutation(10, 3)").value).toBe(720);
		expect(evaluate(engine, "combination(10, 3)").value).toBe(120);
	});
});

// ── Calls, which the instruction counter refreshes rather than counts ───────

describe("how much a document of user-defined functions may run", () => {
	test("recursion DEPTH is bounded, and that guard works", () => {
		// `f(x) = f(x)` is the case `maxFunctionRecursionDepth` was written for,
		// and it catches it. Establishing this first is what makes the next case
		// specific: the guard counts how DEEP the calls nest and never how MANY
		// of them there are, and those are different numbers.
		const result = lastLineOf(["f(x) = f(x)", "f(1)"]);
		expect(result?.type).toBe(ValueType.Error);
		expect(String(result?.unit)).toContain("nesting exceeded maximum depth");
	});

	test("and so is how many calls a single line may make", () => {
		// BUG. Each function here calls the one below it twice, so line n makes
		// 2^(n-1) calls at a nesting depth of only n. Sixteen lines is 32,768
		// calls, which passes `maxFunctionRecursionDepth` (50) with room to spare
		// and passes `maxInstructions` (50,000) for a reason that is worse than
		// the number: `executeBytecode()` gives every reentrant call its OWN
		// `localInstructionCount`, so recursion refreshes its instruction
		// allowance on the way in. VM.ts's own comment at CALL_USER_FUNCTION says
		// exactly this, and treats it as the reason a depth guard is needed;
		// depth is not the only thing that runs away.
		//
		// Twenty-two lines of the same shape is 2,097,152 calls and a fatal V8
		// abort in under a second, which is not a slow test but a dead process.
		// The memory comes from `vm/Value.ts`'s ValueArena, which the document
		// path leaves enabled for the whole pass and which never shrinks: 118MB
		// was still live after two forced full collections at 2^19 calls. See
		// `DenialOfServiceRetainedMemory.spec.ts` for that half.
		//
		// The fix `vm/AllocationBudget.ts` already models is the one this wants:
		// a counter that a nested evaluation SPENDS FROM rather than replaces. Its
		// own doc comment gives the reasoning ("a runaway recursion cannot refresh
		// its own allowance the way it can refresh maxInstructions"), which is a
		// description of this bug.
		const chain = [
			"f1(v) = v + 1",
			...Array.from({ length: 15 }, (_, index) => `f${index + 2}(v) = f${index + 1}(v) + f${index + 1}(v)`),
			"f16(1)",
		];
		expect(lastLineOf(chain)?.type).toBe(ValueType.Error);
	});

	test("an ordinary function-heavy document is untouched", () => {
		// The guard above has to bound total calls, not forbid nesting. Five
		// levels of composition is 16 calls and must keep working.
		const chain = [
			"g1(v) = v + 1",
			...Array.from({ length: 4 }, (_, index) => `g${index + 2}(v) = g${index + 1}(v) + g${index + 1}(v)`),
			"g5(1)",
		];
		expect(lastLineOf(chain)?.value).toBe(32);
	});
});

/**
 * The half of the same problem that happens before any opcode runs.
 *
 * Everything above bounds EXECUTION. None of it applies to a line the engine
 * rejects, because rejecting it happens entirely inside `compileExpression()`
 * and execution never starts: `maxInstructions`, `maxStackDepth` and the
 * allocation budget are all counted by the VM, and `maxExpressionLength` was
 * 2000 while the case that froze for eighteen seconds was 723 characters.
 *
 * A host that evaluates as the user types is the one that pays for this, and it
 * pays on input the engine was going to refuse anyway.
 */
describe("rejecting a line is not allowed to cost more than running one", () => {
	/** How long a line takes to be accepted or refused, whichever it is. */
	function millisecondsToSettle(source: string): number {
		const engine = new ExpressionEngine("en");
		const started = performance.now();
		try {
			engine.evaluateExpression(source);
		} catch {
			// Refusal is the expected outcome for every line below. The cost of
			// reaching it is the whole measurement.
		}
		const elapsed = performance.now() - started;
		engine.clear();
		return elapsed;
	}

	/** A line the engine must refuse, carrying `count` labelled-line colons. */
	function colonHeavyLine(count: number): string {
		// The trailing ")" is what makes the whole-line parse fail, which is
		// what sends it into the labelled-line fallback in the first place.
		return Array.from({ length: count }, (_, index) => `a${index}:`).join(" ") + " )";
	}

	test("a line full of colons is refused in linear time, not exponential", () => {
		// The labelled-line fallback retries the line once per colon, from the
		// rightmost leftwards. Each retry used to run the FULL fallback again on
		// its own suffix, and the suffixes a retry reaches are the ones this
		// loop already visits itself, so the work doubled per colon: a line with
		// k colons compiled 2^k times.
		//
		// Measured before the fix, on the fuzz corpus case this came from: 723
		// characters, 19 colons, 524,288 parse attempts, 18 seconds, and then
		// UNEXPECTED_TRAILING_TOKEN. Doubling the colons doubled nothing that
		// mattered to the answer and multiplied the cost by 2^k, which is what
		// this asserts is gone.
		const twenty = millisecondsToSettle(colonHeavyLine(20));
		const forty = millisecondsToSettle(colonHeavyLine(40));

		// Twice the colons must not be more than a small multiple of the work.
		// Deliberately loose: the point is the difference between linear and
		// 2^20, not a throughput number that would fail on a busy machine.
		expect(forty).toBeLessThan(Math.max(twenty, 1) * 20);
		expect(forty).toBeLessThan(1000);
	});

	test("the corpus cases that took seconds now settle in milliseconds", () => {
		// The two recorded findings, verbatim. Both are refused at the end, so
		// every millisecond spent on them was spent deciding to say no.
		const slow =
			"\"q\" , 59:64 , 7d42 , [204,737,952e-22,-164915] , e , \"x\" , 0b110011000000101 , liczr , 8 HTG/Pl , 1d180 , 2:150 , -13:-88 , 6:2147483648 && 7d138 as dec != convert 45:93 best ? as octal as oct[sign() take if ---[253982n,5;0x18a30cd0,65536;76e-214,21] != :s = \"u\" off what 11d78 < e | between 33:54:54:4 and 98:38:32:20 then -------1:9007199254740991 else 3d9 * [532,307,184,625] * 33:128 * 844e288 fb * 7 * 1:2147483648 * true * xywped * dw * today * pi * 97:-79 * false * 20:-62 * 16:03 * 0xbe75680c gigabyte * 14d181 * \"wd\" * 166,368 RON * 812005n megaseconds * 0b11011011110111 * -9:9 * [882673n], !(if -(8PL) then map(qaujng(rgkdl) = convert pi to gigawatt, [0b1001011110,4]) else sin(:cypkdx = (24:15))) to hm3]";
		const hang =
			":hq = 429% ^ e ^ 41:170 ^ true ^ 2:2147483648 ^ e ^ 77:3 ^ \"fw\" ^ 12:20 ^ 32.7233342 ^ 4:1000000000 ^ 242,408 ^ 36:83:98:39 ^ 12PM ^ last monday ^ pi ^ -2:93 ^ 3:06 ^ 4pi ^ -92:93 ^ -73:-65 tomorrow u= c(ed) = !\"x\" != 35:73:87:57 remainder of (e) = increase sum(\"yk\", -76:116) by 55% | [0xd30caab0,65536,293090;427,285,603e89,498e-277][sum(if (e) then \"qzi\" by 11:38 else 2:1000000000 week number on until monday and 51:46:96:73 annual interest on i(tebft) = 6d130 >> prod(s, -39:89) mod 1.5429371781647206e+92 DOT week number on 623k milligram/lux <= false, -34:124), der(qbek(exs) = from 9:23 and 1921]";

		// One second each, against 18 and over 5 seconds before. Generous by two
		// orders of magnitude, because the failure this guards against is not a
		// regression of a few percent, it is the exponent coming back.
		expect(millisecondsToSettle(slow)).toBeLessThan(1000);
		expect(millisecondsToSettle(hang)).toBeLessThan(1000);
	});

	test("and a real labelled line still works", () => {
		// The fallback's actual job, which the fix must not have cut away with
		// the redundant retries. Both of these reach it: the whole line does not
		// parse, and the fragment after a colon does.
		const engine = new ExpressionEngine("en");
		try {
			expect(engine.evaluateExpression("pi approximation: 355/113")[0].toNumber()).toBeCloseTo(3.14159, 4);
			// The leftward retry: the rightmost colon here belongs to ":x = 5",
			// and slicing after it would strip the colon the definition needs.
			expect(engine.evaluateExpression("input value: :x = 5")[0].toNumber()).toBe(5);
		} finally {
			engine.clear();
		}
	});
});

/**
 * The loop that had no ceiling because its trip count was never a count.
 *
 * Every case in the first block above runs a large but finite number of
 * iterations, so scaling the input down makes them merely slow. This one does
 * not terminate at all, on any input size, which is why it sits apart: the
 * Euclidean algorithm ends because the remainder shrinks to zero, and a NaN
 * remainder never shrinks to anything. Nine characters wedged the host
 * permanently, inside a single opcode that neither the instruction counter nor
 * the allocation budget can see into.
 *
 * Found by the fuzzer, as a hang rather than as a slow case, which is the
 * distinction that matters: a slow case finishes.
 */
describe("gcd and lcm terminate on every operand", () => {
	/** Evaluates a source line, returning the Value. */
	function evaluate(source: string): Value {
		const engine = new ExpressionEngine("en");
		try {
			return engine.evaluateExpression(source)[0];
		} finally {
			engine.clear();
		}
	}

	test.each([
		["a NaN reached through a real function", "gcd(4, arccos(2))"],
		["a NaN written directly", "gcd(4, 0/0)"],
		["a NaN on the left", "gcd(0/0, 4)"],
		["an infinity", "gcd(4, 1/0)"],
		["the same in lcm, which had its own copy of the loop", "lcm(4, 0/0)"],
		["an infinity in lcm", "lcm(4, 1/0)"],
	])("%s is refused rather than looped on", (_name, source) => {
		// If this regresses, the test does not fail, it never returns, and it
		// takes the whole Jest run with it. That is the shape of the bug and
		// there is no way to assert on it from inside without reproducing it.
		expect(evaluate(source).type).toBe(ValueType.Error);
	});

	test("and the ordinary answers are unchanged", () => {
		// The guard has to reject non-finite operands, not integers it dislikes.
		expect(evaluate("gcd(12, 18)").toNumber()).toBe(6);
		expect(evaluate("gcd(-12, 18)").toNumber()).toBe(6);
		expect(evaluate("gcd(0, 0)").toNumber()).toBe(0);
		expect(evaluate("gcd(2.9, 4.9)").toNumber()).toBe(2);
		expect(evaluate("lcm(4, 6)").toNumber()).toBe(12);
		expect(evaluate("lcm(0, 5)").toNumber()).toBe(0);
	});
});
