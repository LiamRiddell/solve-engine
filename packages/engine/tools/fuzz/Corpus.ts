/**
 * The committed record of everything the fuzzer has ever found.
 *
 * A fuzz run that finds a bug and then forgets it has bought nothing: the next
 * run uses different seeds and the fix is never checked again. The corpus is
 * what turns a finding into a regression test. Each entry is a file, each file
 * is committed, and `__tests__/fuzz/FuzzCorpus.spec.ts` replays every one of
 * them on every ordinary test run.
 *
 * Entries are content-addressed so the same finding cannot land twice under two
 * names, which matters because a soak run reaches the same shallow bug from
 * many different seeds.
 *
 * @module Corpus
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { CorpusEntry, FuzzCase, Outcome } from "@tools/fuzz/FuzzCase";

/**
 * A short, stable name for a case's content.
 *
 * FNV-1a, because the only requirements are determinism and a low enough
 * collision rate for a directory holding tens of files. Nothing here is
 * adversarial: the inputs are the fuzzer's own output.
 */
function contentHash(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/**
 * The identity of a case, independent of how it was found.
 *
 * Derived from the input alone, deliberately: two runs that reach the same
 * reduced input from different seeds found the same bug, and the corpus should
 * hold one entry for it rather than two.
 *
 * @param fuzzCase - The reduced case.
 * @returns An eight-character identifier.
 */
export function caseId(fuzzCase: FuzzCase): string {
	// Only what actually runs. A bytecode case also carries the expression it
	// was mutated from, which is provenance rather than input: two identical
	// opcode streams that reached the same bug from different starting points
	// are one finding, and hashing the origin would file them as two.
	const executable = fuzzCase.kind === "bytecode"
		? { kind: fuzzCase.kind, program: fuzzCase.program }
		: fuzzCase;
	return contentHash(JSON.stringify(executable));
}

/**
 * The kinds that are observed from outside the process suffering them.
 *
 * A crash is an exit code and a hang is a heartbeat that stopped advancing.
 * Neither carries what a failure normally carries: there is no thrown value, no
 * error code and no stack, because whatever would have produced one is dead. So
 * everything the supervisor can write about them is the same sentence every
 * time, and the sentence is about the supervisor rather than about the case.
 */
const OBSERVED_FROM_OUTSIDE: ReadonlySet<string> = new Set(["crash", "hang"]);

/**
 * The signature the bounded run matches a failure against.
 *
 * Kind plus wording, because those are the two things that stay the same when
 * the same bug is reached from a different seed, and the two things that change
 * when it is a different bug. Numbers are stripped: the same failure carries a
 * different index or count each time it is reached, and matching on those would
 * make every recurrence look new.
 *
 * A crash and a hang are signed by their input instead, because their wording
 * distinguishes nothing (see {@link OBSERVED_FROM_OUTSIDE}). That is a weaker
 * dedupe than the wording gives the other kinds: two inputs that hang for the
 * same underlying reason are two signatures until they shrink to the same case.
 * It is the right way round. A soak that files one hang twice has spent a
 * shrink; a soak that mistakes the second hang for the first has lost it. The
 * second is not hypothetical: on 2026-08-11 a run found that `gcd(4, arccos(2))`
 * never returned and threw the finding away, because an unrelated hang recorded
 * the day before already carried the sentence "hang during expression soak".
 *
 * @param outcome - Kind and detail of a failure.
 * @param input - The case that produced it, which is all that tells one crash
 * or hang from another.
 * @returns A comparable string.
 */
export function failureSignature(outcome: { kind: string; detail: string }, input: FuzzCase): string {
	if (OBSERVED_FROM_OUTSIDE.has(outcome.kind)) return `${outcome.kind}::${caseId(input)}`;
	const normalised = outcome.detail
		// The value a conversion refused is the input, not the bug. Every
		// non-numeric string reaching `BigInt()` is one finding, and leaving the
		// value in would file it as several hundred.
		.replace(/Cannot convert .* to a BigInt/, "Cannot convert <value> to a BigInt")
		// Quoted fragments are almost always the offending input for the same
		// reason. The property name in "reading 'x'" is deliberately NOT quoted
		// in V8's wording with double quotes, so it survives this and stays part
		// of the signature, which is right: a different property is a different
		// bug.
		.replace(/"[^"]*"/g, '"..."')
		.replace(/-?\d[\d.,e+]*/gi, "N");
	return `${outcome.kind}::${normalised}`;
}

/** The signature of a stored finding. */
function entrySignature(entry: CorpusEntry): string {
	return failureSignature({ kind: entry.outcome, detail: entry.detail }, entry.input);
}

/**
 * Signatures of the findings that are recorded and not yet fixed.
 *
 * The bounded Jest run uses this to tell a known bug from a new one. Without
 * it, an unfixed finding leaves the suite red forever, and a suite that is
 * always red is a suite nobody reads. With it, the suite says exactly one
 * thing: something is failing that the corpus does not already know about.
 *
 * The soak uses it for the same question, and both of them must ask it of the
 * open entries only. A `fixed` entry is a bug that is supposed to be gone: it
 * stands for nothing that is allowed to happen now, so letting it answer "yes,
 * known" silences a live finding on the strength of a dead one.
 *
 * @param entries - A loaded corpus.
 * @returns The signatures to tolerate.
 */
export function knownOpenSignatures(entries: readonly CorpusEntry[]): ReadonlySet<string> {
	const signatures = new Set<string>();
	for (const entry of entries) {
		if (entry.status !== "open") continue;
		signatures.add(entrySignature(entry));
	}
	return signatures;
}

/** The file a given entry lives in. */
function entryPath(directory: string, entry: CorpusEntry): string {
	return path.join(directory, `${entry.generator}-${entry.outcome}-${entry.id}.json`);
}

/**
 * Every entry in a corpus directory.
 *
 * A missing directory returns an empty list rather than throwing, so a fresh
 * checkout that has never found anything still runs the replay suite.
 *
 * @param directory - Where the corpus lives.
 * @returns The entries, sorted by file name so a run's output is stable.
 */
export function loadCorpus(directory: string): CorpusEntry[] {
	if (!fs.existsSync(directory)) return [];
	const entries: CorpusEntry[] = [];
	for (const file of fs.readdirSync(directory).sort()) {
		if (!file.endsWith(".json")) continue;
		const raw = fs.readFileSync(path.join(directory, file), "utf8");
		entries.push(JSON.parse(raw) as CorpusEntry);
	}
	return entries;
}

/**
 * Record a finding, keeping one smallest reproducer per distinct failure.
 *
 * A soak reaches the same shallow bug from thousands of seeds, and every one of
 * them shrinks to something similar. Writing all of them would produce a corpus
 * of five hundred files testing eight things, which is slower to replay and
 * much harder to read. So an entry whose failure signature is already recorded
 * replaces the existing one only when its input is smaller, and is otherwise
 * dropped.
 *
 * @param directory - Where the corpus lives. Created if absent.
 * @param entry - The finding, already shrunk.
 * @returns True when the corpus changed.
 */
export function saveEntry(directory: string, entry: CorpusEntry): boolean {
	fs.mkdirSync(directory, { recursive: true });
	const signature = entrySignature(entry);

	for (const existing of loadCorpus(directory)) {
		if (existing.id === entry.id) return false;
		if (entrySignature(existing) !== signature) continue;
		if (inputSize(existing.input) <= inputSize(entry.input)) return false;
		// The new one is smaller, so it replaces the old file rather than joining
		// it. A hand-written `note` or a `status` flip is the one thing worth
		// carrying across, since that is a human's work rather than the fuzzer's.
		fs.rmSync(entryPath(directory, existing), { force: true });
		entry = { ...entry, status: existing.status, note: existing.note ?? entry.note };
		break;
	}

	fs.writeFileSync(entryPath(directory, entry), `${JSON.stringify(entry, null, "\t")}\n`, "utf8");
	return true;
}

/** How big an input is, for deciding which of two reproducers to keep. */
function inputSize(fuzzCase: FuzzCase): number {
	if (fuzzCase.kind === "expression") return fuzzCase.source.length;
	const { opcodes, numbers, strings } = fuzzCase.program;
	return opcodes.length + numbers.length + strings.length;
}

/**
 * Build a corpus entry from a finding.
 *
 * @param options - Everything known about the finding at the point it was reduced.
 * @returns The entry, ready to save.
 */
export function makeEntry(options: {
	seed: number;
	generator: string;
	outcome: Outcome;
	input: FuzzCase;
	shrinkSteps: number;
	note?: string;
}): CorpusEntry {
	return {
		id: caseId(options.input),
		seed: options.seed,
		generator: options.generator,
		outcome: options.outcome.kind,
		detail: options.outcome.detail,
		found: new Date().toISOString().slice(0, 10),
		shrinkSteps: options.shrinkSteps,
		input: options.input,
		// Everything arrives open. A human decides, after reading the engine
		// source, whether the finding is fixed, and flips the field by hand. A
		// tool that marked its own findings fixed would be marking them fixed
		// whenever the symptom moved rather than whenever the bug went away.
		status: "open",
		note: options.note,
	};
}
