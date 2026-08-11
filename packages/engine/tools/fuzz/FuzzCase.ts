/**
 * What a fuzz case is, on disk and in flight.
 *
 * The two fuzzers generate very different things (an opcode stream, a string of
 * source), but everything downstream of generation treats them the same: the
 * oracle runs one, the shrinker reduces one, the corpus stores one, and the
 * Jest replay reads one back. So they share a serialisable shape, and the rest
 * of the machinery is written once.
 *
 * Everything here is plain JSON. A corpus entry has to survive being read by a
 * process that was not the one that wrote it, and typed arrays do not survive
 * `JSON.stringify` in any form worth reading, so opcode streams are stored as
 * number arrays and rebuilt on the way into the VM.
 *
 * @module FuzzCase
 */

/**
 * A bytecode program in a form that survives JSON.
 *
 * Mirrors `parser/BytecodeBuilder.ts`'s `BytecodeProgram`, minus the fields the
 * VM does not read (`constants`, `hasAsync`), and with the two typed arrays
 * flattened to ordinary arrays. `numbers` is stored as strings rather than
 * numbers, because `NaN` and both infinities are exactly the values a numeric
 * fuzzer cares about and `JSON.stringify` turns all three into `null`.
 */
export interface SerializedProgram {
	/** Opcode and operand bytes, in stream order. Values outside 0-255 are truncated by `Uint8Array`, deliberately: that is what a real corrupt stream does. */
	opcodes: number[];
	/** The numeric constant pool, each entry as its `String()` form so NaN and Infinity round-trip. */
	numbers: string[];
	/** The string constant pool: identifiers, unit names, BigInt literals. */
	strings: string[];
	/** User-defined-function bodies this program's `DEFINE_USER_FUNCTION` operands index into. */
	userFunctionBodies?: SerializedBody[];
	/** map/reduce and bound-unknown transform bodies, indexed by `MAP_INVOKE`/`REDUCE_INVOKE`/`BIND_UNKNOWN`. */
	anonymousBodies?: SerializedBody[];
}

/**
 * One entry in a program's side table of nested bodies.
 *
 * The two side tables differ only in whether the entry carries a name, so one
 * shape covers both and the name is optional.
 */
export interface SerializedBody {
	/** Present for a user-defined function, absent for an anonymous map/reduce body. */
	name?: string;
	/** Parameter names, bound into a call frame before the body runs. */
	params: string[];
	/** The body's own compiled program, which may itself carry side tables. */
	program: SerializedProgram;
}

/** A case that feeds `executeBytecode()` directly, bypassing the parser. */
export interface BytecodeCase {
	kind: "bytecode";
	program: SerializedProgram;
	/**
	 * The expression the case was mutated from, when it came from the mutation
	 * generator rather than from thin air. Recorded because "this started life
	 * as `1+2`" is most of what a reader needs to understand a shrunk opcode
	 * stream.
	 */
	origin?: string;
}

/** A case that feeds a real `ExpressionEngine`, exercising the whole pipeline. */
export interface ExpressionCase {
	kind: "expression";
	/** The generated source line. */
	source: string;
}

/** Either kind of generated input. */
export type FuzzCase = BytecodeCase | ExpressionCase;

/**
 * How a case ended.
 *
 * The three the task cares about are `crash`, `hang` and `throw`. `internal` is
 * separated from `ok` because `executeBytecode()` catches everything and
 * normalises it, so a raw `TypeError` from a real bug arrives at the host
 * wearing an EngineError's clothes with the code `UNEXPECTED_ERROR`. That is
 * technically inside the contract and genuinely a finding, so it is reported
 * without failing the invariant.
 */
export type OutcomeKind =
	/** Completed, whether with a value or with a deliberate engine error. */
	| "ok"
	/** Threw something that was not an EngineError. A hard invariant violation. */
	| "throw"
	/**
	 * Returned successfully, with something its own return type says is
	 * impossible.
	 *
	 * Its own arm because it is the same failure as `throw` seen one frame
	 * later: the engine hands back a result the host cannot use, and the
	 * TypeError happens in the host's code rather than the engine's, which is
	 * worse than throwing, not better. Naming it separately keeps the report
	 * honest about where the exception actually came from.
	 */
	| "contract"
	/** Returned an EngineError whose code says a raw JS exception was caught and relabelled. */
	| "internal"
	/** Took longer than the soft budget but did finish. Reported, not failed. */
	| "slow"
	/** The process died. Only the parent can see this. */
	| "crash"
	/** The process stopped making progress. Only the parent can see this. */
	| "hang";

/** What running one case produced. */
export interface Outcome {
	kind: OutcomeKind;
	/** Wall-clock cost of the case, in milliseconds. */
	elapsedMs: number;
	/** A one-line description of what happened, for the report. */
	detail: string;
	/** The error's `code`, when there was one. */
	code?: string;
	/** The constructor name of whatever was thrown, for a `throw` outcome. */
	thrownName?: string;
	/** The first few frames of the stack, when there was one. Enough to name a source location. */
	stack?: string;
}

/** Outcomes that mean the case must be recorded and reported. */
const FAILING: ReadonlySet<OutcomeKind> = new Set<OutcomeKind>(["throw", "contract", "internal", "crash", "hang"]);

/**
 * Whether an outcome is a finding.
 *
 * One predicate rather than a comparison repeated at each call site, so that
 * adding an outcome kind cannot leave one of them behind.
 *
 * @param outcome - The outcome to classify.
 * @returns True when the case belongs in the corpus and in the report.
 */
export function isFailure(outcome: Outcome): boolean {
	return FAILING.has(outcome.kind);
}

/**
 * A finding, as it is stored in the corpus and replayed by the Jest suite.
 *
 * Both the seed and the concrete input are recorded. The seed is provenance:
 * it says which soak run and which generator produced this, and it is what a
 * reader passes to `npm run fuzz -- --seed=N` to watch it happen again. The
 * concrete input is what the replay actually uses, because a generator that
 * gains a new production shifts every seed after it, and a regression corpus
 * that silently stops testing the thing it was written for is worse than none.
 */
export interface CorpusEntry {
	/** Stable identifier, also the file name. Derived from the case so the same finding does not land twice. */
	id: string;
	/** The seed the generator was given. */
	seed: number;
	/** Which generator produced it. */
	generator: string;
	/** How it failed when it was found. */
	outcome: OutcomeKind;
	/** The failure's one-line description, as recorded at discovery. */
	detail: string;
	/** ISO date it was first recorded. */
	found: string;
	/** How many shrink steps reduced it, for a reader judging how minimal it is. */
	shrinkSteps: number;
	/** The reduced input. This is what the replay runs. */
	input: FuzzCase;
	/**
	 * What the engine should do with this input now.
	 *
	 * `fixed` means the bug is gone and the replay asserts the invariant holds,
	 * which is the state a corpus entry should end up in. `open` means the
	 * finding stands and the replay asserts only that the outcome has not got
	 * worse, so an unfixed bug does not leave the suite red forever while still
	 * failing loudly if it turns into a crash.
	 */
	status: "open" | "fixed";
	/** Free-text note from whoever triaged it. */
	note?: string;
}
