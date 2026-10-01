import { describe, expect, test } from "@jest/globals";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { runEngine, runEngineWithStreaming } from "@bridge/engine";

/**
 * Found bug: the playground's editor built its completion names from the
 * dependency graph snapshot, the keys of `consumers` (every name a line reads,
 * defined or not) and every `writes` entry, so it offered names that were only
 * ever read and names a since-deleted line once wrote. The evaluating engine
 * answers the question itself (`documentVariableNames()`), but it lives in the
 * worker, so the bridge now reads it there and carries it on the report as
 * `documentNames`, which the editor's language service reads.
 */

/** The report's names, through the batch path and the streaming path the worker uses. */
function namesOf(text: string): { batch: string[]; streamed: string[] } {
	const controller = new AbortController();
	const { result } = runEngineWithStreaming(text, controller.signal);
	controller.abort();
	return { batch: runEngine(text).documentNames, streamed: result.documentNames };
}

describe("the report carries the evaluating engine's document names", () => {
	test("a defined name is listed, and a name only read is not", () => {
		const { batch, streamed } = namesOf("rent = 1200\nrent * 12\nbudgte * 2");
		expect(batch).toContain("rent");
		expect(batch).not.toContain("budgte");
		expect(streamed).toEqual(batch);
	});

	test("names of several words, a colon definition and a function are listed", () => {
		const { batch } = namesOf("hourly rate = $50\n:tax = 20%\nf(x) = x * 2");
		expect(batch).toEqual(expect.arrayContaining(["hourly rate", "tax", "f"]));
	});

	test("an empty document and a prose-only document list nothing", () => {
		expect(namesOf("").batch).toEqual([]);
		expect(namesOf("Some prose about the rent.").batch).toEqual([]);
	});

	test("a name refused for a hidden direction control is never listed", () => {
		expect(namesOf("‮rent = 5\nrent = 2").batch).toEqual(["rent"]);
	});

	test("prototype words defined as names are listed as text, and the prototype is untouched", () => {
		expectPrototypeUntouched(() => {
			const text = PROTOTYPE_WORDS.map((w, i) => `:${w} = ${i}`).join("\n");
			const { batch } = namesOf(text);
			for (const name of batch) expect(typeof name).toBe("string");
		});
	});
});
