/**
 * What the corpus counts as "already known".
 *
 * That question is the only thing standing between a fuzz run and losing what
 * it found, and it got answered wrong twice at once. A soak on 2026-08-11
 * reported a real, previously unknown hang (`gcd(4, arccos(2))` never returned)
 * and then wrote nothing, because two independent rules conspired: the run
 * seeded its "seen" set from every corpus entry rather than the open ones, so a
 * finding fixed the day before still suppressed matches, and a hang's signature
 * was built from a constant sentence, so every hang in a generator matched
 * every other one. The finding had to be reduced by hand and the corpus entry
 * written by hand.
 *
 * Neither rule is visible in a normal run: a fuzzer that drops a finding looks
 * exactly like a fuzzer that did not find one. So both are pinned here rather
 * than left to the next soak to rediscover.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, test } from "@jest/globals";
import { caseId, failureSignature, knownOpenSignatures, loadCorpus, makeEntry, saveEntry } from "@tools/fuzz/Corpus";
import type { CorpusEntry, FuzzCase, Outcome } from "@tools/fuzz/FuzzCase";

/** An expression case, as the generator would produce one. */
function expressionCase(source: string): FuzzCase {
	return { kind: "expression", source };
}

/** The outcome the soak supervisor synthesises when a child stops answering. */
function hangOutcome(generator = "expression"): Outcome {
	return { kind: "hang", elapsedMs: 0, detail: `no progress for 5000ms during ${generator} soak` };
}

/** A corpus entry for a case, with a status chosen by the caller. */
function entryFor(input: FuzzCase, outcome: Outcome, status: CorpusEntry["status"]): CorpusEntry {
	return { ...makeEntry({ seed: 1, generator: "expression", outcome, input, shrinkSteps: 0 }), status };
}

const temporaryDirectories: string[] = [];

/** A corpus directory of this test's own, removed when the file finishes. */
function temporaryCorpus(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "solve-fuzz-corpus-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterAll(() => {
	for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

describe("failure signatures", () => {
	test("two hanging inputs are two findings, even though the wording is identical", () => {
		const first = expressionCase("gcd(4, arccos(2))");
		const second = expressionCase("lcm(1/0, 2)");
		const outcome = hangOutcome();

		expect(outcome.detail).toBe(hangOutcome().detail);
		expect(failureSignature(outcome, first)).not.toBe(failureSignature(outcome, second));
	});

	test("a crash is signed by its input too, for the same reason", () => {
		const outcome: Outcome = { kind: "crash", elapsedMs: 0, detail: "child died with exit code 134 during bytecode soak" };
		const first: FuzzCase = { kind: "bytecode", program: { opcodes: [1, 2, 3], numbers: [], strings: [] } };
		const second: FuzzCase = { kind: "bytecode", program: { opcodes: [4, 5, 6], numbers: [], strings: [] } };

		expect(failureSignature(outcome, first)).not.toBe(failureSignature(outcome, second));
	});

	test("one hanging input signs the same way however the supervisor words it", () => {
		// The wording belongs to whoever watched the child die, and it changes
		// when the timeout or the message does. Neither is a new finding.
		const input = expressionCase("gcd(4, arccos(2))");
		const signature = failureSignature(hangOutcome(), input);

		expect(failureSignature({ kind: "hang", detail: "hang during expression soak" }, input)).toBe(signature);
		expect(signature).toBe(`hang::${caseId(input)}`);
	});

	test("a failure that describes itself is still signed by its wording", () => {
		// The other half of the contract, unchanged: an error carries its own
		// identity, and the same error reached from another seed differs only in
		// the numbers and the quoted input it happens to name.
		const outcome = (detail: string): Outcome => ({ kind: "internal", elapsedMs: 0, code: "UNEXPECTED_ERROR", detail });
		const input = expressionCase("1 + 1");

		expect(failureSignature(outcome("raw exception at index 12"), input))
			.toBe(failureSignature(outcome("raw exception at index 4096"), expressionCase("2 + 2")));
		expect(failureSignature(outcome("raw exception at index 12"), input))
			.not.toBe(failureSignature(outcome("raw exception reading 'unit'"), input));
	});
});

describe("the set of signatures a run is allowed to skip", () => {
	const input = expressionCase("gcd(4, arccos(2))");

	test("an open entry stands for a finding that may recur", () => {
		const known = knownOpenSignatures([entryFor(input, hangOutcome(), "open")]);

		expect(known.has(failureSignature(hangOutcome(), input))).toBe(true);
	});

	test("a fixed entry stands for nothing", () => {
		// The bug this file exists for. A `fixed` entry is a bug that is supposed
		// to be gone, so it must not answer for anything that happens now.
		const known = knownOpenSignatures([entryFor(input, hangOutcome(), "fixed")]);

		expect(known.size).toBe(0);
	});
});

describe("recording a finding", () => {
	test("a second hang joins the first rather than being mistaken for it", () => {
		const directory = temporaryCorpus();
		const first = expressionCase("gcd(4, arccos(2))");
		const second = expressionCase("lcm(1/0, 2)");

		expect(saveEntry(directory, entryFor(first, hangOutcome(), "open"))).toBe(true);
		expect(saveEntry(directory, entryFor(second, hangOutcome(), "open"))).toBe(true);

		const stored = loadCorpus(directory);
		expect(stored.map((entry) => (entry.input as { source: string }).source).sort())
			.toEqual([first, second].map((entry) => (entry as { source: string }).source).sort());
	});

	test("the same case is not recorded twice", () => {
		const directory = temporaryCorpus();
		const input = expressionCase("gcd(4, arccos(2))");

		expect(saveEntry(directory, entryFor(input, hangOutcome(), "open"))).toBe(true);
		expect(saveEntry(directory, entryFor(input, hangOutcome(), "open"))).toBe(false);
		expect(loadCorpus(directory)).toHaveLength(1);
	});
});
