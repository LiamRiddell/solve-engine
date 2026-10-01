import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { isTopLevel, nameList, namesSomething, severalUnknownsRefusal, typedText } from "@solve-js/engine/SeveralUnknowns";
import type { Token } from "@solve-js/lexer/Token";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a Calca-style equation with several single-word unknowns gave a
 * parse error that said nothing about why. `(salary / 12) * rate / 100 = net`
 * answered `Expected an operator or the end of the line, but found "="`, and
 * `rate =>` on the next line then answered `rate`.
 *
 * An equation line is stored under its one unknown, the one name in it with no
 * value, and `x =>` solves it; with two or more there is no telling which a
 * later `x =>` means, so the solving-equations page says it is not stored. The
 * line fell through to the ordinary parse, which stops at the `=`. It is now
 * refused by name, saying how an equation line is read and the two ways to
 * write this one (`severalUnknownsRefusal`): values for the others above it,
 * or `solve(..., name)`.
 *
 * Refusal is the smaller honest change, and it was chosen over storing the
 * equation under every unknown: that would turn every `a + b = c` line, a
 * parse error today, into a stored equation, and would answer the Calca line
 * with the algebra's unsimplified `net/(1/1200salary)`, not the
 * `1200net/salary` Calca documents.
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

/** The lexer's tokens for a line. */
function tokensOf(line: string): Token[] {
	const lexer = new ExpressionLexer();
	lexer.reset(line);
	return lexer.tokenizeAll().filter((t) => t.type !== "EOF");
}

const CALCA = "(salary / 12) * rate / 100 = net";
const CALCA_REFUSAL =
	"This equation has 3 unknowns, salary, rate and net, and an equation on a line of its own is solved for its one unknown. Give the others values on the lines above it, or name the one to solve for, as in solve((salary / 12) * rate / 100 = net, salary).";

describe("the lines that exposed it", () => {
	test("the reported line is refused by name, through every path", () => {
		expect(shown(CALCA)).toBe(`THROWS ${CALCA_REFUSAL}`);
		expect(both([CALCA, "rate =>"])).toEqual([`THREW: ${CALCA_REFUSAL}`, "rate"]);
	});

	test("the refusal carries its code and the solve it suggests", () => {
		let caught: { code?: string; suggestion?: string } = {};
		try {
			newTrackedEngine().evaluateExpression(CALCA);
		} catch (e) {
			caught = e as { code: string; suggestion: string };
		}
		expect({ code: caught.code, suggestion: caught.suggestion }).toEqual({
			code: "EQUATION_SEVERAL_UNKNOWNS",
			suggestion: "solve((salary / 12) * rate / 100 = net, salary)",
		});
	});

	test("the two ways the refusal offers both answer", () => {
		expect(both(["salary = 60000", "net = 1000", CALCA, "rate =>"])).toEqual(["60,000", "1,000", 'rate stored as an equation: solve with "rate =>"', "20"]);
		expect(shown("solve((salary / 12) * rate / 100 = net, rate)")).toBe("net/(1/1200salary)");
	});

	test.each([
		["x + y = 10", "x and y", "x + y = 10", "x"],
		["x * 2 = y", "x and y", "x * 2 = y", "x"],
		["2 * x = y", "x and y", "2 * x = y", "x"],
		["x plus y = 10", "x and y", "x plus y = 10", "x"],
		["a + c = f", "a, c and f", "a + c = f", "a"],
	])("%s is refused naming its unknowns", (line, names, equation, first) => {
		const count = names.split(/, | and /).length;
		expect(shown(line)).toBe(
			`THROWS This equation has ${count} unknowns, ${names}, and an equation on a line of its own is solved for its one unknown. Give the others values on the lines above it, or name the one to solve for, as in solve(${equation}, ${first}).`,
		);
	});

	test("an equation with one unknown is stored and solved as before", () => {
		expect(both(["y = 3", "x + y = 10", "x =>"])).toEqual(["3", 'x stored as an equation: solve with "x =>"', "7"]);
		expect(both(["2x + 1 = x + 4", "x =>"])).toEqual(['x stored as an equation: solve with "x =>"', "3"]);
	});

	test("the shapes that own their = are unchanged", () => {
		expect(both(["a*b*c = 10", "f(x) = x + y", "x = y + z"])).toEqual(['c stored as an equation: solve with "c =>"', "f(x) defined", "y+z"]);
		expect(shown("solve(x + y = 10, x)")).toBe("-y+10");
	});
});

describe("the parts: SeveralUnknowns", () => {
	test("namesSomething: an identifier, and a unit word with no amount before it", () => {
		const tokens = tokensOf("2 km + x + b = 5 km");
		const names = tokens.map((t, i) => (namesSomething(tokens, i) ? t.text : null)).filter((t) => t !== null);
		expect(names).toEqual(["x", "b"]);
		expect(namesSomething(tokensOf("(1 + 2) kg"), 5)).toBe(false);
		expect(namesSomething(tokens, -1)).toBe(false);
		expect(namesSomething(tokens, 99)).toBe(false);
		expect(namesSomething([], 0)).toBe(false);
	});

	test("isTopLevel: outside every bracket, and inside one", () => {
		const tokens = tokensOf("(a = b) = c");
		expect(isTopLevel(tokens, 2)).toBe(false);
		expect(isTopLevel(tokens, 5)).toBe(true);
		expect(isTopLevel(tokensOf("[a, (b] = c"), 6)).toBe(false);
		expect(isTopLevel([], 0)).toBe(true);
		expect(isTopLevel(tokensOf("a = b"), 99)).toBe(true);
	});

	test("typedText: the spaces the reader typed, and none they did not", () => {
		expect(typedText(tokensOf("(salary / 12) * rate"))).toBe("(salary / 12) * rate");
		expect(typedText(tokensOf("(a+b)*c"))).toBe("(a+b)*c");
		expect(typedText(tokensOf("a   +   b"))).toBe("a + b");
		expect(typedText([])).toBe("");
	});

	test("nameList: one, two, several and more than are named", () => {
		expect(nameList([])).toBe("");
		expect(nameList(["a"])).toBe("a");
		expect(nameList(["a", "b"])).toBe("a and b");
		expect(nameList(["a", "b", "c"])).toBe("a, b and c");
		expect(nameList(["a", "b", "c", "d", "e", "f"])).toBe("a, b, c, d, e and f");
		expect(nameList(["a", "b", "c", "d", "e", "f", "g", "h"])).toBe("a, b, c, d, e, f and 2 more");
	});

	test("severalUnknownsRefusal: the message, the code and the names it carries", () => {
		const error = severalUnknownsRefusal(["x", "y"], tokensOf("x + y = 10"));
		expect(error.code).toBe("EQUATION_SEVERAL_UNKNOWNS");
		expect(error.message).toBe(
			"This equation has 2 unknowns, x and y, and an equation on a line of its own is solved for its one unknown. Give the others values on the lines above it, or name the one to solve for, as in solve(x + y = 10, x).",
		);
		expect(error.context).toEqual({ unknowns: ["x", "y"] });
	});

	test("severalUnknownsRefusal: a prototype word is an ordinary name", () => {
		const error = severalUnknownsRefusal(["constructor", "__proto__"], tokensOf("constructor + __proto__ = 1"));
		expect(error.message).toMatch(/^This equation has 2 unknowns, constructor and __proto__,/);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a prototype word as one of the unknowns: %s", (word) => {
		expectPrototypeUntouched(() => {
			expect(shown(`${word} + y = 10`)).toMatch(/^THROWS This equation has 2 unknowns/);
			expectHonestDocument(`${word} + y = 10\n${word} =>`);
		});
	});

	test("a long equation of unknowns is refused in time, its names summarised", () => {
		const line = `${Array.from({ length: 200 }, (_, i) => `n${i}`).join(" + ")} = 1`;
		const outcome = expectHonestLine(line, { budgetMs: 5_000 });
		expect(outcome.kind).toBe("thrown");
		expect(shown(line)).toMatch(/^THROWS This equation has 200 unknowns, n0, n1, n2, n3, n4, n5 and 194 more,/);
	});

	test("a line past the length limit is refused by that limit first", () => {
		expect(shown(`${Array.from({ length: 2_000 }, (_, i) => `n${i}`).join(" + ")} = 1`)).toMatch(/^THROWS Expression exceeds max length/);
	});

	test("deep brackets around one side stay honest", () => {
		expectHonestLine(`${RESOURCE_PROBES.deepParens(200).replace("1", "a + b")} = c`, { budgetMs: 5_000 });
	});

	test.each(fill("x + yX = 10", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge in the equation: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup in the equation is quoted as text, not acted on", () => {
		expectHonestLine("<b>x</b> + y = 1");
	});
});

describe("adversarial: realistic breakage", () => {
	test("one of the unknowns given a value further down is still refused above it", () => {
		expect(both(["x + y = 10", "y = 3", "x =>"])).toEqual([
			"THREW: This equation has 2 unknowns, x and y, and an equation on a line of its own is solved for its one unknown. Give the others values on the lines above it, or name the one to solve for, as in solve(x + y = 10, x).",
			"3",
			"x",
		]);
	});

	test("a unit beside the unknowns is not counted as one", () => {
		expect(shown("2 km + x = 5 km")).toBe('THROWS Expected an operator or the end of the line, but found "="');
		expect(shown("x km + y = 5")).toMatch(/^THROWS /);
	});

	test("a side that does not parse keeps its own error", () => {
		expect(shown("x + = y")).not.toMatch(/This equation has/);
		expect(shown("I think that the answer = 5")).toBe('THROWS Expected an operator or the end of the line, but found "think"');
	});

	test("a name of several words is not an unknown here", () => {
		expect(both(["hourly rate = $50", "hourly rate + alpha = beta"])[1]).toMatch(/^THREW: This equation has 2 unknowns, alpha and beta,/);
	});

	test("a what-if and a goal seek keep their own =", () => {
		expect(both(["a = 1", "b = a * 2", "line 2 with a = 5"])).toEqual(["1", "2", "10"]);
		expectHonestDocument("x = 1\ny = x * 3\nsolve line 2 for x = 6", { agree: false });
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("x + y = X", NUMERIC_EDGES))("over a numeric edge: %s", (line) => {
		expect(shown(line)).toMatch(/^THROWS This equation has 2 unknowns, x and y,/);
	});

	test("an empty side and a trailing = are not this refusal's", () => {
		expect(shown("x + y =")).not.toMatch(/This equation has/);
		expect(shown("= x + y")).not.toMatch(/This equation has/);
	});

	test("CRLF and padding change nothing", () => {
		expect(both(["  x + y = 10\r", ""])[0]).toMatch(/^THREW: This equation has 2 unknowns, x and y,/);
	});
});
