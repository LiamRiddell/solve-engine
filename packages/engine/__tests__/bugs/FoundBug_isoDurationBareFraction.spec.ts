import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, evaluateLine, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { readIsoDuration } from "@solve-js/packages/time/IsoDuration";
import { isoDurationNormalizerRule } from "@solve-js/packages/time/normalizer/IsoDurationNormalizerRule";

/**
 * Found bug: `P.5D` was a parse error ("found .5") rather than the named
 * refusal every other malformed ISO 8601 duration gets, because the lexer
 * splits it into `P` and `.5` and the duration rule joined a decimal only
 * after a digit. A point and digits touching the text before it, with a
 * designator letter touching them, are now joined, so `P.5D`, `PT.5S` and
 * `P1DT.5H` are refused as `ISO_DURATION_MALFORMED`, saying a digit is needed
 * before the decimal mark. `P * .5`, with spaces, is still a name times a
 * half.
 */

function outcome(line: string): string {
	const result = evaluateLine(line);
	if (result.kind === "value") return result.text.replace(/^=\s*/, "");
	if (result.kind === "crashed") return `CRASH ${result.name}: ${result.message}`;
	return `${result.code}: ${result.message}`;
}

function ruleAt(line: string, pos = 0): string | null {
	const lexer = new ExpressionLexer();
	lexer.reset(line);
	const tokens = lexer.tokenizeAll().filter((t) => t.type !== "EOF");
	const match = isoDurationNormalizerRule().match(tokens, pos, {});
	return match === null ? null : `${match.consumed}: ${match.replacement.map((t) => `${t.type}(${t.value})`).join(" ")}`;
}

const refusal = (text: string, example: string): string =>
	`ISO_DURATION_MALFORMED: ${text} is not an ISO 8601 duration: a decimal mark needs a digit before it, as in ${example}.`;

describe("the lines that exposed it", () => {
	test.each([
		["P.5D", "P0.5D"],
		["PT.5S", "PT0.5S"],
		["P1DT.5H", "P1DT0.5H"],
		["PT1H.5M", "PT1H0.5M"],
		["P.25Y", "P0.25Y"],
	])("%s is refused by name, pointing at %s", (line, example) => {
		expect(outcome(line)).toBe(refusal(line, example));
	});

	test("the duration it points at is read, and the forms around it are unchanged", () => {
		expect(outcome("P0.5D")).toBe("0.50 days");
		expect(outcome("PT0.5S")).toBe("0.50 seconds");
		expect(outcome("2026-01-01 + P.5D")).toBe(refusal("P.5D", "P0.5D"));
		expect(newTrackedEngine().parseDocument("P = 4\nP * .5\nP*.5\nP .5").lines.map((l) => l.result?.toNumber() ?? `ERROR ${l.error ?? ""}`).slice(0, 3)).toEqual([4, 2, 2]);
		expect(outcome("P.5")).toMatch(/^UNEXPECTED_TRAILING_TOKEN: /);
	});
});

describe("readIsoDuration", () => {
	test("ordinary: a point with no digit before it names the fix", () => {
		expect(readIsoDuration("P.5D")).toEqual({ kind: "malformed", reason: "P.5D is not an ISO 8601 duration: a decimal mark needs a digit before it, as in P0.5D." });
		expect(readIsoDuration("PT,5S")).toEqual({ kind: "malformed", reason: "PT,5S is not an ISO 8601 duration: a decimal mark needs a digit before it, as in PT0,5S." });
	});

	test("boundary: a mark with no digit after it, or at the end, keeps the general reason", () => {
		expect(readIsoDuration("P.D1D")).toEqual({ kind: "malformed", reason: "P.D1D is not an ISO 8601 duration: each part is a number and then a letter, and \".\" has no number before it." });
		expect(readIsoDuration("P1D.")).toEqual({ kind: "malformed", reason: "P1D. is not an ISO 8601 duration: each part is a number and then a letter, and \".\" has no number before it." });
		expect(readIsoDuration("P0.5D")).toEqual({ kind: "duration", parts: [{ amount: "0.5", unit: "day" }] });
		expect(readIsoDuration("P.5")).toBeNull();
	});

	test("hostile: a long fraction and prototype-shaped text", () => {
		expect(readIsoDuration(`P.${"5".repeat(10_000)}D`)?.kind).toBe("malformed");
		expect(readIsoDuration("P.5constructor")).toBeNull();
		expect(readIsoDuration("P.5__proto__")).toBeNull();
	});
});

describe("isoDurationNormalizerRule", () => {
	test("ordinary: the bare fraction and its designator join the P into one refusal", () => {
		expect(ruleAt("P.5D")).toBe("3: ISO_DURATION_UNREADABLE(P.5D)");
		expect(ruleAt("PT.5S")).toBe("3: ISO_DURATION_UNREADABLE(PT.5S)");
		expect(ruleAt("P1DT.5H")).toBe("3: ISO_DURATION_UNREADABLE(P1DT.5H)");
	});

	test("boundary: nothing joins across a space or without a designator after the digits", () => {
		expect(ruleAt("P * .5")).toBeNull();
		expect(ruleAt("P .5D")).toBeNull();
		expect(ruleAt("P. 5D")).toBeNull();
		expect(ruleAt("P.5")).toBeNull();
		expect(ruleAt("P.5 D")).toBeNull();
		expect(ruleAt("P1D.5x")).toBe("1: ISO_DURATION(1 day)");
	});

	test("hostile: a lower-case or prototype word after the fraction is not a designator", () => {
		expect(ruleAt("P.5d")).toBeNull();
		expect(ruleAt("P.5constructor")).toBeNull();
		expect(ruleAt("P.5Constructor")).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: prototype words after the fraction, a long fraction, look-alike digits", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`P.5${word}`);
				expectHonestLine(`PT.5${word}`);
				expectHonestDocument(`${word} = 2\n${word} * .5\nP.5D + ${word} days`);
			}
		});
		expectHonestLine(`P.${"5".repeat(10_000)}D`, { budgetMs: 2_000 });
		expectHonestLine("P.５D");
		expectHonestLine("P.٥D");
		for (const line of fill("P.5D + X", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
	});

	test("realistic: a variable named P beside the refusal, a what-if, both passes agree", () => {
		const { batch, incremental } = expectHonestDocument("P = 8\nP * .5\nP.5D\nPT0.5H in minutes\nline 2 with P = 2");
		expect(batch).toEqual(["= 8", "= 4", `ERROR ${refusal("P.5D", "P0.5D").replace("ISO_DURATION_MALFORMED: ", "")}`, "= 30 minutes", "= 1"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge beside the refusal, and the refusal in each part", () => {
		for (const line of fill("P.5D * X", NUMERIC_EDGES)) {
			const result = expectHonestLine(line, { allowNaN: line.includes("0/0") });
			expect(result.kind === "error" && result.code).toBe("ISO_DURATION_MALFORMED");
		}
		for (const letter of ["Y", "M", "W", "D"]) expect(outcome(`P.5${letter}`)).toMatch(/^ISO_DURATION_MALFORMED: .* a decimal mark needs a digit before it/);
		for (const letter of ["H", "M", "S"]) expect(outcome(`PT.5${letter}`)).toMatch(/^ISO_DURATION_MALFORMED: .* a decimal mark needs a digit before it/);
	});
});
