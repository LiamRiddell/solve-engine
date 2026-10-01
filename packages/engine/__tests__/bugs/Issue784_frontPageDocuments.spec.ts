import { describe, expect, test } from "@jest/globals";
import * as path from "node:path";
import { createEngine } from "@solve-js/api/createEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { ValueType } from "@solve-js/vm/Value";
import { collectAll } from "@tools/docExampleCollector";

/**
 * #784: the README and the introduction show a document, not only single
 * lines: a name defined on one line and read on another, and a block that
 * brings the document features together (category tags, a check, a what-if and
 * a trace). `DocExamples.spec.ts` proves each block through the pass it uses;
 * this holds the claims the issue makes about them: both blocks are on both
 * pages, the name is read below where it is defined, and `parseDocument` and
 * `evaluateDocument` agree on every line.
 */

const ROOT = path.resolve(__dirname, "../../../..");
const README = path.join(ROOT, "README.md");
const INTRODUCTION = path.join(ROOT, "docs/src/content/docs/getting-started/introduction.md");

const { docBlocks } = collectAll(path.join(ROOT, "no-such-directory"), [README, INTRODUCTION]);
const blocksOf = (file: string) => docBlocks.filter((block) => block.file === file);

const show = (line: { error?: string | null; result?: unknown } | undefined): string => {
	if (!line) return "(no line)";
	if (line.error) return `ERROR: ${line.error}`;
	if (!line.result) return "";
	const value = line.result as Parameters<typeof formatValue>[0];
	return `${value.type === ValueType.Error ? "ERROR: " : ""}${formatValue(value, DEFAULT_FORMATTING_SETTINGS).replace(/^=\s*/, "")}`;
};

function bothPasses(rows: readonly string[]): { batch: string[]; incremental: string[] } {
	const source = rows.join("\n");
	const batch = createEngine({ config: { network: { enabled: false } } }).parseDocument(source, { inputType: "markdown" });
	const incremental = evaluateDocument(createEngine({ config: { network: { enabled: false } } }), source, { inputType: "markdown" });
	return { batch: batch.lines.map(show), incremental: incremental.lines.map(show) };
}

describe.each([
	["README.md", README],
	["introduction.md", INTRODUCTION],
])("%s shows a document", (_name, file) => {
	test("it has the names-across-lines block and the document-features block", () => {
		const blocks = blocksOf(file);
		const names = blocks.find((b) => b.rows.some((r) => r.expression.startsWith(":tax = :subtotal")));
		const features = blocks.find((b) => b.rows.some((r) => r.expression.startsWith("inputs of line")));
		expect(names).toBeDefined();
		expect(features).toBeDefined();
		// The name is read on a later line than the one defining it.
		const rows = names!.rows.map((r) => r.expression);
		expect(rows.indexOf(":subtotal = 240")).toBeLessThan(rows.findIndex((r) => r.includes(":subtotal") && !r.startsWith(":subtotal =")));
		// The features block uses each form the issue names.
		const text = features!.rows.map((r) => r.expression).join("\n");
		for (const form of ["#travel", "total of #travel", "check ", " with ", "inputs of"]) expect(text).toContain(form);
	});

	test("both document passes agree on every line of every block, and match what the page states", () => {
		for (const block of blocksOf(file)) {
			const { batch, incremental } = bothPasses(block.rows.map((r) => r.expression));
			expect(incremental).toEqual(batch);
			block.rows.forEach((row, i) => {
				if (row.expected !== null) expect({ row: row.expression, got: batch[i] }).toEqual({ row: row.expression, got: row.expected });
			});
		}
	});
});

describe("the forms the issue left off the front page", () => {
	test("the trip block is the same on both pages", () => {
		const trip = (file: string) => blocksOf(file).find((b) => b.rows.some((r) => r.expression === "# Trip"))!.rows.map((r) => [r.expression, r.expected]);
		expect(trip(README)).toEqual(trip(INTRODUCTION));
	});

	test("a single line cannot read the document, and says so rather than guessing", () => {
		const engine = createEngine({ config: { network: { enabled: false } } });
		for (const line of ["inputs of line 6", "line 5 with nights = 4", "total of #travel"]) {
			let outcome: string;
			try {
				outcome = show({ result: engine.evaluateLine(1, line) });
			} catch (error) {
				outcome = `THREW: ${(error as Error).message}`;
			}
			expect(outcome).not.toMatch(/£705|£380|TypeError|RangeError|\[object Object\]/);
		}
	});

	test("an edit flows down: a larger subtotal changes the tax and the total", () => {
		const { batch, incremental } = bothPasses([":subtotal = 250", ":tax = :subtotal * 20%", ":subtotal + :tax"]);
		expect(batch).toEqual(["250", "50", "300"]);
		expect(incremental).toEqual(batch);
	});

	test("CRLF line endings and a trailing newline read the same", () => {
		const lf = bothPasses([":subtotal = 240", ":tax = :subtotal * 20%", ":subtotal + :tax"]).batch;
		const source = ":subtotal = 240\r\n:tax = :subtotal * 20%\r\n:subtotal + :tax\r\n";
		const crlf = createEngine({ config: { network: { enabled: false } } }).parseDocument(source).lines.map(show);
		expect(crlf.slice(0, 3)).toEqual(lf);
	});
});
