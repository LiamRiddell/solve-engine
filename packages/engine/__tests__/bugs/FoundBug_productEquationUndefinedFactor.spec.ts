import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, NUMERIC_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { undefinedFactorMessage } from "@solve-js/engine/SeveralUnknowns";
import { createVM } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { createScratchVM } from "@solve-js/vm/ScratchVM";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `a*x = b`, then `x =>`, with `a` given no value, answered
 * `Cannot solve for "x": "a" is not yet defined.` That is true, and it stopped
 * there. A product of names is stored as an equation on sight and solved by
 * multiplying out the factors' values, which is how a matrix system is solved,
 * so a factor with no value leaves nothing to multiply.
 *
 * The solving-equations page promises the arrow for an equation with one
 * unknown, and refuses one with several by name, pointing at `solve`; it does
 * not promise that `x =>` derives a formula in the others. So the fallback to
 * `b/a` is not the documented behaviour, and the fix is the message: it now
 * names both ways forward, a value for the factor above or `solve(a*x = b, x)`
 * (`undefinedFactorMessage`), quoting the equation as it was typed, which the
 * stored equation now keeps (`EquationDef.text`).
 */

const HINT = 'Cannot solve for "x": "a" is not yet defined. Give "a" a value on a line above, or solve for "x" in terms of it with solve(a*x = b, x).';

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

const STORED = 'x stored as an equation: solve with "x =>"';

describe("the lines that exposed it", () => {
	test("the arrow names the missing factor and the solve that answers", () => {
		expect(both(["a*x = b", "x =>"])).toEqual([STORED, HINT]);
	});

	test("the solve it names gives the formula", () => {
		expect(shown("solve(a*x = b, x)")).toBe("b/a");
		expect(both(["a*x = b", "x =>", "solve(a*x = b, x)"])[2]).toBe("b/a");
	});

	test("the equation is quoted as it was typed, spaces and all", () => {
		expect(both(["a * x = b + 1", "x =>"])[1]).toBe('Cannot solve for "x": "a" is not yet defined. Give "a" a value on a line above, or solve for "x" in terms of it with solve(a * x = b + 1, x).');
		expect(both(["a*b*x = c", "x =>"])[1]).toBe('Cannot solve for "x": "a" is not yet defined. Give "a" a value on a line above, or solve for "x" in terms of it with solve(a*b*x = c, x).');
	});

	test("a factor with a value answers as it did, scalar and matrix", () => {
		expect(both([":a = 2", "a*n = 10", "n =>"])).toEqual(["2", 'n stored as an equation: solve with "n =>"', "5"]);
		expect(both(["a = [1, 2; 3, 4]", "a*x = [60; 70]", "x =>"])[2]).toBe("[-50.00; 55.00]");
		expect(both(["a = 4", "a*x = b", "x =>"])[2]).toBe("b/4");
	});

	test("the first factor missing is the one named, when the factors before it are matrices", () => {
		expect(both(["a = [2, 0; 0, 2]", "a*b*x = [10; 10]", "x =>"])[2]).toMatch(/^Cannot solve for "x": "b" is not yet defined\./);
	});

	test("the boundary: a number as the first factor makes it the scalar equation, which keeps the rest as unknowns", () => {
		// A plain-number factor is not a matrix, so the product is solved as the
		// scalar equation it also is, as before this fix.
		expect(both([":a = 2", "a*b*x = 10", "x =>"])[2]).toBe("10/(2b)");
	});
});

describe("the parts: undefinedFactorMessage", () => {
	test("ordinary: the factor, the unknown and the solve", () => {
		expect(undefinedFactorMessage("x", "a", "a*x = b")).toBe(HINT);
	});

	test("boundary: no text, an empty text or a blank one names the factor alone", () => {
		const alone = 'Cannot solve for "x": "a" is not yet defined. Give "a" a value on a line above.';
		expect(undefinedFactorMessage("x", "a", undefined)).toBe(alone);
		expect(undefinedFactorMessage("x", "a", "")).toBe(alone);
		expect(undefinedFactorMessage("x", "a", "   ")).toBe(alone);
	});

	test("hostile: prototype words and markup are quoted as text", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(undefinedFactorMessage("x", word, `${word}*x = 1`)).toContain(`"${word}" is not yet defined`);
		}
		expect(undefinedFactorMessage("x", "<b>", "<b>*x = 1")).toContain("solve(<b>*x = 1, x)");
	});
});

describe("the parts: a stored equation keeps its text", () => {
	const program = new BytecodeBuilder().build();

	test("the VM keeps the text given, and none when none is given", () => {
		const vm = createVM(sharedOpRegistry);
		vm.defineEquation("x", ["a"], program, "a*x = b");
		expect(vm.getEquation("x")?.text).toBe("a*x = b");
		vm.defineEquation("y", ["a"], program);
		expect(vm.getEquation("y")).not.toHaveProperty("text");
	});

	test("a scratch VM keeps it the same way", () => {
		const scratch = createScratchVM(createVM(sharedOpRegistry));
		scratch.defineEquation("x", ["a"], program, "a*x = b");
		expect(scratch.getEquation("x")?.text).toBe("a*x = b");
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`${word}*x = 10\nx =>`, `a*${word} = 10\n${word} =>`]))("%j", (text) => {
		expectPrototypeUntouched(() => {
			expectHonestDocument(text);
		});
	});

	test("a prototype word as the factor is named, and the solve answers", () => {
		expect(both(["constructor*x = 10", "x =>"])[1]).toMatch(/"constructor" is not yet defined.*solve\(constructor\*x = 10, x\)/);
		expect(shown("solve(constructor*x = 10, x)")).toBe("10/constructor");
	});

	test("a long chain of missing factors is refused in time, naming the first", () => {
		const chain = `${Array.from({ length: 150 }, (_, i) => `f${i}`).join("*")}*x = 5`;
		const started = Date.now();
		const answers = both([chain, "x =>"]);
		expect(Date.now() - started).toBeLessThan(10_000);
		expect(answers[1]).toMatch(/^Cannot solve for "x": "f0" is not yet defined\./);
	});

	test("a look-alike factor is its own name, quoted as typed", () => {
		// A Cyrillic а in place of the Latin a.
		expect(both(["а*x = b", "x =>"])[1]).toMatch(/^Cannot solve for "x": "а" is not yet defined\..*solve\(а\*x = b, x\)/);
	});

	test("markup-shaped text in the equation is read as text", () => {
		expectHonestDocument("a*x = <b>1</b>\nx =>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("an edit that gives the factor a value solves the line below", () => {
		expect(both(["a*x = 10", "x =>"])[1]).toMatch(/^Cannot solve for "x": "a" is not yet defined\./);
		expect(both(["a = 4", "a*x = 10", "x =>"])[2]).toBe("2.5");
	});

	test("a factor defined below the equation but above the arrow is read", () => {
		expect(both(["a*x = 10", "a = 5", "x =>"])[2]).toBe("2");
	});

	test("a check and a what-if over the refused line stay honest", () => {
		expectHonestDocument("a*x = 10\nx =>\ncheck line 2 == 2");
		expectHonestDocument("a*x = 10\nx =>\nline 2 with a = 5");
	});

	test("a typo in the factor's name is named as written", () => {
		expect(both(["rate = 2", "rte*x = 10", "x =>"])[2]).toMatch(/^Cannot solve for "x": "rte" is not yet defined\./);
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("a*x = X\nx =>", NUMERIC_EDGES))("a numeric edge on the right: %j", (text) => {
		expectHonestDocument(text, { allowNaN: text.includes("0/0") });
		const [, answer] = both(text.split("\n"));
		expect(answer).toMatch(/^Cannot solve for "x": "a" is not yet defined\./);
	});

	test.each(fill("a = X\na*x = 10\nx =>", NUMERIC_EDGES))("a numeric edge as the factor: %j", (text) => {
		expectHonestDocument(text, { allowNaN: text.includes("0/0") });
	});

	test("CRLF and a trailing newline change nothing", () => {
		expect(both(["a*x = b\r", "x =>\r", ""])[1]).toBe(HINT);
	});

	test("the single-expression path has no stored equation, and says what the arrow alone means", () => {
		expect(shown("x =>")).toBe("x");
		expectHonestLine("a*x = b");
	});
});
