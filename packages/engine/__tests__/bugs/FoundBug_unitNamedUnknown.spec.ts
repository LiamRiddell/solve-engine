import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { constNode, formatSymbolic, rational, varNode, type SymbolicNode } from "@solve-js/symbolic";
import { juxtaposes, leadsWithUnitName, readsAsAmountWord } from "@solve-js/symbolic/SymbolicFormat";
import { isMagnitudeSuffix } from "@solve-js/packages/arithmetic/normalizer/LargeNumberSuffixNormalizerRule";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: an unknown whose name is also a unit was printed beside its
 * coefficient, `b + b =>` as `2b`, and `2b` typed back is two bits, not two of
 * `b`; `m + m =>` was `2m`, two metres. A name that is also a magnitude word
 * did the same: `k + k =>` was `2k`, which reads back as two thousand, and
 * `million` as two million. The printer joined a number to any name it could
 * stand beside and knew no units.
 *
 * It now asks whether a number written before the name would read it as a
 * unit or a magnitude (`readsAsAmountWord`: the built-in unit table and the
 * magnitude suffixes, `isMagnitudeSuffix`), and writes such a name after a `*`
 * (`2*b`), which reads back as written: a unit word with no number of its own
 * in front of it is a name. Previously documented as a boundary of the
 * formula-display fix; the round trip there now covers unit-named unknowns.
 *
 * That round trip found the same misreading after a slash: `/m` after an
 * amount is "per metre", so `0.5/m` read back as 0.5 per metre and `x/m` was
 * refused. A denominator that opens with a unit name is now bracketed
 * (`0.5/(m)`, `leadsWithUnitName`).
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

const c = (n: number, d = 1): SymbolicNode => constNode(rational(BigInt(n), BigInt(d)));
const mul = (left: SymbolicNode, right: SymbolicNode): SymbolicNode => ({ kind: "mul", left, right });

/** Unit and magnitude names an unknown can have, with what `2<name>` reads as. */
const AMOUNT_NAMES: ReadonlyArray<readonly [string, string]> = [
	["b", "2.00 b"],
	["m", "2.00 m"],
	["k", "2,000"],
	["M", "2,000,000"],
	["km", "2.00 km"],
	["h", "2.00 h"],
	["g", "2.00 g"],
	["t", "2.00 t"],
	["A", "2.00 A"],
	["K", "2.00 K"],
	["px", "2.00 px"],
	["usd", "$2.00"],
	["day", "2 days"],
	["million", "2,000,000"],
	["bn", "2,000,000,000"],
];

describe("the lines that exposed it", () => {
	test("b + b is 2*b, and 1+2+b+3+b is 2*b+6", () => {
		expect(shown("b + b =>")).toBe("2*b");
		expect(shown("1+2+b+3+b =>")).toBe("2*b+6");
		expect(shown("m + m =>")).toBe("2*m");
	});

	test.each(AMOUNT_NAMES)("an unknown named %s takes a *, since 2%s reads as an amount", (name, amount) => {
		expect(shown(`2${name}`)).toBe(amount);
		expect(shown(`${name} + ${name} =>`)).toBe(`2*${name}`);
		// Typed back, the printed formula is itself.
		expect(shown(`2*${name} =>`)).toBe(`2*${name}`);
	});

	test("an ordinary name still stands beside its coefficient", () => {
		expect(shown("x + x =>")).toBe("2x");
		expect(shown("1+2+x+3+x =>")).toBe("2x+6");
		expect(shown("y*3 =>")).toBe("3y");
		expect(shown("c + c =>")).toBe("2c");
	});

	test("every place a coefficient is written: a power, a product, a fraction, a negative", () => {
		expect(shown("2*b^2 =>")).toBe("2*b^2");
		expect(shown("2*b*x =>")).toBe("2*b*x");
		expect(shown("(2/3)*b =>")).toBe("2*b/3");
		expect(shown("-2*b =>")).toBe("-2*b");
		expect(shown("0.5*m =>")).toBe("0.5*m");
		expect(shown("b/3 =>")).toBe("b/3");
	});

	test("a unit-named denominator is bracketed, since /m after an amount is per metre", () => {
		expect(shown("0.5/m")).toBe("0.50 /m");
		expect(shown("0.5/(b) =>")).toBe("0.5/(b)");
		expect(shown("x/(m) =>")).toBe("x/(m)");
		expect(shown("x/(m^2) =>")).toBe("x/(m^2)");
		expect(shown("2/(km) =>")).toBe("2/(km)");
		// A name that is not a unit, and a magnitude word, need no bracket.
		expect(shown("2/x =>")).toBe("2/x");
		expect(shown("x/k =>")).toBe("x/k");
		expect(shown("b/3 =>")).toBe("b/3");
	});

	test("the algebra verbs print the same way", () => {
		expect(shown("der(b^3, b)")).toBe("3*b^2");
		expect(shown("expand((b+1)^2)")).toBe("b^2+2*b+1");
		expect(shown("taylor(exp(k), k=0, 3)")).toBe("k^3/6+0.5*k^2+k+1");
		expect(shown("solve(b*m = 4, m)")).toBe("4/(b)");
	});

	test("through the three entry points", () => {
		expect(formatValue(newTrackedEngine().evaluateLine(1, "b + b =>"))).toBe("2*b");
		expect(both(["y = 2*b + 1", "y =>"])).toEqual(["2*b+1", "2*b+1"]);
		expect(both([":a = 2", "a*b*x = 10", "x =>"])[2]).toBe("10/(2*b)");
		// Given a value, the name is that value, printed or not.
		expect(both(["b = 3", "2*b =>"])).toEqual(["3", "6"]);
	});
});

describe("the parts: readsAsAmountWord", () => {
	test("ordinary: units and magnitudes", () => {
		for (const name of ["b", "m", "km", "kg", "k", "M", "G", "B", "T", "million", "Million", "bn", "thousand"]) {
			expect({ name, reads: readsAsAmountWord(name) }).toEqual({ name, reads: true });
		}
	});

	test("boundary: ordinary names, the empty name and a case the table does not hold", () => {
		for (const name of ["", "x", "y", "c", "salary", "net", "rate", "foo", "kms", "bb"]) {
			expect({ name, reads: readsAsAmountWord(name) }).toEqual({ name, reads: false });
		}
	});

	test("hostile: prototype words, look-alikes and a hundred-thousand-letter name", () => {
		for (const word of PROTOTYPE_WORDS) expect(readsAsAmountWord(word)).toBe(false);
		// Full-width b and a Cyrillic м.
		expect(readsAsAmountWord("ｂ")).toBe(false);
		expect(readsAsAmountWord("м")).toBe(false);
		const started = performance.now();
		expect(readsAsAmountWord("b".repeat(100_000))).toBe(false);
		expect(performance.now() - started).toBeLessThan(1_000);
	});
});

describe("the parts: leadsWithUnitName", () => {
	test("ordinary: a unit name, alone, under a power or before a product", () => {
		for (const text of ["m", "b", "km", "m^2", "kg*x"]) expect({ text, unit: leadsWithUnitName(text) }).toEqual({ text, unit: true });
	});

	test("boundary: an ordinary name, a call, a bracket, a number and the empty text", () => {
		for (const text of ["", "x", "x*m", "sqrt(m)", "(m)", "2m", "-m", "k", "million"]) {
			expect({ text, unit: leadsWithUnitName(text) }).toEqual({ text, unit: false });
		}
	});

	test("hostile: prototype words and a hundred-thousand-letter name are answered in time", () => {
		for (const word of PROTOTYPE_WORDS) expect(leadsWithUnitName(word)).toBe(false);
		const started = performance.now();
		expect(leadsWithUnitName("m".repeat(100_000))).toBe(false);
		expect(performance.now() - started).toBeLessThan(1_000);
	});
});

describe("the parts: isMagnitudeSuffix", () => {
	test("ordinary: the letters as written and the words in any case", () => {
		for (const word of ["k", "M", "G", "B", "T", "thousand", "MILLION", "Billion", "bn", "mn", "tn", "trillions"]) expect(isMagnitudeSuffix(word)).toBe(true);
	});

	test("boundary: the letters are case-sensitive, and the empty word is none", () => {
		for (const word of ["K", "m", "g", "b", "t", "", " k", "kk"]) expect({ word, suffix: isMagnitudeSuffix(word) }).toEqual({ word, suffix: false });
	});

	test("hostile: a prototype word is not a magnitude", () => {
		for (const word of PROTOTYPE_WORDS) expect(isMagnitudeSuffix(word)).toBe(false);
	});
});

describe("the parts: juxtaposes", () => {
	test("ordinary: a name the number can stand beside", () => {
		expect(juxtaposes("2", "x")).toBe(true);
		expect(juxtaposes("2", "(x+1)")).toBe(true);
		expect(juxtaposes("2", "x^2")).toBe(true);
	});

	test("boundary: a unit or magnitude name, whatever follows it", () => {
		expect(juxtaposes("2", "b")).toBe(false);
		expect(juxtaposes("2", "b^2")).toBe(false);
		expect(juxtaposes("2", "km*x")).toBe(false);
		expect(juxtaposes("3", "k")).toBe(false);
		expect(juxtaposes("2", "")).toBe(false);
	});

	test("hostile: a prototype word stands beside a number as any name does", () => {
		for (const word of PROTOTYPE_WORDS) expect(juxtaposes("2", word)).toBe(!/^[neE]/.test(word));
		expect(formatSymbolic(mul(c(2), varNode("constructor")))).toBe("2constructor");
	});
});

describe("the round trip over unit-named unknowns", () => {
	test("each printed formula reads back with the formula's value", () => {
		const engine = newTrackedEngine();
		const names = ["b", "m", "k", "M", "km", "h", "x"];
		for (const name of names) {
			for (const formula of [mul(c(2), varNode(name)), mul(c(-3, 4), varNode(name)), mul(c(5), { kind: "pow", base: varNode(name), exponent: c(2) })]) {
				const text = formatSymbolic(formula);
				const back = engine.evaluateExpression(`${text} =>`);
				expect({ text, back: formatSymbolic(back.value as SymbolicNode) }).toEqual({ text, back: text });
			}
		}
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`${word} + ${word} =>`, `2*${word} + b =>`, `${word} * k =>`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a look-alike of a unit is an ordinary name and stands beside its coefficient", () => {
		// Full-width b.
		expect(shown("ｂ + ｂ =>")).toBe("2ｂ");
	});

	test("a long sum of a unit-named unknown is collected in time", () => {
		const line = `${Array.from({ length: 200 }, () => "b").join(" + ")} =>`;
		expectHonestLine(line, { budgetMs: 5_000 });
		expect(shown(line)).toBe("200*b");
	});

	test.each(fill("b + b => X", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after the arrow: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text around the formula is read as text", () => {
		expectHonestLine("<b>b + b =></b>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a unit a note defines for itself is not known to the printer, the documented boundary", () => {
		expect(both(["1 sprint = 2 weeks", "sprint + sprint =>"])).toEqual(["sprint defined", "2sprint"]);
	});

	test("a printed formula pasted into a later line answers with the values above it", () => {
		expect(both(["y = b + b", "b = 4", "2*b"])).toEqual(["2*b", "4", "8"]);
	});

	test("a check and a what-if over a formula in b", () => {
		expectHonestDocument("b = 2\ny = 3*b\ncheck y == 6\nline 2 with b = 5");
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("(X) * b =>", NUMERIC_EDGES))("a numeric edge as the coefficient of b: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("zero, negative zero, 2^53 and a coefficient of 10^15", () => {
		expect(shown("0*b =>")).toBe("0");
		expect(shown("-0*b =>")).toBe("0");
		expect(shown("2^53*b =>")).toBe("9007199254740992*b");
		expect(shown("1e15*b =>")).toBe("1000000000000000*b");
	});

	test("CRLF and a trailing newline through both passes", () => {
		expect(both(["y = b + b\r", "y =>\r", ""])[1]).toBe("2*b");
	});
});
