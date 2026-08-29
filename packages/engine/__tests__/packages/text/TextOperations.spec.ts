/**
 * Text operations on String values (issues #236, #237): measuring, testing and
 * reshaping text. Each form is exercised in both its natural-language spelling
 * and, where it has one, its call spelling, and every non-text input is checked
 * to fault rather than answer a wrong value.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");
const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("concatenation", () => {
	test("text joins to text with +", () => {
		expect(shown('"hello" + " world"')).toBe("hello world");
	});
});

describe("measuring text", () => {
	test("length of, and the call form", () => {
		expect(value('length of "hello"').toNumber()).toBe(5);
		expect(value('length("hello")').toNumber()).toBe(5);
	});

	test("length counts a code point once, not its surrogate halves", () => {
		expect(value('length of "a😀b"').toNumber()).toBe(3);
	});

	test("words in / characters in / lines in", () => {
		expect(value('words in "the quick brown fox"').toNumber()).toBe(4);
		expect(value('characters in "hello"').toNumber()).toBe(5);
		expect(value('lines in "a\nb\nc"').toNumber()).toBe(3);
	});
});

describe("testing text", () => {
	test("contains", () => {
		expect(value('"hello" contains "ell"').toNumber()).toBe(1); // true
		expect(value('"hello" contains "xyz"').toNumber()).toBe(0); // false
	});

	test("starts with / ends with", () => {
		expect(value('"hello" starts with "he"').toNumber()).toBe(1);
		expect(value('"hello" ends with "lo"').toNumber()).toBe(1);
		expect(value('"hello" ends with "he"').toNumber()).toBe(0);
	});
});

describe("reshaping text", () => {
	test("trim", () => {
		expect(shown('trim "  hi  "')).toBe("hi");
		expect(shown('trim("  hi  ")')).toBe("hi");
	});

	test("reverse", () => {
		expect(shown('reverse "hello"')).toBe("olleh");
	});

	test("replace (function form; literal replace-all)", () => {
		expect(shown('replace("banana", "a", "@")')).toBe("b@n@n@");
	});

	test("repeated N times, and the trailing 'times' is optional", () => {
		expect(shown('"ab" repeated 3 times')).toBe("ababab");
		expect(shown('"ab" repeated 3')).toBe("ababab");
	});
});

describe("case and slug converters", () => {
	test("as upper / lower / title / slug", () => {
		expect(shown('"hello world" as upper')).toBe("HELLO WORLD");
		expect(shown('"HELLO" as lower')).toBe("hello");
		expect(shown('"hello world" as title')).toBe("Hello World");
		expect(shown('"Hello, World!" as slug')).toBe("hello-world");
	});

	test("call forms too", () => {
		expect(shown('upper("hi")')).toBe("HI");
		expect(shown('slug("A B C")')).toBe("a-b-c");
	});
});

describe("a non-text input faults rather than answering a wrong value", () => {
	test("length of a number is an error", () => {
		expect(value("length of 42").type).toBe(ValueType.Error);
	});

	test("as upper of a number is an error", () => {
		expect(value("42 as upper").type).toBe(ValueType.Error);
	});
});

describe("the text package is removable", () => {
	test("without it, `length of` is no longer a measuring clause", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-text") });
		// With no text package, nothing fuses `length of`, so the phrase is not a
		// measuring clause: it fails to parse or reads `length` as an ordinary
		// (undefined) word. Either way it does not answer 5.
		let measured = false;
		try {
			measured = slim.evaluateLine(1, 'length of "hello"').toNumber() === 5;
		} catch {
			measured = false;
		}
		expect(measured).toBe(false);
	});
});
