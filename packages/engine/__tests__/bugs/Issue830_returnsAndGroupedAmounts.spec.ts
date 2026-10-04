import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { currencySignBefore, groupsCurrencyInCall } from "@solve-js/lexer/CurrencyGrouping";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #830: the return forms answered in two kinds (`$1,000 invested $1,500
 * returned` and `compoundInterestRate(...)` a bare fraction, `annual return
 * on` a percentage), and a thousands comma inside a call split the argument,
 * so `compoundInterest($1,000, 5%, 3)` was a call with four arguments. Every
 * return form now answers a percentage, and a comma inside a call or a list
 * that groups the thousands of an amount with a currency sign is read as the
 * grouping.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function typeOf(line: string): ValueType {
	return newTrackedEngine().evaluateExpression(line).type;
}

describe("every return form answers a percentage", () => {
	test.each([
		["$1,000 invested $1,500 returned", "50.00%"],
		["$500 invested $1,500 returned", "200.00%"],
		["$500 invested $500 returned", "0.00%"],
		["$500 invested $250 returned", "-50.00%"],
		["compoundInterestRate($1,000, $1,500, 3)", "14.47%"],
		["compoundInterestRate(1000, 1225.043, 3)", "7.00%"],
		["annual return on $1,000 invested $1,500 returned after 3 years", "14.47%"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
		expect(typeOf(line)).toBe(ValueType.Percentage);
	});

	test("the compound rate and the annual return agree", () => {
		expect(show("compoundInterestRate($1,000, $2,500, 7)")).toBe(show("annual return on $1,000 invested $2,500 returned after 7 years"));
	});

	test("a return still composes as the fraction it is", () => {
		expect(show("($1,000 invested $1,500 returned) * $1,000")).toBe("$500.00");
		expect(show("compoundInterest($1,000, compoundInterestRate($1,000, $1,500, 3), 3)")).toBe("$1,500.00");
		expect(show("($500 invested $1,500 returned) as multiplier")).toBe("3x");
	});

	test("nothing invested is refused as before", () => {
		expect(show("$0 invested $1,500 returned")).toBe("roi: nothing was invested, so there is no return on it");
	});
});

describe("a thousands comma in an amount of money inside a call or a list", () => {
	test.each([
		["compoundInterest($1,000, 5%, 3)", "$1,157.63"],
		["compoundInterest(£1,000, 5%, 3)", "£1,157.63"],
		["compoundInterest(€1,000,000, 5%, 3)", "€1,157,625.00"],
		["compoundInterestRate($1,000, $1,500, 3)", "14.47%"],
		["max($1,000, $2)", "$1,000.00"],
		["max($1,000, 2)", "$1,000.00"],
		["max($1,000.50, $2)", "$1,000.50"],
		["max($2,$1,000)", "$1,000.00"],
		["min(-$1,000, $5)", "-$1,000.00"],
		["max($-1,000, $5)", "$5.00"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("the same amount reads the same inside a call and outside one", () => {
		expect(show("abs($1,000)")).toBe(show("$1,000"));
		expect(show("round($1,234.567, 2)")).toBe("$1,234.57");
	});

	test("the ambiguity, named: a currency amount and three digits with no space is one amount", () => {
		expect(show("max($1,234)")).toBe("$1,234.00");
	});

	test("the boundary: a plain number's comma stays a separator", () => {
		expect(show("max(1,000, 2)")).toBe("2");
		expect(show("rgb(255,255,255)")).toBe("rgb(255, 255, 255)");
		expect(show("[100,200,300]")).toBe("[100, 200, 300]");
		expect(show("(1,000)")).toBe("1,000");
	});

	test("the boundary: a comma that is not a group of three stays a separator", () => {
		expect(show("max($1,5)")).toBe(show("max($1, 5)"));
		expect(show("max($1,2345)")).toBe(show("max($1, 2345)"));
		expect(show("max($1,000,5)")).toBe(show("max($1000, 5)"));
		// A space after the comma is always a separator.
		expect(show("max($1, 234)")).toBe(show("max(234, $1)"));
	});
});

describe("the parts", () => {
	test("currencySignBefore: each sign, a minus between, and nothing else", () => {
		for (const sign of ["$", "£", "€", "¥", "₽", "₩", "₹", "₺", "₴", "₪", "₫", "₦", "₱"]) {
			expect(currencySignBefore(`${sign}1,000`, 1)).toBe(true);
			expect(currencySignBefore(`${sign}-1,000`, 2)).toBe(true);
		}
		expect(currencySignBefore("1,000", 0)).toBe(false);
		expect(currencySignBefore("x1,000", 1)).toBe(false);
		expect(currencySignBefore("$ 1,000", 2)).toBe(false);
		expect(currencySignBefore("", 0)).toBe(false);
		expect(currencySignBefore("-1", 1)).toBe(false);
	});

	test("groupsCurrencyInCall: exactly three digits, then an end", () => {
		const at = (text: string): boolean => groupsCurrencyInCall(text, text.indexOf("$") + 1, text.indexOf(",", text.indexOf("$")));
		expect(at("f($1,000)")).toBe(true);
		expect(at("f($1,000, 2)")).toBe(true);
		expect(at("f($1,000.5)")).toBe(true);
		expect(at("f($1,000,000)")).toBe(true);
		expect(at("[$1,000]")).toBe(true);
		expect(at("f($1,000 ")).toBe(true);
		expect(at("$1,000")).toBe(true);
		expect(at("f($1,00)")).toBe(false);
		expect(at("f($1,0000)")).toBe(false);
		expect(at("f($1, 000)")).toBe(false);
		expect(at("f($1,000x)")).toBe(false);
		expect(at("f($1,5)")).toBe(false);
		expect(groupsCurrencyInCall("f(1,000)", 2, 3)).toBe(false);
		expect(groupsCurrencyInCall("f($1.000)", 3, 4)).toBe(false);
		expect(groupsCurrencyInCall("", 0, 0)).toBe(false);
	});
});

describe("adversarial", () => {
	test("security: prototype words beside the forms", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				for (const line of [`compoundInterest($1,000, ${word}, 3)`, `${word} invested $1,500 returned`, `$1,000 invested ${word} returned`, `${word}($1,000, 2)`]) {
					expectHonestLine(line);
				}
			}
		});
	});

	test("security: a long list of grouped amounts, and deep brackets around one", () => {
		const many = Array.from({ length: 100 }, () => "$1,000").join(", ");
		expect(show(`max(${many})`)).toBe("$1,000.00");
		expectHonestLine(`max(${many})`, { budgetMs: 5_000 });
		expectHonestLine(`abs(${RESOURCE_PROBES.deepParens(500).replace("1", "$1,000")})`);
		expectHonestLine(`max($${"1,000".repeat(2_000)})`, { budgetMs: 5_000 });
	});

	test("security: look-alike characters are not a currency sign or a digit", () => {
		// A full-width dollar sign and full-width digits are not the grouping.
		for (const line of ["max(＄1,000, 2)", "max($１,000, 2)", "max($1,０00, 2)", "max($1​,000, 2)"]) {
			expectHonestLine(line);
		}
		for (const text of TEXT_EDGES.filter((t) => t.trim() !== "")) {
			expectHonestLine(`max($1,000, ${JSON.stringify(text)})`);
		}
	});

	test("realistic: amounts from the line above, a what-if, and both passes", () => {
		const text = "principal = $1,000\nrate = 5%\ncompoundInterest(principal, rate, 3)\ncompoundInterest($1,000, rate, 3)\n$1,000 invested line 4 returned\nline 4 with rate = 10%";
		expectHonestDocument(text);
		const lines = newTrackedEngine().parseDocument(text).lines.map((l) => (l.result ? formatValue(l.result).replace(/^=\s*/, "") : l.error));
		expect(lines).toEqual(["$1,000.00", "5.00%", "$1,157.63", "$1,157.63", "15.76%", "$1,331.00"]);
	});

	test("edge cases: the numeric corpus through each form", () => {
		const lines = [
			...fill("compoundInterest($1,000, X, 3)", NUMERIC_EDGES),
			...fill("$1,000 invested X returned", NUMERIC_EDGES),
			...fill("compoundInterestRate($1,000, X, 3)", NUMERIC_EDGES),
		];
		for (const line of lines) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		expect(show("compoundInterest($0,000, 5%, 3)")).toBe(show("compoundInterest($0, 5%, 3)"));
	});
});
