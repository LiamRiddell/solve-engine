/**
 * `EngineError`'s reporting surface, published through the
 * `solve-engine/errors` subpath.
 *
 * `errors/Result.ts` and the error-code catalog are both well covered.
 * `EngineError` itself is not: `format()`, `causeChain()` and `toJSON()` were
 * all unreached, and those three are exactly the methods a host calls, since
 * they are the only ways to get anything out of an error beyond `.message`.
 * `format()`'s own doc comment calls it "the NEW thing a host/CLI/test reaches
 * for", and nothing reached for it.
 *
 * The distinction these tests are protecting is the one the class doc spends
 * most of its length on: `category` says whose fault an error is, and
 * `recoverable` says whether the host may carry on. Conflating them told a
 * host to tear a document down over one bad line, which is a defect this
 * codebase has already had once.
 */

import { describe, expect, test } from "@jest/globals";
import {
	EngineError,
	ErrorCategory,
	ErrorFactory,
	normalizeUnknownError,
} from "@solve-js/errors/EngineError";

describe("format", () => {
	test("a bare error is one line: the code in brackets, then the message", () => {
		/*
		 * The `error[CODE]: message` header is the shape the doc comment
		 * shows, and it is what makes a log line greppable by code without
		 * parsing the prose after it.
		 */
		const error = new EngineError(ErrorCategory.PARSING, {
			code: "WEATHER_EXPECTED_CITY",
			message: 'Expected a city name after "weather in"',
		});

		expect(error.format()).toBe('error[WEATHER_EXPECTED_CITY]: Expected a city name after "weather in"');
	});

	test("each optional field adds its own indented line, in a fixed order", () => {
		/*
		 * Expected, then found, then suggestion. The order is what makes the
		 * block readable as a sentence: here is what should have been there,
		 * here is what was, here is how to fix it. It is also worth pinning
		 * because a host may be laying the lines out in a panel.
		 */
		const error = new EngineError(ErrorCategory.PARSING, {
			code: "WEATHER_EXPECTED_CITY",
			message: 'Expected a city name after "weather in"',
			expected: "a city name",
			found: "end of expression",
			suggestion: 'e.g. "weather in London"',
		});

		expect(error.format()).toBe(
			[
				'error[WEATHER_EXPECTED_CITY]: Expected a city name after "weather in"',
				"  expected: a city name",
				"  found: end of expression",
				'  suggestion: e.g. "weather in London"',
			].join("\n"),
		);
	});

	test("an absent field contributes no line at all", () => {
		// A blank "found:" line would be worse than none: it reads as "found
		// nothing", which is a claim about the input rather than about how
		// much the engine knew.
		const error = new EngineError(ErrorCategory.VALIDATION, {
			code: "SOME_CODE",
			message: "Something went wrong",
			suggestion: "try the other spelling",
		});

		expect(error.format()).toBe(
			["error[SOME_CODE]: Something went wrong", "  suggestion: try the other spelling"].join("\n"),
		);
	});

	test("message stays the short single line format() is built on top of", () => {
		/*
		 * `.message` is deliberately not the verbose rendering: existing
		 * `.toThrow(/pattern/)` assertions across this repo match against it,
		 * and a host printing an uncaught error gets the short form. The rich
		 * detail is additive.
		 */
		const error = ErrorFactory.parsing({
			code: "SOME_CODE",
			message: "Short and stable",
			expected: "something",
			found: "something else",
		});

		expect(error.message).toBe("Short and stable");
		expect(error.format()).toContain("Short and stable");
		expect(error.format().split("\n")).toHaveLength(3);
	});
});

describe("causeChain", () => {
	test("an error with no cause is a chain of one, itself", () => {
		// Not an empty array: the walk starts at the error being asked, so a
		// caller can render the chain unconditionally.
		const error = ErrorFactory.execution("SOME_CODE", "no underlying cause");
		expect(error.causeChain()).toEqual([error]);
	});

	test("walks the whole chain, outermost first", () => {
		/*
		 * The order is what makes the chain readable as a narrative: the
		 * thing the caller was doing, then what it was doing that for, down
		 * to the original failure. Reversing it would put a socket error at
		 * the top of a currency-conversion report.
		 */
		const root = new Error("ECONNREFUSED");
		const middle = ErrorFactory.external({
			code: "RATE_FETCH_FAILED",
			message: "exchange rate request failed",
			cause: root,
		});
		const outer = ErrorFactory.execution({
			code: "CURRENCY_RATE_UNAVAILABLE",
			message: "no rate for USD to GBP",
			cause: middle,
		});

		expect(outer.causeChain()).toEqual([outer, middle, root]);
	});

	test("stops at a non-Error cause instead of trying to walk into it", () => {
		/*
		 * `cause` is typed `unknown`, so a package is free to attach a string
		 * or a plain object. Reading `.cause` off a string would be undefined
		 * and end the walk anyway, but the value itself still belongs in the
		 * chain: it is what somebody chose to attach.
		 */
		const error = ErrorFactory.external({
			code: "SOME_CODE",
			message: "wrapping something that is not an Error",
			cause: { status: 503 },
		});

		const chain = error.causeChain();
		expect(chain).toHaveLength(2);
		expect(chain[0]).toBe(error);
		expect(chain[1]).toEqual({ status: 503 });
	});

	test("a null cause ends the chain rather than appearing in it", () => {
		// `null` is a value somebody assigned, but it carries no information
		// a reader can use, and including it would make every chain that has
		// one a line longer for nothing.
		const error = ErrorFactory.external({
			code: "SOME_CODE",
			message: "explicitly null cause",
			cause: null,
		});
		expect(error.causeChain()).toEqual([error]);
	});
});

describe("toJSON", () => {
	test("carries every field a host would need to reconstruct the error remotely", () => {
		/*
		 * This is what crosses a worker boundary or lands in a log store. A
		 * field missing here is a field that silently stops existing once the
		 * error leaves the process, which is the hardest kind of gap to
		 * notice from the other side.
		 */
		const error = new EngineError(ErrorCategory.EXECUTION, {
			code: "SOME_CODE",
			message: "the message",
			expected: "the expectation",
			found: "the reality",
			suggestion: "the fix",
			recoverable: true,
			span: { start: 4, end: 9, line: 1, col: 5 },
			context: { lineNumber: 12 },
		});

		const json = error.toJSON();

		expect(json.name).toBe("EngineError");
		expect(json.category).toBe(ErrorCategory.EXECUTION);
		expect(json.code).toBe("SOME_CODE");
		expect(json.message).toBe("the message");
		expect(json.expected).toBe("the expectation");
		expect(json.found).toBe("the reality");
		expect(json.suggestion).toBe("the fix");
		expect(json.recoverable).toBe(true);
		expect(json.span).toEqual({ start: 4, end: 9, line: 1, col: 5 });
		expect(json.context).toEqual({ lineNumber: 12 });
	});

	test("the timestamp is an ISO string, not a Date that would serialise twice", () => {
		/*
		 * `JSON.stringify` calls `toJSON()`, and a Date left in the result
		 * would be stringified by the outer pass as well. Doing it here means
		 * one representation regardless of who serialises.
		 */
		const error = ErrorFactory.execution("SOME_CODE", "timestamped");
		const json = error.toJSON();

		expect(typeof json.timestamp).toBe("string");
		expect(new Date(json.timestamp as string).getTime()).toBe(error.timestamp.getTime());
	});

	test("survives JSON.stringify and comes back with its fields intact", () => {
		const error = ErrorFactory.validation({
			code: "SOME_CODE",
			message: "round trip",
			found: "a value",
		});

		const revived = JSON.parse(JSON.stringify(error)) as Record<string, unknown>;
		expect(revived.code).toBe("SOME_CODE");
		expect(revived.message).toBe("round trip");
		expect(revived.found).toBe("a value");
		expect(revived.category).toBe(ErrorCategory.VALIDATION);
	});
});

describe("category and recoverable answer different questions", () => {
	test("an INTERNAL error is still recoverable by default", () => {
		/*
		 * The whole point of the split, and a regression this codebase has
		 * already had: INTERNAL says the engine is at fault and this is worth
		 * reporting as a bug, but it happened on ONE line and the host may
		 * carry on. Reporting it as fatal made a host tear a document down.
		 */
		const error = ErrorFactory.internal("SOME_CODE", "an invariant slipped");
		expect(error.category).toBe(ErrorCategory.INTERNAL);
		expect(error.recoverable).toBe(true);
		expect(error.isFatal()).toBe(false);
	});

	test("a configuration error is the one that is fatal by default", () => {
		// There is no working engine to carry on with when registration or
		// configuration failed, which is what makes this the exception.
		const error = ErrorFactory.config("SOME_CODE", "bad configuration");
		expect(error.category).toBe(ErrorCategory.CONFIG);
		expect(error.recoverable).toBe(false);
		expect(error.isFatal()).toBe(true);
	});

	test("isFatal is exactly the negation of recoverable", () => {
		const recoverable = new EngineError(ErrorCategory.PARSING, {
			code: "SOME_CODE",
			message: "m",
			recoverable: true,
		});
		const fatal = new EngineError(ErrorCategory.PARSING, {
			code: "SOME_CODE",
			message: "m",
			recoverable: false,
		});

		expect(recoverable.isFatal()).toBe(false);
		expect(fatal.isFatal()).toBe(true);
	});
});

describe("normalizeUnknownError", () => {
	test("passes an EngineError straight through, unwrapped", () => {
		// Re-wrapping would bury the original code one level down, where
		// every `catch` that switches on `.code` would stop seeing it.
		const original = ErrorFactory.parsing("SOME_CODE", "already ours");
		expect(normalizeUnknownError(original)).toBe(original);
	});

	test("wraps a raw JS error as INTERNAL but keeps it recoverable", () => {
		/*
		 * An unanticipated error is the engine's fault, hence INTERNAL, but
		 * it still happened on one line. Marking these fatal is exactly what
		 * turned a user's typo into a reported engine failure.
		 */
		const wrapped = normalizeUnknownError(new TypeError("cannot read x of undefined"));
		expect(wrapped).toBeInstanceOf(EngineError);
		expect(wrapped.category).toBe(ErrorCategory.INTERNAL);
		expect(wrapped.recoverable).toBe(true);
		expect(wrapped.message).toContain("cannot read x of undefined");
	});

	test("wraps a thrown non-Error under its own code, keeping the text in context", () => {
		/*
		 * `throw "boom"` is legal JavaScript and third-party package code
		 * does it. There is no `.message` to carry forward, so the message
		 * is a fixed sentence and the thrown value is stringified into
		 * `context.error`, which is the only record of what was actually
		 * thrown. The separate UNKNOWN_ERROR code is what lets a host tell
		 * this case from a real Error it could have read a stack off.
		 */
		const wrapped = normalizeUnknownError("boom");
		expect(wrapped).toBeInstanceOf(EngineError);
		expect(wrapped.code).toBe("UNKNOWN_ERROR");
		expect(wrapped.context?.error).toBe("boom");
		expect(wrapped.recoverable).toBe(true);
	});

	test("a real Error keeps its own message and its name", () => {
		// The two branches differ in what can be recovered: an Error has a
		// message worth promoting, a bare value does not.
		const wrapped = normalizeUnknownError(new RangeError("out of range"));
		expect(wrapped.code).toBe("UNEXPECTED_ERROR");
		expect(wrapped.message).toBe("out of range");
		expect(wrapped.context?.originalErrorName).toBe("RangeError");
	});
});
