import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
	lineProblems,
} from "@tools/adversarial";

function lineProblemsOf(line: string): string[] {
	return lineProblems(line).problems;
}

/**
 * Issue #778: the finance package's investment grammar (compound growth,
 * present value, return on investment and annual return) had no syntax page,
 * only a passing mention on the date-arithmetic page. `syntax/investments.md`
 * now documents it, and its examples are proven by `DocExamples.spec.ts`.
 *
 * This spec holds the grammar to what the page says: each documented line
 * answers as written through every entry point, the intervals the page lists
 * are exactly the ones read, the boundary the page names (`present value of
 * ... in 5 years`) is a refusal rather than a number, and the forms stay honest
 * over the adversarial corpora.
 */

function show(line: string): string {
	const outcome = evaluateLine(line);
	if (outcome.kind === "value") return outcome.text.replace(/^=\s*/, "");
	return `${outcome.kind.toUpperCase()} ${outcome.message}`;
}

function docLines(text: string): { batch: string[]; incremental: string[] } {
	const read = (lines: { result?: { isError(): boolean; errorMessage?: unknown } | null; error?: unknown }[]): string[] =>
		lines.map((line) => {
			if (line.result == null) return line.error ? `ERROR ${String(line.error)}` : "";
			// The result is a Value; formatValue takes it as one.
			return formatValue(line.result as Parameters<typeof formatValue>[0]).replace(/^=\s*/, "");
		});
	return {
		batch: read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }).lines),
		incremental: read(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }).lines),
	};
}

/** The page's lines and their answers, in the order the page gives them. */
const DOCUMENTED: readonly (readonly [string, string])[] = [
	["$1,000 after 3 years at 7%", "$1,225.04"],
	["£1,000 after 3 years at 7%", "£1,225.04"],
	["1000 after 3 years at 7%", "1,225.04"],
	["$1,000 after 18 months at 7%", "$1,106.82"],
	["$1,000 after 3 years at -7%", "$804.36"],
	["compound interest on $1,000 over 3 years at 7%", "$1,225.04"],
	["$1,000 for 3 years at 7%", "$1,225.04"],
	["$1,000 for 3 years at 7% compounding quarterly", "$1,231.44"],
	["$1,000 for 3 years at 7% compounding monthly", "$1,232.93"],
	["$1,000 for 3 years at 7% compounded monthly", "$1,232.93"],
	["$1,000 for 3 years at 7% compounding daily", "$1,233.65"],
	["present value of $1,225.04 after 3 years at 7%", "$1,000.00"],
	["present value of $10,000 over 5 years at 6%", "$7,472.58"],
	["present value of 10000 after 5 years at 6%", "7,472.58"],
	["$500 invested $1,500 returned", "200.00%"],
	["$1,000 invested $1,500 returned", "50.00%"],
	["$1,000 invested $1,000 returned", "0.00%"],
	["$1,000 invested $500 returned", "-50.00%"],
	["annual return on $1,000 invested $2,000 returned after 5 years", "14.87%"],
	["annual return on $1,000 invested $2,000 returned in 5 years", "14.87%"],
	["annual return on $1,000 invested $500 returned after 5 years", "-12.94%"],
];

describe("each documented line answers as the page says", () => {
	test.each(DOCUMENTED)("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("the same lines agree through both document passes, value for value", () => {
		const text = DOCUMENTED.map(([line]) => line).join("\n");
		const { batch, incremental } = docLines(text);
		expect(batch).toEqual(DOCUMENTED.map(([, answer]) => answer));
		expect(incremental).toEqual(batch);
	});

	test("a sum held in a variable grows the same way", () => {
		const { batch, incremental } = docLines(":start = $1,000\nstart after 10 years at 5%");
		expect(batch[1]).toBe("$1,628.89");
		expect(incremental).toEqual(batch);
	});

	test("present value undoes growth: the two round-trip", () => {
		// The page's claim that its first present-value line undoes its first line.
		expect(show("present value of $1,225.04 after 3 years at 7%")).toBe("$1,000.00");
		expect(show("$1,000 after 3 years at 7%")).toBe("$1,225.04");
	});

	test("the annual return is the rate that grows one amount into the other", () => {
		// 14.87% a year for five years takes $1,000 to $2,000, the page's check.
		expect(show("$1,000 after 5 years at 14.87%")).toBe("$2,000.01");
	});
});

describe("the compounding intervals are exactly the listed ones", () => {
	const LISTED: readonly (readonly [string, string])[] = [
		["annually", "$1,225.04"],
		["yearly", "$1,225.04"],
		["semi-annually", "$1,229.26"],
		["semiannually", "$1,229.26"],
		["half-yearly", "$1,229.26"],
		["quarterly", "$1,231.44"],
		["monthly", "$1,232.93"],
		["fortnightly", "$1,233.33"],
		["weekly", "$1,233.50"],
		["daily", "$1,233.65"],
	];

	test.each(LISTED)("compounding %s", (interval, answer) => {
		expect(show(`$1,000 for 3 years at 7% compounding ${interval}`)).toBe(answer);
	});

	test.each(["biannually", "continuously", "hourly", "Monthly2", ...PROTOTYPE_WORDS])("compounding %s is refused, naming the listed intervals", (interval) => {
		expectPrototypeUntouched(() => {
			const outcome = evaluateLine(`$1,000 for 3 years at 7% compounding ${interval}`);
			expect(outcome.kind === "thrown" || outcome.kind === "error").toBe(true);
			if (outcome.kind === "thrown" || outcome.kind === "error") {
				expect(outcome.message).toContain("expected one of annually, yearly, semi-annually");
			}
		});
	});

	test("more often compounds to more, and never past the continuous limit", () => {
		const values = LISTED.slice(5).map(([, answer]) => Number(answer.replace(/[$,]/g, "")));
		for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
		// e^(0.07 * 3) * 1000 = 1,233.68, the ceiling daily compounding approaches.
		expect(values[values.length - 1]).toBeLessThan(1000 * Math.exp(0.21));
	});
});

describe("the boundary the page names", () => {
	test("present value takes its term after after or over, and in is refused rather than answered", () => {
		for (const line of ["present value of $10,000 in 5 years at 6%", "present value of 10000 in 5 years at 6%"]) {
			const outcome = evaluateLine(line);
			expect(outcome.kind).toBe("thrown");
		}
	});

	test("present value takes no compounding tail", () => {
		expect(evaluateLine("present value of $10,000 after 5 years at 6% compounding monthly").kind).toBe("thrown");
	});

	test("nothing invested has no return, and a term that is not a time is refused", () => {
		expect(show("$0 invested $100 returned")).toBe("ERROR roi: nothing was invested, so there is no return on it");
		expect(show("$1,000 after 3 kg at 7%")).toBe('ERROR a term is a length of time, and "kg" is not: write it as days, months or years');
	});

	test("the bare after form still means a date offset when a date is in front of it", () => {
		// The date-arithmetic page's reason `after` is not always an investment.
		expect(show("3 days after 2026-01-01")).toMatch(/January 4, 2026/);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("%s as the amount, the term or the rate is read as a name, not a lookup", (word) => {
		expectPrototypeUntouched(() => {
			for (const line of [`${word} after 3 years at 7%`, `$1,000 after ${word} years at 7%`, `$1,000 after 3 years at ${word}%`, `${word} invested $1,500 returned`, `present value of ${word} after 3 years at 7%`]) {
				expectHonestLine(line);
			}
		});
	});

	test("a huge term or rate is answered or refused within the budget", () => {
		for (const line of ["$1,000 after 1e9 years at 7%", "$1,000 after 3 years at 1e9%", "$1,000 for 1e6 years at 7% compounding daily", "present value of $1 after 1e9 years at 7%", "annual return on $1 invested 1e308 returned after 1e-300 years"]) {
			expectHonestLine(line, { budgetMs: 2_000 });
		}
	});

	test("look-alike and markup-shaped text around the grammar is read as text", () => {
		for (const edge of TEXT_EDGES) {
			expectHonestLine(`$1,000 after 3 years at 7% ${edge}`);
		}
		// Digits from another script do not become a sum of money.
		expectHonestLine("$١,٠٠٠ after 3 years at 7%");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo in a keyword is refused, not answered as something else", () => {
		for (const line of ["$1,000 afer 3 years at 7%", "$1,000 for 3 years at 7% compunding monthly", "$500 invest $1,500 returned"]) {
			const outcome = evaluateLine(line);
			expect(outcome.kind === "value" && /\$1,2\d\d\.\d\d/.test(outcome.text)).toBe(false);
			expectHonestLine(line);
		}
	});

	test("the forms meet a check, a what-if and a tag through both passes", () => {
		expectHonestDocument(":rate = 7%\n$1,000 after 3 years at rate\ncheck prev > $1,200");
		expectHonestDocument("$1,000 after 3 years at 7% #savings\n$500 invested $1,500 returned");
		expectHonestDocument("## Pension\n:pot = $10,000\npot after 20 years at 5%\npresent value of prev after 20 years at 5%");
	});

	test("the line above can be the amount", () => {
		const { batch, incremental } = docLines("$1,000\nprev after 3 years at 7%");
		expect(batch[1]).toBe("$1,225.04");
		expect(incremental).toEqual(batch);
	});
});

describe("adversarial: edge cases", () => {
	const FORMS = [
		"X after 3 years at 7%",
		"$1,000 after X years at 7%",
		"$1,000 after 3 years at X%",
		"$1,000 for X years at 7% compounding monthly",
		"present value of X after 3 years at 7%",
		"X invested $1,500 returned",
		"$1,000 invested X returned",
		"annual return on $1,000 invested $2,000 returned after X years",
	];

	// An infinite amount invested answered NaN: (returned - invested) / invested
	// is infinity over infinity. Found while writing this spec and pinned as a
	// known open bug; the return on it is now refused by name, so the two
	// lines join the sweep.
	const INFINITE_COST = ["(1/0) invested $1,500 returned", "(-1/0) invested $1,500 returned"];

	test.each(FORMS.flatMap((form) => fill(form, NUMERIC_EDGES)))("%s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test.each(INFINITE_COST)("%s is refused by name rather than answered NaN", (line) => {
		expect(lineProblemsOf(line)).toEqual([]);
		expect(show(line)).toBe("ERROR roi: the amount invested is not a finite number, so there is no return on it");
	});

	test("an infinite amount returned is refused by name rather than answered Infinity%", () => {
		expect(show("$1,000 invested (1/0) returned")).toBe("ERROR roi: the amount returned is not a finite number, so there is no return to give");
		expect(show("annual return on $1,000 invested (1/0) returned after 5 years")).toBe("ERROR annual return: an amount is not a finite number, so there is no annual rate");
	});

	test("a zero term leaves the sum unchanged, and a zero rate too", () => {
		expect(show("$1,000 after 0 years at 7%")).toBe("$1,000.00");
		expect(show("$1,000 after 3 years at 0%")).toBe("$1,000.00");
	});

	test("the forms survive CRLF line endings and a trailing newline", () => {
		const { batch, incremental } = docLines("$1,000 after 3 years at 7%\r\n$500 invested $1,500 returned\r\n");
		expect(batch.slice(0, 2)).toEqual(["$1,225.04", "200.00%"]);
		expect(incremental.slice(0, 2)).toEqual(batch.slice(0, 2));
	});
});
