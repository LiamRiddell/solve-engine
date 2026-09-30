import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EngineError } from "@solve-js/errors/EngineError";
import { enLocale } from "@solve-js/constants/locales/en";
import { multiplierRefused } from "@solve-js/vm/PlainNumberForms";
import { namesConversionTarget } from "@solve-js/packages/arithmetic/parselets/AddToParselet";
import { readsAsRadians } from "@solve-js/parser/InverseTrigAngle";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import { ValueType, numberValue, stringValue, uomValue, percentageValue, boolValue, matrixValue, datetimeValue, errorValue } from "@solve-js/vm/Value";

/**
 * Issue #829: words read in ways a reader would not guess. `prime`, `exponent`
 * and `mul` were keywords for `^` and `*` (so `2 prime 3` was 8, `7 is prime`
 * failed with a token name, and `:exponent = 2` was refused); `add 3 to 10`
 * was `+3 to 10`, a percentage change of 233.33%; `as multiplier` read text as
 * 0 and dropped a quantity's unit; and `asin(0.5) in degrees` labelled the
 * radians as degrees. The aliases are retired and the words are names,
 * `7 is prime` asks whether 7 is prime, `add A to B` is `A + B`, `as
 * multiplier` refuses what is not a plain number or a percentage, and an
 * inverse trigonometric call converted to an angle unit is read as radians.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text, { inputType: "markdown" }).lines.map((line) =>
		line.error ? `ERROR ${line.error}` : line.result ? formatValue(line.result).replace(/^=\s*/, "") : "");
}

function codeOf(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.type === ValueType.Error ? String(v.errorCode) : `value ${formatValue(v)}`;
	} catch (e) {
		return e instanceof EngineError ? e.code : `raw ${(e as Error).name}`;
	}
}

/** A token of the given type and text, as the lexer makes one. */
function token(type: string, text: string): Token {
	return new LexerToken(type, tokenTypeId(type), text, text, 0, 0, 1, 1);
}

describe("prime, exponent and mul are names, not operators", () => {
	test("the English keyword map no longer claims them", () => {
		for (const word of ["prime", "exponent", "mul"]) {
			expect(Object.prototype.hasOwnProperty.call(enLocale.keywordMap, word)).toBe(false);
		}
	});

	test.each([
		[":exponent = 2\n2 ^ exponent", ["2", "4"]],
		["exponent = 3\n2 ^ exponent", ["3", "8"]],
		[":prime = 7\nprime * 2", ["7", "14"]],
		["mul = 4\nmul * 2", ["4", "8"]],
	])("%j", (text, answers) => {
		expect(doc(text)).toEqual(answers);
	});

	test("the retired operator spellings are not read as operators", () => {
		for (const line of ["2 prime 3", "2 exponent 3", "10 mul 2"]) {
			expect(show(line)).toMatch(/^THROWS /);
			expect(codeOf(line)).not.toMatch(/^raw/);
		}
	});

	test("the operators they spelled keep their other spellings", () => {
		expect(show("2 ^ 3")).toBe("8");
		expect(show("2 to the power of 3")).toBe("8");
		expect(show("10 times 2")).toBe("20");
		expect(show("10 multiply 2")).toBe("20");
	});
});

describe("N is prime asks whether N is prime", () => {
	test.each([
		["7 is prime", "true"],
		["8 is prime", "false"],
		["2 is prime", "true"],
		["1 is prime", "false"],
		["0 is prime", "false"],
		["-7 is prime", "false"],
		["5 + 2 is prime", "true"],
		["2^61 - 1 is prime", "true"],
		["561 is prime", "false"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
		expect(show(line)).toBe(show(`isprime(${line.slice(0, -" is prime".length)})`));
	});

	test("a name holding the number reads the same", () => {
		expect(doc("x = 7\nx is prime")).toEqual(["7", "true"]);
	});

	test("prime in a sentence is not the question, and is refused rather than answered", () => {
		for (const line of ["7 is prime number", "it is prime time", "7 is prime because", "is prime"]) {
			expect(show(line)).toMatch(/^THROWS /);
		}
	});

	test("a number with no whole reading is refused as isprime refuses it", () => {
		expect(show("7.5 is prime")).toBe("isprime works on whole numbers");
	});
});

describe("add A to B is A + B", () => {
	test.each([
		["add 3 to 10", "13"],
		["add 3 to 10 * 2", "23"],
		["add -3 to 10", "7"],
		["add $5 to $10", "$15.00"],
		["add 5 km to 3 m", "5.00 km"],
		["ADD 3 TO 10", "13"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("without a to, add keeps its reading", () => {
		expect(show("add 3 and 4")).toBe("7");
		expect(show("add 3")).toBe("3");
		expect(show("3 add 4")).toBe("7");
	});

	test("a to before a unit is still a conversion", () => {
		expect(show("add 5 to km")).toBe("5.00 km");
		expect(show("add 0.25 to %")).toBe("25.00%");
	});

	test("the symbol forms are unchanged: +3 to 10 is a percentage change", () => {
		expect(show("+3 to 10")).toBe("233.33%");
		expect(show("3 to 10")).toBe("233.33%");
		expect(show("+3")).toBe("3");
	});

	test("a value from the line above", () => {
		expect(doc("x = 3\nadd x to 10")).toEqual(["3", "13"]);
		expect(doc("10\nadd 5 to prev")).toEqual(["10", "15"]);
	});
});

describe("as multiplier takes a plain number or a percentage", () => {
	test.each([
		["0.5 as multiplier", "0.5x"],
		["2 as multiplier", "2x"],
		["50% as multiplier", "1.5x"],
		["-50% as multiplier", "0.5x"],
		["0 as multiplier", "0x"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test.each([
		['"hello" as multiplier', "text"],
		["5 km as multiplier", "a length"],
		["£5 as multiplier", "money"],
		["true as multiplier", "true or false"],
		["[1, 2] as multiplier", "a bracketed list"],
	])("%s is refused, naming %s", (line, kind) => {
		expect(show(line)).toBe(`A multiplier is a plain number or a percentage, as in "0.5 as multiplier" or "50% as multiplier", not ${kind}.`);
		expect(codeOf(line)).toBe("MULTIPLIER_TAKES_NUMBER");
	});

	test("a date keeps the refusal every numeric conversion gives it", () => {
		expect(codeOf("1 Jan 2026 as multiplier")).toBe("INVALID_DATETIME_OP");
	});
});

describe("an inverse trigonometric call converted to an angle is read as radians", () => {
	test.each([
		["asin(0.5) in degrees", "30.00 degrees"],
		["asin(0.5) to degrees", "30.00 degrees"],
		["acos(0) in degrees", "90.00 degrees"],
		["atan(1) in degrees", "45.00 degrees"],
		["atan2(1, 1) in degrees", "45.00 degrees"],
		["arcsin(1) in degrees", "90.00 degrees"],
		["asin(0.5) * 2 in degrees", "60.00 degrees"],
		["asin(0.5) in rad", "0.52 rad"],
		["asin(1) in turns", "0.25 turns"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("it agrees with the degree forms", () => {
		expect(show("asind(0.5)")).toBe("30.00");
		expect(show("radtodeg(asin(0.5))")).toBe("30.00");
	});

	test("what is not an inverse trigonometric call keeps the ordinary reading", () => {
		expect(show("0.5 in degrees")).toBe("0.50 degrees");
		expect(show("asin(0.5)")).toBe("0.52");
		// The call alone is an angle whatever the target, so a unit that is not
		// an angle is refused rather than given to it (FoundBug_subtractFromAndAngleTargets).
		expect(show("asin(0.5) in km")).toBe("an angle cannot be converted to a length");
		// A name holding the answer is a plain number: the boundary.
		expect(doc("a = asin(0.5)\na in degrees")).toEqual(["0.52", "0.52 degrees"]);
	});
});

describe("the parts", () => {
	test("multiplierRefused: ordinary, boundary and hostile arguments", () => {
		expect(multiplierRefused(numberValue(0.5))).toBeNull();
		expect(multiplierRefused(numberValue(-0))).toBeNull();
		expect(multiplierRefused(numberValue(Infinity))).toBeNull();
		expect(multiplierRefused(percentageValue(0.5))).toBeNull();
		expect(multiplierRefused(uomValue(5, "km"))?.errorCode).toBe("MULTIPLIER_TAKES_NUMBER");
		expect(multiplierRefused(stringValue(""))?.errorCode).toBe("MULTIPLIER_TAKES_NUMBER");
		expect(multiplierRefused(stringValue("__proto__"))?.errorCode).toBe("MULTIPLIER_TAKES_NUMBER");
		expect(multiplierRefused(boolValue(false))?.errorCode).toBe("MULTIPLIER_TAKES_NUMBER");
		expect(multiplierRefused(matrixValue(1, 1, [1]))?.errorCode).toBe("MULTIPLIER_TAKES_NUMBER");
		expect(multiplierRefused(datetimeValue(0))?.errorCode).toBe("INVALID_DATETIME_OP");
		expect(multiplierRefused(errorValue("X", "y"))?.errorCode).toBe("MULTIPLIER_TAKES_NUMBER");
	});

	test("namesConversionTarget: a unit, in and % are targets, a number or a name is not", () => {
		expect(namesConversionTarget(token("UNIT", "km"))).toBe(true);
		expect(namesConversionTarget(token("IDENT", "miles"))).toBe(true);
		expect(namesConversionTarget(token("IN", "in"))).toBe(true);
		expect(namesConversionTarget(token("PERCENT", "%"))).toBe(true);
		expect(namesConversionTarget(token("NUMBER", "10"))).toBe(false);
		expect(namesConversionTarget(token("IDENT", "total"))).toBe(false);
		expect(namesConversionTarget(token("IDENT", "constructor"))).toBe(false);
		expect(namesConversionTarget(undefined)).toBe(false);
	});

	test("readsAsRadians: an inverse call and an angle unit, and nothing else", () => {
		for (const name of ["asin", "acos", "atan", "atan2", "arcsin", "arccos", "arctan", "ASIN"]) {
			expect(readsAsRadians(token("FUNC", name), "degrees")).toBe(true);
		}
		expect(readsAsRadians(token("FUNC", "asin"), "deg")).toBe(true);
		expect(readsAsRadians(token("FUNC", "asin"), "km")).toBe(false);
		expect(readsAsRadians(token("FUNC", "asin"), "constructor")).toBe(false);
		expect(readsAsRadians(token("FUNC", "sin"), "degrees")).toBe(false);
		expect(readsAsRadians(token("FUNC", "asind"), "degrees")).toBe(false);
		expect(readsAsRadians(token("IDENT", "asin"), "degrees")).toBe(false);
		expect(readsAsRadians(token("NUMBER", "0.5"), "degrees")).toBe(false);
		expect(readsAsRadians(undefined, "degrees")).toBe(false);
	});
});

describe("adversarial", () => {
	test("security: prototype words in each form stay ordinary words", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				for (const line of [`${word} is prime`, `7 is ${word}`, `add ${word} to 10`, `add 3 to ${word}`, `${word} as multiplier`, `asin(0.5) in ${word}`, `2 ${word} 3`]) {
					expectHonestLine(line);
				}
				expectHonestDocument(`${word} = 7\n${word} is prime`);
			}
		});
	});

	test("security: long operands and deep brackets are answered or refused in time", () => {
		expectHonestLine(`add ${RESOURCE_PROBES.longSum(2_000)} to 10`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.deepParens(500)} is prime`);
		expectHonestLine(`${RESOURCE_PROBES.longText()} as multiplier`, { budgetMs: 5_000 });
		expectHonestLine("2^(10^9) is prime", { budgetMs: 5_000 });
		expectHonestLine("10^40 + 1 is prime", { budgetMs: 5_000 });
	});

	test("security: look-alike text and markup are text", () => {
		for (const text of TEXT_EDGES.filter((t) => t.trim() !== "")) {
			expectHonestLine(`${JSON.stringify(text)} as multiplier`);
			expectHonestLine(`add ${text} to 10`);
		}
		// A zero-width space inside the word is not the word.
		expect(show("7 is pr​ime")).toMatch(/^THROWS /);
	});

	test("realistic: the forms meeting each other and both document passes", () => {
		expectHonestDocument("x = 3\ny = add x to 10\ny is prime\n(y - 12) as multiplier\nasin(y / 26) in degrees");
		expect(doc("x = 3\ny = add x to 10\ny is prime\n(y / 26) as multiplier\nasin(y / 26) in degrees")).toEqual(["3", "13", "true", "0.5x", "30.00 degrees"]);
	});

	test("edge cases: the numeric corpus through each form", () => {
		const lines = [
			...fill("X is prime", NUMERIC_EDGES),
			...fill("add X to 10", NUMERIC_EDGES),
			...fill("X as multiplier", NUMERIC_EDGES),
			...fill("asin(X) in degrees", NUMERIC_EDGES),
		];
		for (const line of lines) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		expect(show("asin(2) in degrees")).toBe("asin(2) has no real value: asin is only defined for numbers from -1 to 1.");
		expect(show("-0 as multiplier")).toBe("0x");
	});
});
