/**
 * The adversarial sweep: every form the engine reads, attacked with the shared
 * corpora in `tools/adversarial.ts`.
 *
 * Each feature's own spec proves it works for the input its author had in mind.
 * This file proves the forms stay honest for the input nobody had in mind: the
 * numeric edges (negative zero, 2^53, the 34-digit decimal limit, the
 * quotients with no finite answer), the text edges (blank lines, stray carriage
 * returns, invisible and direction-changing characters, digits from other
 * scripts, markup-shaped text), the words that name an inherited property, and
 * inputs sized to exhaust time. "Honest" means what the engine promises: the
 * right answer or a refusal that names the problem, never a raw JavaScript
 * error, a leaked internal, a hang or a changed `Object.prototype`.
 *
 * A form added to the engine gets a template here in the same change (see the
 * "Adversarial tests" rule in CLAUDE.md). A case that is a known open bug is a
 * one-assertion `test.failing` naming its issue, per FailingTestShape.spec.ts,
 * so the fix turns it red and it is moved into the passing set.
 */

import { describe, test } from "@jest/globals";
import {
	DOCUMENT_EDGES,
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";

/** One-line forms, each with `X` where an edge value goes. Grouped by the feature they exercise. */
const LINE_FORMS: Readonly<Record<string, readonly string[]>> = {
	arithmetic: ["X + 1", "X * 3", "X / 7", "X ^ 2", "-X", "X mod 3", "X == X"],
	rounding: ["round(X)", "round(X, 2)", "X to 0 dp", "X to 3 sf", "X rounded", "X to nearest 10", "floor(X)", "trunc(X)"],
	formats: ["X as engineering", "X as compact", "X as fraction", "X as hex", "X as percent", "X as binary"],
	numberTheory: ["isprime(X)", "factor(X)", "X choose 2", "modpow(X, 2, 7)", "gcd(X, 6)", "fact(X)"],
	functions: ["sqrt(X)", "sin(X)", "log(X)", "exp(X)", "asin(X)", "abs(X)", "root(3, X)"],
	checks: ["check X == X", "check X > 0", "check X ≈ 1 within 1%"],
	units: ["X m * 3 m", "X kg * $5/kg", "X m in ft", "X °C in °F", "$X", "X%", "X km/h in mph"],
	money: ["$X * 3", "$X split 3 ways", "X% of $200"],
	finance: ["npv of -1000, X, 400 at 10%", "irr of -1000, X, 400"],
	distributions: ["normalcdf(X)", "binompdf(10, 0.5, X)"],
	solving: ["solve(x^2 = X, x)", "integral(x, x, 0, X)"],
	dates: ["1 Jan 2026 + X days", "1 Jan 2026 + X", "1 Jan 2026 to X", "X to 1 Jan 2026", "X * 9:00", "round(9:00) + X", "(9:30 - 8:30) + X minutes", "X as iso8601"],
};

describe("every form stays honest over the numeric edges", () => {
	for (const [feature, forms] of Object.entries(LINE_FORMS)) {
		const lines = forms.flatMap((form) => fill(form, NUMERIC_EDGES));
		test.each(lines)(`${feature}: %s`, (line) => {
			// 0/0 is documented as NaN (the floating-point standard's answer), and a
			// form fed it may answer NaN in turn; that is not a leak.
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		});
	}
});

describe("text edges are read as text, not acted on", () => {
	test.each(TEXT_EDGES)("the line %j", (line) => {
		expectHonestLine(line);
	});

	test.each(fill("X + 1", TEXT_EDGES.filter((t) => t.trim() !== "")))("inside an expression: %j", (line) => {
		expectHonestLine(line);
	});
});

describe("document edges agree through both passes", () => {
	// The four trailing-newline documents were pinned open here until #613.
	test.each(DOCUMENT_EDGES)("the document %j", (text) => {
		expectHonestDocument(text);
	});
});

/**
 * The cross-line forms, each with `X` where an edge value goes, run through both
 * document passes. Goal seek resolves only in the incremental pass by design,
 * so its passes are not compared.
 */
const DOCUMENT_FORMS: ReadonlyArray<{ readonly form: string; readonly agree?: boolean }> = [
	{ form: "a = X\nb = a * 2\nline 2 with a = 5" },
	{ form: "a = 1\nb = a * 2\nline 2 with a = X" },
	{ form: "a = 1\nb = a * 2\nline 2 for a from X to 3 step 1" },
	{ form: "a = 1\nb = a * 2\nline 2 for a from 1 to 3 step X" },
	{ form: "X\ncheck line 1 == X" },
	{ form: "X #t\n5 #t\ntotal of #t" },
	{ form: "# S\nX\n5\ntotal of section \"S\"" },
	{ form: "| item | cost |\n| --- | --- |\n| food | X |\n\ncolumn \"cost\" for \"food\"" },
	{ form: "X\n5\ntotal above\naverage above" },
	{ form: "X\ninputs of line 1" },
	{ form: "x = 1\ny = x * 3\nsolve line 2 for x = X", agree: false },
];

describe("the cross-line forms stay honest over the numeric edges, through both passes", () => {
	for (const { form, agree } of DOCUMENT_FORMS) {
		test.each(fill(form, NUMERIC_EDGES))(`${form.split("\n").pop()}: %j`, (text) => {
			expectHonestDocument(text, { agree, allowNaN: text.includes("0/0") });
		});
	}
});

describe("a word naming an inherited property is an ordinary unknown word", () => {
	const forms = [
		"5 as X",
		"5 in X",
		"5 to nearest X",
		"X(5)",
		"X",
		"time in X",
		"total of #X",
		"5 X",
	];
	test.each(forms.flatMap((form) => fill(form, PROTOTYPE_WORDS)))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test.each(PROTOTYPE_WORDS)("as a variable, a section and a table column: %s", (word) => {
		expectPrototypeUntouched(() => {
			expectHonestDocument(`${word} = 5\n${word} * 2`);
			expectHonestDocument(`# ${word}\n10\ntotal of section "${word}"`, { agree: false });
			expectHonestDocument(`| ${word} | cost |\n| --- | --- |\n| food | 10 |\n\ncolumn "${word}" for "food"`, { agree: false });
		});
	});
});

describe("inputs sized to exhaust time are answered or refused in time", () => {
	test.each([
		["a long sum", RESOURCE_PROBES.longSum()],
		["deep brackets", RESOURCE_PROBES.deepParens()],
		["a long string", RESOURCE_PROBES.longText()],
		["a long name", RESOURCE_PROBES.longIdentifier()],
		["a huge power", RESOURCE_PROBES.hugePower()],
		["a huge range", RESOURCE_PROBES.hugeRange()],
	])("%s", (_name, line) => {
		expectHonestLine(line, { budgetMs: 5_000 });
	});

	test("a long chain of previous-line reads", () => {
		expectHonestDocument(RESOURCE_PROBES.manyLines(1_000), { budgetMs: 10_000 });
	});
});
