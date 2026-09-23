/**
 * Seeded, stable randomness (#523).
 *
 * With a seed, from the `random` engine option, `setRandomSeed`, or a
 * `random seed` line in the document, every draw is the same on every run and
 * changes only when its own line is edited. See engine/SeededRandom.ts.
 */

import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { seededStream, documentRandomSeed } from "@solve-js/engine/SeededRandom";

const answers = (engine: ExpressionEngine, text: string): string[] =>
	engine.parseDocument(text).lines.map((line) => (line.result ? formatValue(line.result) : `ERROR ${line.error}`));

const DRAWS = "roll(1, 100)\ncoin\npick(\"a\", \"b\", \"c\")\nshuffle [1, 2, 3, 4, 5]\nuuid\nrandom hex 8\nroll between 1 and 6";

describe("the seeded stream", () => {
	test("is the same for the same seed and key, and different otherwise", () => {
		const a = seededStream("42", "k");
		const b = seededStream("42", "k");
		const c = seededStream("43", "k");
		const d = seededStream("42", "other");
		const first = [a(), a(), a()];
		expect([b(), b(), b()]).toEqual(first);
		expect(c()).not.toBe(first[0]);
		expect(d()).not.toBe(first[0]);
		for (const x of first) expect(x >= 0 && x < 1).toBe(true);
	});

	test("the document seed is the first random seed line, any text", () => {
		expect(documentRandomSeed(["x = 1", "random seed 42", "random seed 7"])).toBe("42");
		expect(documentRandomSeed(["Random Seed spring-2026"])).toBe("spring-2026");
		expect(documentRandomSeed(["roll(1, 6)"])).toBeUndefined();
	});
});

describe("the engine option", () => {
	test("makes every kind of draw repeatable across engines", () => {
		const one = answers(createEngine({ random: { seed: 42 } }), DRAWS);
		const two = answers(createEngine({ random: { seed: 42 } }), DRAWS);
		expect(two).toEqual(one);
		expect(answers(createEngine({ random: { seed: 43 } }), DRAWS)).not.toEqual(one);
	});

	test("unseeded draws still vary", () => {
		const text = Array.from({ length: 20 }, (_, i) => `roll(1, 1000) + ${i}`).join("\n");
		expect(answers(createEngine(), text)).not.toEqual(answers(createEngine(), text));
	});

	test("setRandomSeed seeds, reseeds and restores", () => {
		const engine = createEngine({ random: { seed: 1 } });
		const first = answers(engine, "roll(1, 1000)");
		engine.setRandomSeed(2);
		expect(answers(engine, "roll(1, 1000)")).not.toEqual(first);
		engine.setRandomSeed(1);
		expect(answers(engine, "roll(1, 1000)")).toEqual(first);
	});
});

describe("a random seed line", () => {
	test("answers with the seed in force", () => {
		expect(answers(createEngine(), "random seed 42")[0]).toBe("= random draws seeded with 42");
		expect(answers(createEngine(), "random seed")[0]).toContain("needs a seed after it");
	});

	test("seeds the whole document, wherever it sits", () => {
		const top = answers(createEngine(), `random seed 7\n${DRAWS}`).slice(1);
		const bottom = answers(createEngine(), `${DRAWS}\nrandom seed 7`).slice(0, -1);
		expect(bottom).toEqual(top);
	});

	test("a line added above leaves every draw where it was", () => {
		const before = answers(createEngine(), `random seed 7\n${DRAWS}`).slice(1);
		const after = answers(createEngine(), `random seed 7\nx = 2\n${DRAWS}`).slice(2);
		expect(after).toEqual(before);
	});

	test("two lines written the same way draw separately", () => {
		const rolls = answers(createEngine(), "random seed 7\nroll(1, 1000)\nroll(1, 1000)\nroll(1, 1000)").slice(1);
		expect(new Set(rolls).size).toBe(3);
	});

	test("takes precedence over the engine option", () => {
		const fromLine = answers(createEngine({ random: { seed: 1 } }), `random seed 7\n${DRAWS}`).slice(1);
		expect(fromLine).toEqual(answers(createEngine(), `random seed 7\n${DRAWS}`).slice(1));
	});

	test("changing the seed line re-draws on the same engine, and changing it back restores", () => {
		const engine = createEngine();
		const seven = answers(engine, `random seed 7\n${DRAWS}`);
		const eight = answers(engine, `random seed 8\n${DRAWS}`);
		expect(eight.slice(1)).not.toEqual(seven.slice(1));
		expect(answers(engine, `random seed 7\n${DRAWS}`)).toEqual(seven);
	});
});

describe("every entry point agrees", () => {
	test("parseDocument and evaluateDocument give the same draws", () => {
		const text = `random seed 7\n${DRAWS}`;
		const incremental = evaluateDocument(createEngine() as unknown as ExpressionEngine, text).lines.map((line) =>
			line.result ? formatValue(line.result) : `ERROR ${line.error}`,
		);
		expect(incremental).toEqual(answers(createEngine(), text));
	});

	test("an edit to the seed line re-draws the lines below it in the incremental evaluator", () => {
		const lines = ["random seed 7", "roll(1, 1000)", "coin"];
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
		evaluator.evaluate({ startLine: 1, endLine: 3 });
		const shown = () => [2, 3].map((n) => formatValue(doc.getLineAt(n)!.result!));
		const seven = shown();
		expect(seven).toEqual(answers(createEngine(), lines.join("\n")).slice(1));

		doc.editLine(1, "random seed 8");
		evaluator.evaluate({ startLine: 1, endLine: 3 });
		expect(shown()).toEqual(answers(createEngine(), ["random seed 8", ...lines.slice(1)].join("\n")).slice(1));
		evaluator.terminateWorker();
	});

	test("a single evaluated line draws from the engine's seed", () => {
		const a = createEngine({ random: { seed: 5 } }).evaluateLine(1, "roll(1, 1000)");
		const b = createEngine({ random: { seed: 5 } }).evaluateLine(1, "roll(1, 1000)");
		expect(formatValue(b)).toBe(formatValue(a));
	});
});
