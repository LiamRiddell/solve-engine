import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { fromFollows } from "@solve-js/packages/arithmetic/parselets/AddToParselet";
import { leftIsWholeCall, readsAsRadians } from "@solve-js/parser/InverseTrigAngle";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";

/**
 * Found bug, two readings of a line:
 *
 * - `subtract 3 from 10` was refused. `subtract` (like `take` and `remove`) is
 *   the `-` keyword, so the line read as `-3` with a stray `from 10`. When a
 *   `from` follows at the top of the line, the word now takes its operand from
 *   what follows (`SubtractFromParselet`): 7, the order the sentence says.
 *   Without a `from` the word is a minus sign as before.
 * - `asin(0.5) in km` answered 0.52 km, an angle labelled as a length. A left
 *   side that is an inverse trigonometric call and nothing else is an angle
 *   whatever the target (`leftIsWholeCall`), so it is read as radians for any
 *   target, and the conversion refuses one that is not an angle. A longer left
 *   side (`asin(0.5) * 6371 km`, an arc length) may be anything, so it is read
 *   as radians only for an angle target, as before.
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function token(type: string, text: string): Token {
	return new LexerToken(type, tokenTypeId(type), text, text, 0, 0, 1, 1);
}

/** A stand-in for the parser, positioned `at` tokens into `tokens`. */
function positioned(tokens: Token[], at: number) {
	return { peekAt: (offset: number) => tokens[at + offset] };
}

describe("subtract A from B", () => {
	test.each([
		["subtract 3 from 10", "7"],
		["take 3 from 10", "7"],
		["remove 3 from 10", "7"],
		["subtract $5 from $20", "$15.00"],
		["subtract 3 km from 10 km", "7.00 km"],
		["subtract 3 days from 5 May 2026", "Saturday, May 2, 2026"],
		["10 - subtract 2 from 5", "7"],
		["subtract 3 * 2 from 10", "4"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("without a from the word is a minus sign, as before", () => {
		expect(shown("subtract 3")).toBe("-3");
		expect(shown("subtract 3 + 1")).toBe("-2");
		expect(shown("minus 3")).toBe("-3");
		expect(shown("-3 + 1")).toBe("-2");
	});

	test("a from inside brackets is not the word's", () => {
		expect(shown("subtract (3 from 10)")).toMatch(/^THROWS /);
	});
});

describe("an inverse trigonometric call converted to a unit that is not an angle", () => {
	test.each([
		["asin(0.5) in km", "an angle cannot be converted to a length"],
		["atan2(1, 1) in km", "an angle cannot be converted to a length"],
		["acos(0.5) to kg", "an angle cannot be converted to a mass"],
		["asin(0.5) in USD", "an angle cannot be converted to money"],
		["asin(0.5) in degrees", "30.00 degrees"],
		["asin(0.5) in rad", "0.52 rad"],
		["asin(0.5) * 6371 km in miles", "2,072.80 miles"],
		["2 * asin(0.5) in km", "1.05 km"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});
});

describe("the parts", () => {
	test("fromFollows: an unbracketed from only", () => {
		const tokens = [token("NUMBER", "3"), token("FROM", "from"), token("NUMBER", "10")];
		expect(fromFollows(positioned(tokens, 0))).toBe(true);
		expect(fromFollows(positioned([token("LPAREN", "("), ...tokens, token("RPAREN", ")")], 0))).toBe(false);
		expect(fromFollows(positioned([token("NUMBER", "3")], 0))).toBe(false);
		expect(fromFollows(positioned([], 0))).toBe(false);
		expect(fromFollows(positioned([token("FROM", "FROM")], 0))).toBe(true);
		expect(fromFollows(positioned([token("FROM", "von")], 0))).toBe(false);
		expect(fromFollows(positioned([token("RPAREN", ")"), token("FROM", "from")], 0))).toBe(false);
	});

	test("leftIsWholeCall: the call to its closing bracket and nothing more", () => {
		const asin = token("FUNC", "asin");
		const call = [asin, token("LPAREN", "("), token("NUMBER", "0.5"), token("RPAREN", ")"), token("IN", "in")];
		expect(leftIsWholeCall(positioned(call, call.length), asin)).toBe(true);
		const nested = [asin, token("LPAREN", "("), token("LPAREN", "("), token("NUMBER", "0.5"), token("RPAREN", ")"), token("RPAREN", ")"), token("IN", "in")];
		expect(leftIsWholeCall(positioned(nested, nested.length), asin)).toBe(true);
		const product = [asin, token("LPAREN", "("), token("NUMBER", "0.5"), token("RPAREN", ")"), token("STAR", "*"), token("NUMBER", "2"), token("IN", "in")];
		expect(leftIsWholeCall(positioned(product, product.length), asin)).toBe(false);
		const twoCalls = [asin, token("LPAREN", "("), token("RPAREN", ")"), token("STAR", "*"), token("FUNC", "asin"), token("LPAREN", "("), token("RPAREN", ")"), token("IN", "in")];
		expect(leftIsWholeCall(positioned(twoCalls, twoCalls.length), asin)).toBe(false);
		expect(leftIsWholeCall(positioned([token("RPAREN", ")"), token("IN", "in")], 2), asin)).toBe(false);
		expect(leftIsWholeCall(positioned([], 0), undefined)).toBe(false);
	});

	test("readsAsRadians: an angle target, or any target for the whole call", () => {
		const asin = token("FUNC", "asin");
		expect(readsAsRadians(asin, "degrees")).toBe(true);
		expect(readsAsRadians(asin, "km")).toBe(false);
		expect(readsAsRadians(asin, "km", true)).toBe(true);
		expect(readsAsRadians(token("FUNC", "sin"), "km", true)).toBe(false);
		expect(readsAsRadians(token("IDENT", "asin"), "km", true)).toBe(false);
		expect(readsAsRadians(undefined, "km", true)).toBe(false);
		for (const word of PROTOTYPE_WORDS) expect(readsAsRadians(token("FUNC", word), word, true)).toBe(false);
	});
});

describe("adversarial", () => {
	test("security: prototype words as either operand or the target", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`subtract ${word} from 10`);
				expectHonestLine(`subtract 3 from ${word}`);
				expectHonestLine(`asin(0.5) in ${word}`);
			}
		});
	});

	test("security: deep brackets, a long chain and markup-shaped text", () => {
		expectHonestLine(`subtract ${"(".repeat(300)}3${")".repeat(300)} from 10`);
		expectHonestLine(Array.from({ length: 500 }, () => "subtract 1 from").join(" ") + " 1000", { budgetMs: 5_000 });
		for (const line of fill("subtract 3 from X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("asin(0.5) in X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: values from lines above, a check over the difference, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("budget = $200\nspent = $45\nsubtract spent from budget\ncheck subtract spent from budget == $155");
		expect(batch[2]).toBe("= $155.00");
		expect(batch[3]).toBe("= ✓");
		expect(incremental).toEqual(batch);
		expectHonestDocument("a = asin(0.5)\na in km\nasin(0.5) in km");
	});

	test("edge: numeric edges as each operand", () => {
		for (const line of fill("subtract X from 10", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("subtract 3 from X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("asin(X) in km", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
