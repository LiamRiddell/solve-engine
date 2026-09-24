/**
 * `readExpressionTokens` and `tryCompileExpression` agree on what is code.
 *
 * The reference calls in the language service decide which words are variables
 * by asking `ExpressionEngine.readExpressionTokens`, which has no side effects:
 * the statements the engine runs while compiling (`total += 5`, `tax = 20%`, a
 * unit definition) are recognised there by shape and never run. That is a
 * second reading of the same grammar, so this pins it to the first: over every
 * line the documentation shows, and a set of prose and half-typed lines, the
 * two answer "is this code" identically.
 *
 * Each compile gets a fresh engine, since `tryCompileExpression` does run those
 * statements and a unit it defines would change how a later line compiles. The
 * read side shares one engine, which is the point: it changes nothing.
 */
import { describe, expect, test } from "@jest/globals";
import * as path from "path";
import { collectAll } from "@tools/docExampleCollector";
import { newTrackedEngine } from "@tools/trackedEngine";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs/src/content/docs");

/** Prose, half-typed lines, and the statement shapes, which the docs show few of. */
const EXTRA_LINES = [
	"tax is due in April",
	"the price is high",
	"My name is ron",
	"see line 3 above",
	"total =",
	"x =",
	"2 * x =",
	"a * n =",
	"355/113=",
	"total +=",
	"total += 5",
	"tax = 20%",
	"x^2 - 4 = 0",
	"=>",
	"x =>",
	"a = b = c",
	"rent: 1200",
	"input value: :x = 5",
	"(1 + 2",
	"1 +",
	"sum(",
	'"unterminated',
	"24:00",
	"1 sprint = 2 weeks",
	"1 story point = 4 hours",
	"f(x) = 2x",
	"f(x) =",
	":x =",
	"global :r =",
	"solve line 2 for x =",
	"line deleted * 2",
	"sum(line deleted : line deleted)",
];

/** Every expression the documentation shows, once each. */
function corpus(): string[] {
	const { examples, docBlocks } = collectAll(DOCS_ROOT, [path.join(REPO_ROOT, "README.md")]);
	const lines = new Set<string>(EXTRA_LINES);
	for (const example of examples) if (example.expression.trim()) lines.add(example.expression.trim());
	for (const block of docBlocks) for (const row of block.rows) if (row.expression.trim()) lines.add(row.expression.trim());
	return [...lines];
}

describe("readExpressionTokens agrees with tryCompileExpression about what is code", () => {
	test("over the documented corpus and the statement shapes", () => {
		const lines = corpus();
		expect(lines.length).toBeGreaterThan(500);
		const reader = newTrackedEngine();
		const disagreements: string[] = [];
		for (const line of lines) {
			const read = reader.readExpressionTokens(line);
			const compiles = newTrackedEngine().tryCompileExpression(line);
			// A line that is only a comment compiles to nothing and holds no
			// code, which is what `null` says; the two agree in substance.
			const emptyAfterComments = compiles && read === null && /^\s*(#|\/\/)/.test(line);
			if ((read !== null) !== compiles && !emptyAfterComments) {
				disagreements.push(`${JSON.stringify(line)}: read ${read !== null}, compiles ${compiles}`);
			}
		}
		expect(disagreements).toEqual([]);
	});
});
