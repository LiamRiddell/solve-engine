/**
 * Reducing a failure to the smallest input that still causes it.
 *
 * An unshrunk finding is close to worthless. A four-hundred-opcode stream that
 * kills the process tells you that something in four hundred opcodes is wrong,
 * which is where you already were. The same failure reduced to three opcodes
 * names the bug.
 *
 * The strategy is the standard greedy one: propose a smaller candidate, keep it
 * if it still fails, repeat until a whole pass proposes nothing that sticks.
 * Chunk removal runs before single-element removal, because removing half a
 * program in one step is worth a hundred single-step removals and the failures
 * that matter usually survive it.
 *
 * "Still fails" is deliberately strict. A candidate that fails a DIFFERENT way
 * is not a smaller version of this finding, it is a second finding, and
 * accepting it would let the shrinker wander off into an unrelated bug and
 * report that instead. So the predicate compares the outcome kind, and for a
 * throw, the thrown constructor's name too.
 *
 * @module Shrink
 */

import type { DocumentCase, FuzzCase, Outcome, SerializedBody, SerializedProgram } from "@tools/fuzz/FuzzCase";

/**
 * Whether a candidate still reproduces the failure being shrunk.
 *
 * Injected rather than fixed, because the two kinds of failure need different
 * machinery to observe. A throw can be checked in this process. A crash or a
 * hang can only be checked by starting another one, so the caller passes a
 * predicate that spawns.
 */
export type ShrinkPredicate = (candidate: FuzzCase) => boolean;

/** What a shrink run produced. */
export interface ShrinkResult {
	/** The smallest input found that still fails. */
	input: FuzzCase;
	/** How many candidates were accepted. A reader uses this to judge how minimal the result is. */
	steps: number;
	/** How many candidates were tried in total, accepted or not. */
	attempts: number;
}

/** Bound on predicate calls, so a subprocess-backed shrink cannot run for an hour. */
const DEFAULT_MAX_ATTEMPTS = 2500;

/**
 * Whether two outcomes are the same failure.
 *
 * @param a - The outcome the shrink started from.
 * @param b - A candidate's outcome.
 * @returns True when the candidate is a smaller version of the same finding.
 */
export function sameFailure(a: Outcome, b: Outcome): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === "throw") return a.thrownName === b.thrownName;
	if (a.kind === "internal") return a.code === b.code;
	// A contract violation has no code to compare, and the two shapes it takes
	// (a missing value, an unreadable one) are different bugs, so the wording is
	// what distinguishes them.
	if (a.kind === "contract") return a.detail === b.detail;
	// A disagreement has neither a code nor a thrown name, and reducing it must
	// not be allowed to drift onto a different wrong answer, so the two answers
	// themselves are what has to match. The line number is deliberately not part
	// of it: dropping a line above the fault renumbers it without changing what
	// went wrong, and requiring it to hold still would stop the shrink at the
	// first useful reduction.
	if (a.kind === "disagreement") return answersOf(a.detail) === answersOf(b.detail);
	return true;
}

/**
 * The two answers named in a disagreement's description, without the position.
 *
 * The description is built in one place ({@link runDocumentCase}) and always
 * ends with the settled answer and the edited one, so reading them back out is
 * cheaper and less brittle than threading a structured outcome through a
 * protocol that has to survive JSON and a subprocess.
 */
function answersOf(detail: string): string {
	const at = detail.indexOf(": a settled pass says ");
	return at === -1 ? detail : detail.slice(at);
}

/** How big a case is, for reporting and for deciding when to stop. */
export function caseSize(fuzzCase: FuzzCase): number {
	if (fuzzCase.kind === "expression") return fuzzCase.source.length;
	// A session is counted in lines and actions rather than characters. What
	// makes a document reproduction hard to read is how many things are
	// happening, not how long the lines are.
	if (fuzzCase.kind === "document") return fuzzCase.lines.length + fuzzCase.actions.length;
	return programSize(fuzzCase.program);
}

/** How big a program is, counting everything a reader would have to read. */
function programSize(program: SerializedProgram): number {
	let size = program.opcodes.length + program.numbers.length + program.strings.length;
	for (const body of program.userFunctionBodies ?? []) size += 1 + programSize(body.program);
	for (const body of program.anonymousBodies ?? []) size += 1 + programSize(body.program);
	return size;
}

/**
 * Instruction start offsets, from a fixed one-byte-per-opcode walk.
 *
 * Deliberately NOT the engine's operand-width table. A stream being shrunk is
 * corrupt by definition, so its framing is whatever the VM's `ip` happens to
 * do, and reducing at boundaries the engine would compute gives up on every
 * case whose framing is the bug. Reducing at every byte is simpler and finds
 * the smaller answer, at the cost of more attempts.
 */
function byteOffsets(length: number): number[] {
	const offsets: number[] = [];
	for (let i = 0; i < length; i++) offsets.push(i);
	return offsets;
}

/** Every smaller candidate worth trying for a program, largest reduction first. */
function* programCandidates(program: SerializedProgram): Generator<SerializedProgram> {
	const { opcodes, numbers, strings } = program;

	// Chunk removal, halving down to single bytes. This is where most of the
	// reduction comes from.
	for (let size = Math.max(1, opcodes.length >> 1); size >= 1; size >>= 1) {
		for (let start = 0; start + size <= opcodes.length; start += size) {
			yield { ...program, opcodes: [...opcodes.slice(0, start), ...opcodes.slice(start + size)] };
		}
		if (size === 1) break;
	}

	// Keep only a prefix, which is the shape most stream bugs reduce to.
	for (const cut of [opcodes.length >> 1, opcodes.length >> 2, 3, 2, 1]) {
		if (cut > 0 && cut < opcodes.length) yield { ...program, opcodes: opcodes.slice(0, cut) };
	}

	// Neutralise one byte at a time. A byte that can be zeroed without changing
	// the failure was not part of it.
	for (const at of byteOffsets(opcodes.length)) {
		if (opcodes[at] !== 0) {
			const reduced = opcodes.slice();
			reduced[at] = 0;
			yield { ...program, opcodes: reduced };
		}
	}

	// Shrink the constant pools, then simplify what is left in them. A pool
	// entry that can be replaced by "0" or "" was not part of the failure.
	if (numbers.length > 0) yield { ...program, numbers: numbers.slice(0, numbers.length - 1) };
	if (strings.length > 0) yield { ...program, strings: strings.slice(0, strings.length - 1) };
	for (let i = 0; i < numbers.length; i++) {
		if (numbers[i] === "0") continue;
		const reduced = numbers.slice();
		reduced[i] = "0";
		yield { ...program, numbers: reduced };
	}
	for (let i = 0; i < strings.length; i++) {
		if (strings[i] === "") continue;
		const reduced = strings.slice();
		reduced[i] = "";
		yield { ...program, strings: reduced };
	}

	// Drop the side tables, then shrink them one entry at a time, then shrink
	// each surviving entry's own program.
	if (program.userFunctionBodies) {
		yield { ...program, userFunctionBodies: undefined };
		yield* bodyCandidates(program, "userFunctionBodies");
	}
	if (program.anonymousBodies) {
		yield { ...program, anonymousBodies: undefined };
		yield* bodyCandidates(program, "anonymousBodies");
	}
}

/** Smaller candidates that differ only inside one of the two body side tables. */
function* bodyCandidates(
	program: SerializedProgram,
	field: "userFunctionBodies" | "anonymousBodies",
): Generator<SerializedProgram> {
	const bodies = program[field];
	if (!bodies) return;
	for (let i = 0; i < bodies.length; i++) {
		yield { ...program, [field]: [...bodies.slice(0, i), ...bodies.slice(i + 1)] };
	}
	for (let i = 0; i < bodies.length; i++) {
		const body = bodies[i];
		if (body.params.length > 0) {
			yield { ...program, [field]: replaceAt(bodies, i, { ...body, params: body.params.slice(0, -1) }) };
		}
		for (const smaller of programCandidates(body.program)) {
			yield { ...program, [field]: replaceAt(bodies, i, { ...body, program: smaller }) };
		}
	}
}

/** A copy of an array with one entry replaced. */
function replaceAt(bodies: readonly SerializedBody[], index: number, body: SerializedBody): SerializedBody[] {
	const copy = bodies.slice();
	copy[index] = body;
	return copy;
}

/** Every smaller candidate worth trying for a source string, largest reduction first. */
function* sourceCandidates(source: string): Generator<string> {
	// Whole chunks, halving. Same reasoning as the opcode chunk pass.
	for (let size = Math.max(1, source.length >> 1); size >= 1; size >>= 1) {
		for (let start = 0; start + size <= source.length; start += size) {
			yield source.slice(0, start) + source.slice(start + size);
		}
		if (size === 1) break;
	}

	// Whitespace-separated pieces, which for a generated expression are roughly
	// its tokens, so removing one is a grammatically meaningful reduction.
	const pieces = source.split(/(\s+)/);
	for (let i = 0; i < pieces.length; i++) {
		if (pieces[i].trim() === "") continue;
		yield [...pieces.slice(0, i), ...pieces.slice(i + 1)].join("");
	}

	// Simplify what survives: long numbers to one digit, long identifiers to one
	// letter, long repeats to a shorter repeat.
	const simplified = source
		.replace(/\d{2,}/g, "1")
		.replace(/[A-Za-z_]{4,}/g, (word) => word.slice(0, 3));
	if (simplified !== source) yield simplified;

	const collapsed = source.replace(/(.)\1{3,}/g, "$1$1$1");
	if (collapsed !== source) yield collapsed;
	yield source.trim();
}

/**
 * Every smaller session worth trying, largest reduction first.
 *
 * Actions before lines, because dropping an action removes a whole step of the
 * history and is what turns a ten-action session into the one edit that
 * mattered. Lines come after, and removing one shifts every action below it,
 * which is why the positions are renumbered here rather than left to the
 * replay: an action left pointing at the old position is a different session,
 * and a shrinker that quietly changes the case it is reducing proves nothing.
 *
 * A position never goes below one. Removing the first line would otherwise
 * shift an action onto line zero, which is not a position a host can ask for.
 */
function* documentCandidates(fuzzCase: DocumentCase): Generator<DocumentCase> {
	const { lines, actions } = fuzzCase;

	for (let i = actions.length - 1; i >= 0; i--) {
		yield { ...fuzzCase, actions: actions.filter((_, k) => k !== i) };
	}

	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines.length <= 2) break;
		yield {
			...fuzzCase,
			lines: lines.filter((_, k) => k !== i),
			actions: actions.map((action) => ({
				...action,
				at: Math.max(1, action.at > i ? action.at - 1 : action.at),
			})),
		};
	}
}

/** Every smaller candidate for any kind of case. */
function* candidates(fuzzCase: FuzzCase): Generator<FuzzCase> {
	if (fuzzCase.kind === "document") {
		const original = caseSize(fuzzCase);
		for (const candidate of documentCandidates(fuzzCase)) {
			if (caseSize(candidate) < original) yield candidate;
		}
		return;
	}
	if (fuzzCase.kind === "expression") {
		for (const source of sourceCandidates(fuzzCase.source)) {
			if (source.length < fuzzCase.source.length) yield { kind: "expression", source };
		}
		return;
	}
	const original = programSize(fuzzCase.program);
	for (const program of programCandidates(fuzzCase.program)) {
		if (programSize(program) < original) yield { kind: "bytecode", program, origin: fuzzCase.origin };
	}
}

/**
 * Reduce a failing case to the smallest input that fails the same way.
 *
 * @param failing - The case as found.
 * @param stillFails - Whether a candidate reproduces the same failure.
 * @param maxAttempts - Bound on predicate calls. The default is generous for an
 * in-process predicate and roughly two minutes for a subprocess one.
 * @returns The reduced case and how much work it took.
 */
export function shrink(
	failing: FuzzCase,
	stillFails: ShrinkPredicate,
	maxAttempts = DEFAULT_MAX_ATTEMPTS,
): ShrinkResult {
	let best = failing;
	let steps = 0;
	let attempts = 0;
	let improved = true;

	while (improved && attempts < maxAttempts) {
		improved = false;
		for (const candidate of candidates(best)) {
			if (attempts >= maxAttempts) break;
			attempts++;
			if (!stillFails(candidate)) continue;
			best = candidate;
			steps++;
			improved = true;
			// Restart from the new, smaller case. Continuing to iterate a
			// generator built from the old one would propose reductions at
			// offsets that no longer mean anything.
			break;
		}
	}

	return { input: best, steps, attempts };
}
