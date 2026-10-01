import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import type { Parser } from "@solve-js/parser/Parser";
import { constantParselet, inlineConstantValue } from "@solve-js/packages/constants/parselets/ConstantParselet";
import { MULTIPLIED_CONSTANTS, constantMultiplyNormalizerRule } from "@solve-js/packages/constants/normalizer/ConstantMultiplyNormalizerRule";
import { CONSTANTS, constantEntry } from "@solve-js/packages/constants/Constants";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `tau`, `phi` and `golden ratio` inside `solve(...)` were refused
 * with "solve's expression must be synchronous (no weather/stocks/currency
 * calls)", while `pi` and `e` worked, and `solve(x^2 = 2tau, x)` was a parse
 * error.
 *
 * Two causes. The constants package read every constant through its
 * `constantValue` plugin, and a held expression (the expression of `solve`,
 * `der` or `integral`, a function body, a map transform) refuses any plugin
 * call, since a plugin may answer from live data. A mathematical constant has
 * no unit, so it is now pushed as its number, the way `pi` is, and is a plain
 * value wherever an expression is held. And the implicit multiplication that
 * reads `2pi` as `2 * pi` knew only `pi` and `e`; the constants package now
 * reads `2tau`, `2 phi` and `3 golden ratio` the same way.
 */

/** A line's answer, or `THROWS <message>`. */
function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** A document line's answer, or `THREW: <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "THREW: no line";
	if (line.error) return `THREW: ${line.error}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

/** Each line of a document, through both passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** A bare token of `type`, for driving a normaliser rule by hand. */
function token(type: string, text: string, offset = 0): Token {
	return new LexerToken(type, tokenTypeId(type), text, text, offset, text.length, 1, offset + 1);
}

describe("the lines that exposed it", () => {
	test("tau, phi and golden ratio inside solve are values, as pi is", () => {
		expect(shown("solve(x^2 = tau, x)")).toBe("[-2.51, 2.51]");
		expect(shown("solve(x^2 = phi, x)")).toBe("[-1.27, 1.27]");
		expect(shown("solve(x^2 = golden ratio, x)")).toBe("[-1.27, 1.27]");
		expect(shown("solve(x^2 = 2pi, x)")).toBe("[-2.51, 2.51]");
	});

	test("an amount written against tau multiplies it, as 2pi does", () => {
		expect(shown("solve(x^2 = 2tau, x)")).toBe("[-3.54, 3.54]");
		expect(shown("solve(x^2 = 2 tau, x)")).toBe(shown("solve(x^2 = 2*tau, x)"));
		expect(shown("2tau")).toBe("12.57");
		expect(shown("2pi")).toBe("6.28");
		expect(shown("2phi")).toBe("3.24");
		expect(shown("2 golden ratio")).toBe("3.24");
		expect(shown("(1+1)tau")).toBe("12.57");
		expect(shown("sqrt(2)tau")).toBe("8.89");
	});

	test("phi's defining equation has phi as its root", () => {
		// x^2 = x + 1 is the golden ratio's own equation; its positive root is phi.
		const roots = newTrackedEngine().evaluateExpression("solve(x^2 = x + 1, x)");
		expect(formatValue(roots)).toBe("= [0.5-0.5*sqrt(5), 0.5+0.5*sqrt(5)]");
		expect(shown("solve(x^2 = phi + 1, x)")).toBe("[-1.62, 1.62]");
	});

	test("the other held expressions take the constants too", () => {
		expect(shown("der(tau*x^2, x)")).toBe("12.5663706144x");
		expect(shown("integral(x*phi, x, 0, 1)")).toBe("0.8090169944");
		expect(both(["f(x) = x * tau", "f(2)"])).toEqual(["f(x) defined", "12.57"]);
	});

	test("a constant with a unit is unchanged, still read through the plugin", () => {
		expect(shown("gravity")).toBe("9.81 m/s²");
		expect(shown("speed of light")).toBe("299,792,458.00 m/s");
		expect(shown("planck * 2")).toBe("1.33e-33");
		expect(shown("tau")).toBe("6.28");
	});

	test("through the three entry points", () => {
		expect(formatValue(newTrackedEngine().evaluateLine(1, "solve(x^2 = tau, x)"))).toBe("= [-2.51, 2.51]");
		expect(both(["x^2 = tau", "x =>"])).toEqual(['x stored as an equation: solve with "x =>"', "[-2.51, 2.51]"]);
		expect(both(["x^2 = 2tau", "x =>"])[1]).toBe("[-3.54, 3.54]");
		expect(both(["r = golden ratio", "x^2 = r", "x =>"])).toEqual(["1.62", 'x stored as an equation: solve with "x =>"', "[-1.27, 1.27]"]);
	});
});

describe("the parts: inlineConstantValue", () => {
	test("ordinary: a mathematical constant is its number", () => {
		expect(inlineConstantValue("tau")).toBe(2 * Math.PI);
		expect(inlineConstantValue("phi")).toBe((1 + Math.sqrt(5)) / 2);
		expect(inlineConstantValue("golden ratio")).toBe(inlineConstantValue("phi"));
	});

	test("boundary: a constant with a unit, or one marked with the unit it is in, needs the plugin", () => {
		expect(inlineConstantValue("gravity")).toBeNull();
		expect(inlineConstantValue("speed of light")).toBeNull();
		expect(inlineConstantValue("planck")).toBeNull();
		expect(inlineConstantValue("avogadro")).toBeNull();
		// Every unitless, unmarked entry of the table is inlined, and nothing else.
		const inlined = Object.keys(CONSTANTS).filter((name) => inlineConstantValue(name) !== null).sort();
		expect(inlined).toEqual(["golden ratio", "phi", "tau"]);
	});

	test("hostile: a name the table does not have, prototype words included", () => {
		// The table is a plain object, so `constructor` used to find Object's own
		// function and read it as a constant whose value was undefined.
		expect(constantEntry("constructor")).toBeNull();
		expect(constantEntry("TAU")).toEqual({ value: 2 * Math.PI });
		expect(inlineConstantValue("")).toBeNull();
		expect(inlineConstantValue("pie")).toBeNull();
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(inlineConstantValue(word)).toBeNull();
		});
	});
});

describe("the parts: constantParselet", () => {
	/** The program a constant compiles to. */
	function compiled(name: string): ReturnType<BytecodeBuilder["build"]> {
		const builder = new BytecodeBuilder(new Map([["constantValue", 0]]));
		constantParselet(name).parse({} as Parser, token("TAU", name), builder);
		return builder.build();
	}

	test("ordinary: tau is a pushed number, with no plugin call to hold it back", () => {
		const program = compiled("tau");
		expect(program.hasAsync).toBe(false);
		expect(program.opcodes[0]).toBe(OpCode.PUSH_NUMBER);
		expect(Array.from(program.numbers)).toEqual([2 * Math.PI]);
		expect(program.pluginCalls).toBeUndefined();
	});

	test("boundary: gravity still calls the plugin, which attaches its unit, as a call that never waits", () => {
		const program = compiled("gravity");
		// The call is synchronous (FoundBug_unitConstantInAHeldExpression.spec.ts),
		// so it no longer marks the program as one that may wait for data.
		expect(program.hasAsync).toBe(false);
		expect(program.pluginCalls?.names).toEqual(["constantValue"]);
		expect(program.strings).toEqual(["gravity"]);
	});

	test("hostile: an unknown name goes to the plugin, which refuses it by name", () => {
		const program = compiled("constructor");
		expect(program.pluginCalls?.names).toEqual(["constantValue"]);
	});
});

describe("the parts: constantMultiplyNormalizerRule", () => {
	const rule = constantMultiplyNormalizerRule();

	test("ordinary: a number then tau gains a star between them", () => {
		const tokens = [token("NUMBER", "2"), token("TAU", "tau", 1)];
		const match = rule.match(tokens, 0);
		expect(match?.consumed).toBe(1);
		expect(match?.replacement.map((t) => t.type)).toEqual(["NUMBER", "STAR"]);
		expect(match?.replacement[1].offset).toBe(1);
	});

	test("boundary: a closing bracket counts, and each of the three constants is read", () => {
		for (const type of MULTIPLIED_CONSTANTS) {
			expect(rule.match([token("RPAREN", ")"), token(type, "c", 1)], 0)?.replacement.map((t) => t.type)).toEqual(["RPAREN", "STAR"]);
		}
		expect([...MULTIPLIED_CONSTANTS].sort()).toEqual(["GOLDEN_RATIO", "PHI", "TAU"]);
	});

	test("hostile: a physical constant, a name, the end of the line and a position past it are left alone", () => {
		expect(rule.match([token("NUMBER", "2"), token("GRAVITY", "gravity", 2)], 0)).toBeNull();
		expect(rule.match([token("NUMBER", "2"), token("IDENT", "x", 2)], 0)).toBeNull();
		expect(rule.match([token("NUMBER", "2")], 0)).toBeNull();
		expect(rule.match([], 0)).toBeNull();
		expect(rule.match([token("TAU", "tau"), token("TAU", "tau", 4)], 0)).toBeNull();
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`solve(${word}^2 = tau, ${word})`, `solve(x^2 = tau * ${word}, x)`, `2tau ${word}`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a long run of constants and a deep bracket around one are answered in time", () => {
		expectHonestLine(Array.from({ length: 2_000 }, () => "2tau").join(" + "), { budgetMs: 5_000 });
		expectHonestLine(`solve(x^2 = ${"(".repeat(200)}tau${")".repeat(200)}, x)`, { budgetMs: 5_000 });
		expectHonestLine(RESOURCE_PROBES.longSum(2_000).replace(/^0/, "tau"), { budgetMs: 5_000 });
	});

	test("a look-alike of tau is a name, never the constant", () => {
		// Greek τ and a Cyrillic а inside the word.
		expect(shown("solve(x^2 = τ, x)")).not.toBe("[-2.51, 2.51]");
		expect(shown("tаu")).not.toBe("6.28");
		expectHonestLine("solve(x^2 = tаu, x)");
	});

	test.each(fill("2tau X", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after 2tau: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text around the constant is read as text", () => {
		expectHonestLine("<b>solve(x^2 = tau, x)</b>");
		expectHonestLine("2tau<script>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo of the constant is an unknown, never tau", () => {
		expect(shown("solve(x^2 = taux, x)")).toMatch(/^Cannot solve this equation/);
	});

	test("a constant with a unit inside solve is refused by name, not answered", () => {
		expectHonestLine("solve(x * 1 kg = gravity, x)");
	});

	// Found while fixing this, and fixed since: a physical constant reaches its
	// value through the plugin, and that call is now synchronous, so a function
	// body takes it (FoundBug_unitConstantInAHeldExpression.spec.ts).
	test("gravity inside a function body is a value, not refused as live data", () => {
		expect(shown("f(m) = m * gravity")).toBe("f(m) defined");
	});

	test("the constant from the line above, a check and a what-if through it", () => {
		expect(both(["r = 2tau", "x^2 = r", "x =>"])[2]).toBe("[-3.54, 3.54]");
		expectHonestDocument("r = tau\nx^2 = r\nx =>\ncheck sqrt(r) > 2.5");
		expectHonestDocument("r = phi\ny = r^2\nline 2 with r = tau");
	});

	test("2tau beside a percent word and a unit", () => {
		expect(shown("2tau km")).toBe("12.57 km");
		expectHonestLine("3 tau percent");
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("solve(x^2 = (X) * tau, x)", NUMERIC_EDGES))("a numeric edge times tau: %s", (line) => {
		expectHonestLine(line, { budgetMs: 5_000, allowNaN: line.includes("0/0") });
	});

	test.each(fill("X tau", NUMERIC_EDGES.filter((n) => /^[0-9.e-]+$/.test(n))))("a literal written against tau: %s", (line) => {
		expectHonestLine(line, { budgetMs: 5_000 });
	});

	test("zero and negative zero before tau, and a negative", () => {
		expect(shown("0tau")).toBe("0");
		expect(shown("-2tau")).toBe("-12.57");
		expect(shown("solve(x^2 = 0tau, x)")).toBe("0");
	});

	test("a CRLF line and a trailing newline through both passes", () => {
		expect(both(["x^2 = 2tau\r", "x =>\r", ""])[1]).toBe("[-3.54, 3.54]");
	});
});
