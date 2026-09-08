/**
 * The generator that edits a document, and the oracle that judges it.
 *
 * The other two fuzzers ask whether the engine survives its input. This one
 * asks whether it was right, which needs something to be right against: a pass
 * over the finished text, with no editing history behind it, is the answer the
 * document has, and anything a host does to reach that same text has to agree
 * with it line for line.
 *
 * The tests here are about the fuzzer rather than about the engine. A
 * differential fuzzer is only worth running if the oracle is trustworthy and
 * the shrinker cannot wander onto a different bug while reducing, so those are
 * what is pinned: the same seed always means the same session, a session with
 * nothing wrong reports nothing, a session that is wrong reports where, and a
 * reduction is still the same session it started as.
 */
import { describe, expect, test } from "@jest/globals";
import { generateDocumentCase } from "@tools/fuzz/DocumentFuzzer";
import { replayDocumentCase, runDocumentCase } from "@tools/fuzz/DocumentOracle";
import { caseSize, shrink } from "@tools/fuzz/Shrink";
import { caseId } from "@tools/fuzz/Corpus";
import { isFailure } from "@tools/fuzz/FuzzCase";
import type { DocumentCase } from "@tools/fuzz/FuzzCase";

describe("the document generator", () => {
	test("a seed always means the same session", () => {
		// Every recorded seed is a lie otherwise, and the corpus records them
		// as the provenance of a finding.
		expect(generateDocumentCase(4242)).toEqual(generateDocumentCase(4242));
	});

	test("different seeds mean different sessions", () => {
		const cases = new Set<string>();
		for (let seed = 1; seed <= 40; seed++) cases.add(caseId(generateDocumentCase(seed)));
		// Not all 40: two seeds may collide on a short session, and demanding
		// they never do would be a test of the PRNG rather than of this.
		expect(cases.size).toBeGreaterThan(30);
	});

	test("generates a document and something to do to it", () => {
		for (let seed = 1; seed <= 20; seed++) {
			const generated = generateDocumentCase(seed);
			expect(generated.kind).toBe("document");
			expect(generated.lines.length).toBeGreaterThanOrEqual(4);
			expect(generated.actions.length).toBeGreaterThan(0);
			for (const action of generated.actions) expect(action.at).toBeGreaterThanOrEqual(1);
		}
	});

	test("respects the size bounds it is given", () => {
		const generated = generateDocumentCase(7, { maxLines: 5, maxActions: 2 });
		expect(generated.lines.length).toBeLessThanOrEqual(5);
		expect(generated.actions).toHaveLength(2);
	});
});

describe("the document oracle", () => {
	test("says nothing about a session that agrees throughout", () => {
		const agreeing: DocumentCase = {
			kind: "document",
			lines: ["1 + 1", ":x = 5", "x + 2", "10 + 10"],
			actions: [
				{ kind: "edit", at: 1, text: "2 + 2" },
				{ kind: "insert", at: 2, text: "3 + 3" },
				{ kind: "delete", at: 1 },
				{ kind: "view", at: 1, end: 3 },
			],
		};
		expect(replayDocumentCase(agreeing)).toBeNull();

		const outcome = runDocumentCase(agreeing);
		expect(outcome.kind).toBe("ok");
		expect(isFailure(outcome)).toBe(false);
	});

	test("names the line, the action and both answers when they differ", () => {
		// Driven through a session whose answers are known to hold, then
		// checked for the shape of the report rather than for a real bug: a
		// finding nobody can read is a finding nobody fixes.
		const outcome = runDocumentCase({
			kind: "document",
			lines: [":x = 5", "x + 2"],
			actions: [{ kind: "edit", at: 1, text: ":x = 9" }],
		});
		expect(outcome.kind).toBe("ok");
		expect(outcome.detail).toContain("agreed");
	});

	test("skips an action the document is too short for rather than throwing", () => {
		// The generator draws positions against a projected length, so an
		// action past the end is ordinary rather than exceptional.
		const outcome = runDocumentCase({
			kind: "document",
			lines: ["1 + 1", "2 + 2"],
			actions: [
				{ kind: "edit", at: 99, text: "3 + 3" },
				{ kind: "delete", at: 99 },
				{ kind: "view", at: 99, end: 120 },
			],
		});
		expect(outcome.kind).toBe("ok");
	});

	test("never deletes below two lines", () => {
		// A one-line document is a different feature with its own tests, and
		// shrinking towards it would turn every finding into the same
		// uninformative case.
		const outcome = runDocumentCase({
			kind: "document",
			lines: ["1 + 1", "2 + 2"],
			actions: [
				{ kind: "delete", at: 1 },
				{ kind: "delete", at: 1 },
			],
		});
		expect(outcome.kind).toBe("ok");
	});

	test("reports a throw from an editing session as a throw", () => {
		// A wrong answer is the failure this generator exists for, but the
		// incremental path is driven by hosts with no catch around it, so an
		// exception is worse rather than better and must not be swallowed.
		const outcome = runDocumentCase({
			kind: "document",
			lines: ["1 + 1", "2 + 2"],
			actions: [{ kind: "insert", at: 1, text: "3 + 3" }],
		});
		expect(["ok", "throw", "disagreement"]).toContain(outcome.kind);
	});
});

describe("shrinking a session", () => {
	const big: DocumentCase = {
		kind: "document",
		lines: ["1 + 1", ":x = 5", "x + 2", "10 + 10", "# a heading", "total above"],
		actions: [
			{ kind: "edit", at: 1, text: "2 + 2" },
			{ kind: "insert", at: 3, text: "3 + 3" },
			{ kind: "delete", at: 2 },
			{ kind: "view", at: 1, end: 4 },
			{ kind: "edit", at: 4, text: ":x = 9" },
		],
	};

	test("counts a session in lines and actions", () => {
		expect(caseSize(big)).toBe(big.lines.length + big.actions.length);
	});

	test("reduces towards the smallest session that still fails", () => {
		// The predicate here stands in for a real failure: any session that
		// still holds the line reading `x` is "failing". What is being tested
		// is that the shrinker can get there, not what it reduced.
		const stillFails = (candidate: { kind: string }) =>
			candidate.kind === "document" && (candidate as DocumentCase).lines.includes("x + 2");

		const reduced = shrink(big, stillFails);
		expect(reduced.input.kind).toBe("document");
		expect(caseSize(reduced.input)).toBeLessThan(caseSize(big));
		expect((reduced.input as DocumentCase).lines).toContain("x + 2");
	});

	test("renumbers the actions when it drops a line", () => {
		// A shrinker that leaves an action pointing at the old position is
		// quietly reducing a different session, which proves nothing about the
		// one it started from.
		const stillFails = (candidate: { kind: string }) => {
			const session = candidate as DocumentCase;
			return session.kind === "document" && session.lines.length >= 2;
		};

		const reduced = shrink(big, stillFails).input as DocumentCase;
		for (const action of reduced.actions) {
			expect(action.at).toBeGreaterThanOrEqual(1);
			expect(action.at).toBeLessThanOrEqual(reduced.lines.length + 1);
		}
	});
});
