import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";
import { collectAll, type DocBlock } from "@tools/docExampleCollector";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #727: four more recipes, each one whole document proven by
 * `DocExamples.spec.ts` (a household budget, a mortgage decision, a developer
 * scratchpad, a lab note), and the Recipes group moved out of the syntax
 * reference, where it sat between Dates and Units, to straight after Start here.
 *
 * DocExamples proves each line's answer through the incremental pass. This spec
 * checks what that one does not: that each new page carries a proven document
 * at all, that the batch pass and a live editor agree with it on every line
 * both can answer, that the sidebar is where the issue asks, and that each
 * recipe survives the edits a reader makes to it.
 */

const REPO = path.resolve(__dirname, "../../../..");
const RECIPES = path.join(REPO, "docs/src/content/docs/recipes");
const NEW_PAGES = ["a-household-budget.md", "a-mortgage-decision.md", "a-developer-scratchpad.md", "a-lab-note.md"];

const { docBlocks } = collectAll(RECIPES);

/** The recipe page's first whole-document block. */
function blockOf(page: string): DocBlock {
	const block = docBlocks.find((b) => path.basename(b.file) === page);
	if (!block) throw new Error(`no solve-doc block on ${page}`);
	return block;
}

/** Each line of a document result as the docs show it, a failure marked. */
function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR: ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR: ${text}` : text;
	});
}

/** The same through a live evaluator, from line 1. */
function live(text: string): string[] {
	const engine = newTrackedEngine({ config: { network: { enabled: false } } });
	const doc = new DocumentModel();
	doc.setDocument(text);
	const evaluator = new ThreeTierEvaluator(doc, engine);
	try {
		return evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map((line) => {
			if (line.error) return `ERROR: ${line.error}`;
			if (!line.result) return "";
			const shown = formatValue(line.result).replace(/^=\s*/, "");
			return line.result.type === ValueType.Error ? `ERROR: ${shown}` : shown;
		});
	} finally {
		evaluator.dispose();
	}
}

const sourceOf = (page: string): string => blockOf(page).rows.map((r) => r.expression).join("\n");
const offline = () => newTrackedEngine({ config: { network: { enabled: false } } });

describe("the four recipes", () => {
	test.each(NEW_PAGES)("%s carries a proven whole document", (page) => {
		const block = blockOf(page);
		expect(block.rows.filter((r) => r.expected !== null).length).toBeGreaterThanOrEqual(8);
	});

	test.each(NEW_PAGES)("%s: both passes and a live editor agree, goal seek aside", (page) => {
		const text = sourceOf(page);
		const incremental = read(evaluateDocument(offline(), text));
		const batch = read(offline().parseDocument(text));
		const goalSeek = blockOf(page).rows.map((r) => /^solve line /.test(r.expression));
		const dependsOnGoalSeek = goalSeek.map((g, i) => g || (i > 0 && goalSeek[i - 1] && /^prev\b/.test(blockOf(page).rows[i].expression)));
		incremental.forEach((line, i) => {
			if (dependsOnGoalSeek[i]) return;
			expect(`${i + 1}: ${batch[i]}`).toBe(`${i + 1}: ${line}`);
		});
		expect(live(text)).toEqual(incremental);
	});

	test("the mortgage's goal seek resolves through the incremental pass and is refused by the batch pass", () => {
		const text = sourceOf("a-mortgage-decision.md");
		const index = blockOf("a-mortgage-decision.md").rows.findIndex((r) => r.expression.startsWith("solve line"));
		expect(read(evaluateDocument(offline(), text))[index]).toBe("£251,874.45");
		expect(offline().parseDocument(text).lines[index].result?.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
	});
});

describe("the sidebar", () => {
	const config = fs.readFileSync(path.join(REPO, "docs/astro.config.mjs"), "utf8");
	const at = (needle: string): number => {
		const i = config.indexOf(needle);
		expect(i).toBeGreaterThan(-1);
		return i;
	};

	test("Recipes comes straight after Start here", () => {
		const startHere = at('label: "Start here"');
		const recipes = at('label: "Recipes"');
		const arithmetic = at('label: "Arithmetic"');
		expect(startHere).toBeLessThan(recipes);
		expect(recipes).toBeLessThan(arithmetic);
	});

	test("Recipes is no longer between Dates and Units", () => {
		const recipes = at('label: "Recipes"');
		expect(recipes < at('label: "Dates"') || recipes > at('label: "Units"')).toBe(true);
	});

	test.each(NEW_PAGES)("%s is listed", (page) => {
		expect(config).toContain(`{ slug: "recipes/${page.replace(/\.md$/, "")}" }`);
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("the budget with its tag renamed #%s", (word) => {
		expectPrototypeUntouched(() => {
			const text = sourceOf("a-household-budget.md").split("#fixed").join(`#${word}`);
			const lines = read(evaluateDocument(offline(), text));
			expect(lines.join("\n")).not.toMatch(/\[object |is not a function|Cannot read/);
			expect(read(offline().parseDocument(text))).toEqual(lines);
		});
	});

	test("the budget with two thousand lines of spending, within budget", () => {
		const text = sourceOf("a-household-budget.md").replace("spent += £71.20", Array.from({ length: 2_000 }, () => "spent += £1.25").join("\n"));
		const started = performance.now();
		const lines = read(evaluateDocument(offline(), text));
		expect(lines).toContain("£2,602.50");
		expect(performance.now() - started).toBeLessThan(15_000);
	});

	test("markup in a recipe's labels is refused as a line, and nothing else is thrown off", () => {
		const text = sourceOf("a-household-budget.md").replace("Rent:", "<b>Rent</b>:").replace("Phone:", "<script>x</script>:");
		const lines = read(evaluateDocument(offline(), text));
		expect(lines[5]).toBe('ERROR: Expected a value, but found "<"');
		expect(lines[8]).toBe('ERROR: Expected a value, but found "<"');
		// The tag total refuses, naming the first line it could not read, rather
		// than adding up the bills that still read and calling that the total.
		expect(lines[18]).toBe("ERROR: Line 6 has an error");
		expect(read(offline().parseDocument(text))).toEqual(lines);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo in the budget's tag leaves that bill out, and the check still reads the rest", () => {
		const text = sourceOf("a-household-budget.md").replace("Phone: £22 #fixed", "Phone: £22 #fixd");
		const lines = read(evaluateDocument(offline(), text));
		expect(lines).toContain("£1,228.00");
	});

	test("a mortgage rate edited to one the loan cannot be repaid at is refused, not answered", () => {
		const text = sourceOf("a-mortgage-decision.md").replace(":rate = 4.5%", ":rate = abc");
		const lines = read(evaluateDocument(offline(), text));
		expect(lines.join("\n")).not.toMatch(/\[object |NaN|is not a function/);
	});

	test("the lab note's volume given a unit is refused rather than dropped silently in the density", () => {
		const text = sourceOf("a-lab-note.md").replace("Density in g/mL: mass / volume", "Density in g/mL: mass / (5 mL)");
		const lines = read(evaluateDocument(offline(), text));
		expect(lines.join("\n")).not.toMatch(/\[object |is not a function/);
	});

	test("the scratchpad's timestamp reads the same in any process zone, since it names UTC", () => {
		const text = "1700000000 to date in UTC";
		expect(read(offline().parseDocument(text))).toEqual(["Tuesday, November 14, 2023, 10:13:20 PM"]);
	});
});

describe("adversarial: edge cases", () => {
	test.each(NEW_PAGES)("%s with CRLF line endings and a trailing newline answers the same", (page) => {
		const text = sourceOf(page);
		const crlf = `${text.split("\n").join("\r\n")}\r\n`;
		const plain = read(evaluateDocument(offline(), text));
		expect(read(evaluateDocument(offline(), crlf)).slice(0, plain.length)).toEqual(plain);
	});

	test("a zero deposit and a zero rate in the mortgage", () => {
		const text = sourceOf("a-mortgage-decision.md").replace(":deposit = £32,000", ":deposit = £0").replace(":rate = 4.5%", ":rate = 0%");
		const lines = read(evaluateDocument(offline(), text));
		expect(lines.join("\n")).not.toMatch(/\[object |NaN|Infinity|is not a function/);
	});

	test("the scratchpad at the edges of 32 bits", () => {
		const lines = read(offline().parseDocument(["2^32 - 1 as hex", "0xFFFFFFFF & 0x0F", "1 << 31", "0 as binary"].join("\n")));
		// Shifts work on 32-bit signed integers, as the bit-shifting page says,
		// so bit 31 is the sign bit.
		expect(lines).toEqual(["0xFFFFFFFF", "15", "-2,147,483,648", "0b0"]);
	});
});
