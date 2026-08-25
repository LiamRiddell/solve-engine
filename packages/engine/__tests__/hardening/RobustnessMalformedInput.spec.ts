/**
 * What the engine does with input nobody would type on purpose.
 *
 * The lexer/parser/VM layer is the one place in this codebase where a defect
 * is not a wrong number but a dead host: a hang blocks the editor's main
 * thread, and an uncaught throw escapes whatever per-line containment the
 * caller built. So the property under test here is deliberately weak and
 * deliberately total. For a corpus of several hundred malformed lines, and
 * through every public entry point that accepts a string, the engine must do
 * exactly one of two things: return a Value, or throw an `EngineError`. Never
 * a raw `TypeError`, never a `RangeError`, never nothing at all.
 *
 * `EngineError` is the bar rather than "some Error" because
 * `normalizeUnknownError()` already stands at every throw/Result boundary, so
 * a raw JS error escaping means it escaped from OUTSIDE those boundaries,
 * which is the interesting failure. The corpus is written as literal strings
 * rather than generated so a failure names the exact input.
 *
 * The builtin-arity sweep at the bottom used to fail. `sqrt()` reported
 * "Cannot read properties of undefined (reading 'toNumber')", a raw V8 message
 * wearing an `EngineError` costume: `normalizeUnknownError()` caught the
 * TypeError and re-labelled it `UNEXPECTED_ERROR`, category INTERNAL,
 * `recoverable: false`, so a user typo reached the host as an engine bug, in
 * V8's words. Two changes fixed it, and both are pinned below:
 *
 *   - `CALL_BUILTIN` checks the argument count against `vm/VMBuiltinArity.ts`
 *     before dispatching, and raises a recoverable, named error.
 *   - `normalizeUnknownError()` no longer marks an unanticipated error fatal.
 *     It happened on ONE line and the engine keeps working, which is what
 *     `RobustnessEngineLifecycle.spec.ts` demonstrates; the INTERNAL category
 *     is what still says "the engine's fault, worth reporting".
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { EngineError, ErrorCategory, normalizeUnknownError } from "@solve-js/errors/EngineError";
import { builtinNameToIndex } from "@solve-js/packages/function/parselets/FunctionCallParselet";

/**
 * Input shapes that a real document produces by accident: half-typed lines,
 * pasted prose, mismatched brackets, and the character classes that tend to
 * be forgotten (control codes, zero-width spaces, RTL marks, astral-plane
 * emoji, non-ASCII digits).
 */
const MALFORMED: string[] = [
	// Nothing at all, and things that look like nothing.
	"", " ", "\t", "\n", "   \t  ", "\0", "a\0b", "\x07", "\x1b[31m",
	"​", "﻿", " ", " ",

	// A single operator, and operators with an operand missing on either side.
	"+", "-", "*", "/", "^", "%", "=", "==", "!", "&", "|", "~", "?", ":",
	"1+", "1-", "1*", "1/", "1^", "1=", "+1", "*1", "/1", "^1",
	"1++", "1**", "1^^", "1 + * 2", "1 * / 2", "--1", "---1", "++1",
	"1 +", "1 -", "()", "( )", "(,)", ",", ",,", ";", ";;", "--",

	// Brackets that do not match, in both directions and every flavour.
	"(", ")", "((", "))", "(1", "1)", "(1+2", "1+2)", "((1+2)", "(1+2))",
	"[", "]", "[1", "1]", "[1,2", "[1;2", "{", "}", "{1", "1}",
	"[[", "]]", "[[x", "(".repeat(10), ")".repeat(10),
	"[]", "[][]", "[[]]", "()()", "(())", "[1,2][", "[1,2][0", "x[", "x[]",

	// Quotes and backticks left open.
	"\"", "'", "\"abc", "abc\"", "'abc", "`", "``", "s`", "s`1+1",

	// Conversion and percentage keywords with the other half missing.
	"to", "in", "as", "1 to", "1 in", "to USD", "in m", "1 to to", "1 as as",
	"5 km to", "5 to km to", "% of", "10% of", "of 10", "1 of", "%%", "%1",
	"10% off", "off 10%", "5 km to xyzzy", "5 xyzzy to km",

	// Identifiers: absurdly long, punctuation-only, and non-Latin scripts.
	"a".repeat(1000), "_", "__", "$", "$$", "@", "#", "##", "###x",
	"日本語", "日本語 + 1", "ñ + 1",
	"🙂", "1 + 🙂", "🙂 = 5", "x🙂y",
	"٣٤", "١٢٣ + 1",
	"مرحبا", "1 + مرحبا",
	"‮1+2‬",

	// Keywords standing alone or in the wrong place.
	"if", "then", "else", "and", "or", "not", "true", "false", "null",
	"sum", "total", "avg", "prev", "line", "line 1", "line 0", "line -1",
	"sum(", "sum()", "sum(,)", "avg()", "matrix", "map(", "map(x)", "map(x, )",
	"reduce()",

	// Function-call and definition syntax, broken in each possible place.
	"sqrt", "sqrt(", "sqrt(,)", "round(1,)", "round(,1)",
	"f(", "f()", "f(x", "f(x)", "f(x) =", "f() = 1", "f(x) = f(x)",
	"f(x,) = 1", "f(,x) = 1", "f(1) = 1",

	// Assignment and global-variable shapes.
	":", ":=", ":x", ":x =", ": = 5", ":= 5", "x =", "= 5", "x = =",
	"global", "global :", "global :x", "global :x =",

	// The symbolic `=>` grammar with nothing to work on.
	"=>", " =>", "=> x", "x =>", "1 =>", "=>=>", "x => =>",
	"solve(", "solve()", "solve(x)", "factor()", "der()", "der(x)",

	// Numeric literals that are almost, but not quite, numbers.
	".", "..", "...", "1.2.3", "1e", "1e+", "1e-", "1e999", "0x", "0xzz",
	"0b", "0o", "1_", "_1", "1__0", "1..2", "1,,2", "1_000_000", "0x1p1",
	"1/", "/1", "1/2/", "13/13/2020", "99:99", "2020-", "-2020",

	// Several complete expressions run together with no operator between them.
	"1 2 3", "a b c", "1 1 1 1 1", "1!!!!", "[1;2;3][9]",
];

/** Every public method that takes a raw string and can be called with one line. */
function entryPoints(engine: ReturnType<typeof newTrackedEngine>, source: string): Array<[string, () => unknown]> {
	return [
		["evaluateExpression", () => engine.evaluateExpression(source)],
		["evaluateLine", () => engine.evaluateLine(7, source)],
		["evaluateLineWithDebug", () => engine.evaluateLineWithDebug(7, source)],
		["evaluateLines", () => engine.evaluateLines([source])],
		["parseDocument", () => engine.parseDocument(source)],
		["compileExpression", () => engine.compileExpression(source)],
		["tryCompileExpression", () => engine.tryCompileExpression(source)],
		["evaluateNumber", () => engine.evaluateNumber(source)],
	];
}

describe("malformed input reaches an answer or an EngineError, never a JS error", () => {
	test("every entry point, over the whole corpus", () => {
		const engine = newTrackedEngine();
		const escaped: string[] = [];
		for (const source of MALFORMED) {
			for (const [name, call] of entryPoints(engine, source)) {
				try {
					call();
				} catch (thrown) {
					if (thrown instanceof EngineError) continue;
					const kind = thrown instanceof Error ? thrown.constructor.name : typeof thrown;
					escaped.push(`${name}(${JSON.stringify(source)}) threw ${kind}: ${String((thrown as Error)?.message).slice(0, 80)}`);
				}
			}
		}
		expect(escaped).toEqual([]);
	});

	test("an EngineError always carries a non-empty message", () => {
		// A structured error with an empty `.message` is worse than a raw one:
		// hosts print `.message` and would show a blank line where the reason
		// should be. Cheap to assert over the whole corpus, so assert it.
		const engine = newTrackedEngine();
		const silent: string[] = [];
		for (const source of MALFORMED) {
			try {
				engine.evaluateExpression(source);
			} catch (thrown) {
				const message = (thrown as EngineError).message;
				if (typeof message !== "string" || message.trim().length === 0) {
					silent.push(JSON.stringify(source));
				}
			}
		}
		expect(silent).toEqual([]);
	});

	test("an EngineError always carries a code from the catalog shape", () => {
		// `.code` is what a host groups and localises on. An empty or
		// non-string code means the throw site skipped ErrorFactory entirely.
		const engine = newTrackedEngine();
		const uncoded: string[] = [];
		for (const source of MALFORMED) {
			try {
				engine.evaluateExpression(source);
			} catch (thrown) {
				const code = (thrown as EngineError).code;
				if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(code)) {
					uncoded.push(`${JSON.stringify(source)} -> ${String(code)}`);
				}
			}
		}
		expect(uncoded).toEqual([]);
	});

	test("one engine survives the whole corpus and still evaluates afterwards", () => {
		// The corpus above uses a fresh engine per assertion loop but the same
		// instance across inputs, which is the real usage: a document is
		// re-evaluated on every keystroke, so a failed line must leave nothing
		// behind. If a half-finished parse left the parser's token cursor or
		// the VM stack dirty, the arithmetic at the end would drift.
		const engine = newTrackedEngine();
		for (const source of MALFORMED) {
			try {
				engine.evaluateExpression(source);
			} catch {
				/* every one of these is allowed to fail; only the aftermath matters */
			}
		}
		expect(engine.evaluateExpression("2+2").toNumber()).toBe(4);
		expect(engine.evaluateExpression("(1+2)*(3+4)").toNumber()).toBe(21);
		engine.evaluateLine(1, ":x = 5");
		expect(engine.evaluateLine(2, ":x * 3").toNumber()).toBe(15);
	});

	test("interleaving malformed lines with good ones does not corrupt the good ones", () => {
		// Same property, but with the failures happening BETWEEN two lines that
		// depend on each other rather than all up front, which is what a
		// half-typed line in the middle of a document actually looks like.
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":total = 10");
		for (const source of MALFORMED) {
			try {
				engine.evaluateLine(2, source);
			} catch {
				/* expected for most of the corpus */
			}
		}
		expect(engine.evaluateLine(3, ":total + 5").toNumber()).toBe(15);
	});
});

/**
 * Calls to a builtin with the wrong number of arguments, over every name the
 * parser will resolve. `FunctionCallParselet` accepts any argument count and
 * emits it verbatim; `CALL_BUILTIN` pops exactly that many and hands the array
 * to an implementation that indexes it positionally with no length check. So
 * `sqrt()` reaches `args[0].toNumber()` with `args` empty.
 */
function wrongArityCalls(): string[] {
	const calls: string[] = [];
	for (const name of Object.keys(builtinNameToIndex)) {
		calls.push(`${name}()`, `${name}(1)`, `${name}(1,2)`);
	}
	return calls;
}

describe("a builtin called with the wrong number of arguments", () => {
	test("the call is at least contained, whatever it reports", () => {
		// The weak half of the property, and it does hold: nothing crashes the
		// process and nothing escapes as a raw TypeError. Kept green so the
		// containment stays pinned independently of the message quality below.
		const engine = newTrackedEngine();
		for (const source of wrongArityCalls()) {
			try {
				engine.evaluateExpression(source);
			} catch (thrown) {
				expect(thrown).toBeInstanceOf(EngineError);
			}
		}
	});

	test("says which function and how many arguments, not what V8 saw", () => {
		// Around ninety of these calls used to report `UNEXPECTED_ERROR: Cannot
		// read properties of undefined (reading 'toNumber')` or `(reading
		// 'type')`, which was `normalizeUnknownError()` wrapping a raw TypeError
		// thrown from inside `builtinFunctions[n]`.
		//
		// Two things were wrong with that, beyond the unreadable text. The code
		// was `UNEXPECTED_ERROR` in category INTERNAL with `recoverable: false`,
		// so `isFatal()` was true and the host was told a user typo is an engine
		// bug worth reporting. And the message named no function, so nothing
		// downstream could say which call was short of arguments.
		//
		// The fix is at the `CALL_BUILTIN` dispatch in `vm/VM.ts`, which is the
		// one place that knows both the function index and the argument count,
		// reading the table in `vm/VMBuiltinArity.ts`, not in each of the ~90
		// implementations.
		const engine = newTrackedEngine();
		const raw: string[] = [];
		for (const source of wrongArityCalls()) {
			try {
				engine.evaluateExpression(source);
			} catch (thrown) {
				const error = thrown as EngineError;
				if (error.code === "UNEXPECTED_ERROR" || error.code === "UNKNOWN_ERROR") {
					raw.push(`${source} -> ${error.code}: ${error.message}`);
				}
			}
		}
		expect(raw).toEqual([]);
	});

	test("names the function and the count it wanted", () => {
		// The positive half of the test above: not merely "not a V8 message"
		// but the specific thing a reader needs, which is which call was wrong.
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression("sqrt()")).toThrow(/sqrt/);
		expect(() => engine.evaluateExpression("sqrt()")).toThrow(/1 argument/);
		expect(() => engine.evaluateExpression("atan2(1)")).toThrow(/atan2/);
		expect(() => engine.evaluateExpression("atan2(1)")).toThrow(/2 arguments/);
	});

	test("an extra argument is reported rather than silently discarded", () => {
		// `sqrt(1,2,3)` answered 1: the two arguments past the first were popped
		// and dropped, so a reader who meant something by them was never told
		// that nothing was done with them. The variadic builtins stay variadic.
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression("sqrt(1,2,3)")).toThrow(EngineError);
		expect(() => engine.evaluateExpression("gcd(4,6,8)")).toThrow(EngineError);
		expect(engine.evaluateExpression("max(1,2,3,4)").toNumber()).toBe(4);
		expect(engine.evaluateExpression("hypot(3,4)").toNumber()).toBe(5);
	});

	test("is a recoverable user error, not a fatal engine fault", () => {
		// The classification, pinned rather than left incidental. A host that
		// honours `isFatal()` would tear a document down over one typed line if
		// this regressed, and the previous behaviour did exactly that: the raw
		// TypeError arrived as category INTERNAL with `recoverable: false`.
		const engine = newTrackedEngine();
		for (const source of ["sqrt()", "atan2(1)", "pow(1)", "gcd(1)", "det()", "inv()", "sqrt(1,2,3)"]) {
			try {
				engine.evaluateExpression(source);
				throw new Error(`expected ${source} to fail`);
			} catch (thrown) {
				const error = thrown as EngineError;
				expect(error).toBeInstanceOf(EngineError);
				expect(error.recoverable).toBe(true);
				expect(error.isFatal()).toBe(false);
			}
		}
	});

	test("an unanticipated internal error is recoverable too", () => {
		// The general form of the property above, one level down. Fixing arity
		// removed today's ~90 ways to reach `normalizeUnknownError()`, but any
		// future internal slip lands there, and a default of `recoverable:
		// false` would report it to the host as a reason to stop. The category
		// stays INTERNAL, which is what carries "this is worth reporting".
		const wrapped = normalizeUnknownError(new TypeError("something the engine did not anticipate"));
		expect(wrapped.category).toBe(ErrorCategory.INTERNAL);
		expect(wrapped.recoverable).toBe(true);
		expect(wrapped.isFatal()).toBe(false);
	});
});
