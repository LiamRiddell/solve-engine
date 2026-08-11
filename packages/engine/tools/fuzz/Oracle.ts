/**
 * What "broken" means, in one place.
 *
 * A fuzzer is only as good as its oracle. The generators here can produce
 * anything, and almost all of it is illegal input, so "it errored" is not
 * evidence of a bug: reaching an error is the correct outcome for a corrupt
 * opcode stream. What is never correct is the engine taking the host down with
 * it, sitting there forever, or throwing something the host cannot catch by
 * type.
 *
 * Two of those three cannot be observed from inside the process that is
 * suffering them, which is why this module reports only what it can see (a
 * throw, a leaked internal error, a slow case) and the parent orchestrator in
 * `scripts/fuzz.mjs` supplies the other two from the outside.
 *
 * @module Oracle
 */

import { EngineError } from "@solve-js/errors/EngineError";
import { createVM, executeBytecode, type Bytecode } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import { resetAllocationTracking } from "@solve-js/vm/AllocationBudget";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { UserFunctionDef, AnonymousBodyDef, BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import type { FuzzCase, Outcome, SerializedBody, SerializedProgram } from "@tools/fuzz/FuzzCase";

/**
 * The VM limits a fuzz run executes under.
 *
 * Defaults to what `createVM()` ships, because the point is to test the
 * configuration real hosts get. The fields exist so the bounded Jest run can
 * tighten them: a suite that shares its process with every other spec should
 * not be able to materialise two million elements even in principle.
 */
export interface OracleLimits {
	maxStackDepth?: number;
	maxInstructions?: number;
	maxFunctionRecursionDepth?: number;
	maxCollectionSize?: number;
	maxAllocatedElements?: number;
}

/** How the oracle should judge a case. */
export interface OracleOptions {
	/** VM ceilings for bytecode cases. */
	limits?: OracleLimits;
	/**
	 * Wall-clock milliseconds above which a completed case is reported `slow`.
	 *
	 * Distinct from the parent's hang timeout, which kills. A case that takes a
	 * second and finishes is not a hang, but it is a denial-of-service lead,
	 * and it is the shape a real hang starts out as.
	 */
	slowMs?: number;
}

/** Whether a thrown value satisfies the engine's "everything is an EngineError" contract. */
function isEngineError(thrown: unknown): boolean {
	if (thrown instanceof EngineError) return true;
	// Duck-typed fallback. A bundled fuzz run and the Jest run load the error
	// module by different paths, and a second copy of the class would make
	// every throw look like a violation, which is the one false positive that
	// would make this whole tool untrustworthy.
	const candidate = thrown as { name?: unknown; code?: unknown; category?: unknown } | null;
	return (
		candidate !== null &&
		typeof candidate === "object" &&
		candidate.name === "EngineError" &&
		typeof candidate.code === "string" &&
		typeof candidate.category === "string"
	);
}

/**
 * Error codes that mean a raw JavaScript exception was caught and relabelled.
 *
 * `executeBytecode()` wraps its whole dispatch loop and normalises anything
 * that escapes, so a genuine `TypeError` from a real bug does not reach the
 * host as a `TypeError`. It reaches it as an EngineError carrying one of these
 * codes, which is inside the contract but is still the engine saying "I did not
 * expect this". Worth finding, so it is reported, but it does not fail the hard
 * invariant. See `errors/EngineError.ts`'s `normalizeUnknownError()`.
 */
const LEAKED_EXCEPTION_CODES: ReadonlySet<string> = new Set(["UNEXPECTED_ERROR", "UNKNOWN_ERROR"]);

/** Rebuild a runnable body side-table entry from its stored form. */
function reviveBody(body: SerializedBody): UserFunctionDef & AnonymousBodyDef {
	return {
		name: body.name ?? "",
		params: body.params,
		program: reviveProgram(body.program),
	};
}

/**
 * Rebuild a runnable program from its stored form.
 *
 * @param program - The stored program.
 * @returns The same program with typed arrays, ready for `executeBytecode()`.
 */
export function reviveProgram(program: SerializedProgram): BytecodeProgram {
	return {
		opcodes: Uint8Array.from(program.opcodes.map((byte) => byte & 0xff)),
		numbers: Float64Array.from(program.numbers.map(Number)),
		strings: program.strings.slice(),
		hasAsync: false,
		userFunctionBodies: program.userFunctionBodies?.map(reviveBody),
		anonymousBodies: program.anonymousBodies?.map(reviveBody),
	};
}

/**
 * Drop the process-wide state a case can write to.
 *
 * Called before every case rather than after, so that a case which dies part
 * way through cannot leave the next one running against something it did not
 * ask for. Reproducing a corpus entry on its own has to give the same answer as
 * reaching it in the middle of a soak, or the corpus is fiction.
 */
function resetProcessState(): void {
	sharedGlobalVariableStore.clear();
	resetAllocationTracking();
}

/**
 * Run one bytecode case and classify what happened.
 *
 * @param program - The stored program to execute.
 * @param options - Limits and the slow threshold.
 * @returns What the VM did.
 */
export function runBytecodeCase(program: SerializedProgram, options: OracleOptions = {}): Outcome {
	const limits = options.limits ?? {};
	resetProcessState();
	const vm = createVM(
		sharedOpRegistry,
		limits.maxStackDepth,
		limits.maxInstructions,
		limits.maxFunctionRecursionDepth,
		limits.maxCollectionSize,
		limits.maxAllocatedElements,
	);
	const bytecode = reviveProgram(program) as Bytecode;

	const started = performance.now();
	try {
		const result = executeBytecode(bytecode, vm);
		const elapsedMs = performance.now() - started;

		if (result.type === "error") {
			const code = result.error.code;
			if (LEAKED_EXCEPTION_CODES.has(code)) {
				return {
					kind: "internal",
					elapsedMs,
					code,
					detail: `raw exception normalised to ${code}: ${result.error.message}`,
					stack: firstFrames(result.error.cause),
				};
			}
			return { kind: "ok", elapsedMs, code, detail: `EngineError ${code}` };
		}

		// A pending result means an async plugin function was reached. That is a
		// legitimate outcome of a CALL_PLUGIN opcode and not something to judge,
		// but the promise must not be left to reject into nothing.
		if (result.type === "pending") {
			result.resolver.catch(() => undefined);
			return { kind: "ok", elapsedMs, detail: "pending async result" };
		}

		// Touch the value the way a host would. A Value the VM was happy to
		// build but that cannot be read is still a bug the host sees, and the
		// host is the one whose stack trace it lands in.
		const malformed = contractViolation(result.value);
		if (malformed) return { kind: "contract", elapsedMs, detail: malformed };
		return classifyDuration({ kind: "ok", elapsedMs, detail: "value" }, options);
	} catch (thrown) {
		const elapsedMs = performance.now() - started;
		if (isEngineError(thrown)) {
			// A throw that IS an EngineError still escaped a function documented
			// to return its errors, so it is worth naming, but it is inside the
			// contract the task set.
			const engineError = thrown as EngineError;
			return { kind: "ok", elapsedMs, code: engineError.code, detail: `threw EngineError ${engineError.code}` };
		}
		return describeThrow(thrown, elapsedMs);
	}
}

/**
 * Run one expression case through a real engine and classify what happened.
 *
 * @param source - The generated source line.
 * @param engine - A reusable engine. Cleared before the case runs, so reaching
 * this case in the middle of a soak and replaying it alone give the same
 * answer.
 * @param options - The slow threshold. VM limits come from the engine's config.
 * @returns What the pipeline did.
 */
export function runExpressionCase(source: string, engine: ExpressionEngine, options: OracleOptions = {}): Outcome {
	resetProcessState();
	engine.clear();

	const started = performance.now();
	try {
		const values = engine.evaluateExpression(source);
		const elapsedMs = performance.now() - started;
		for (const value of values) {
			const malformed = contractViolation(value);
			if (malformed) return { kind: "contract", elapsedMs, detail: malformed };
		}
		return classifyDuration({ kind: "ok", elapsedMs, detail: "value" }, options);
	} catch (thrown) {
		const elapsedMs = performance.now() - started;
		if (isEngineError(thrown)) {
			const engineError = thrown as EngineError;
			if (LEAKED_EXCEPTION_CODES.has(engineError.code)) {
				return {
					kind: "internal",
					elapsedMs,
					code: engineError.code,
					detail: `raw exception normalised to ${engineError.code}: ${engineError.message}`,
					stack: firstFrames(engineError.cause),
				};
			}
			return classifyDuration({ kind: "ok", elapsedMs, code: engineError.code, detail: `EngineError ${engineError.code}` }, options);
		}
		return describeThrow(thrown, elapsedMs);
	}
}

/**
 * Whether a returned Value is something a host can actually use.
 *
 * Checked explicitly rather than by touching the object and catching whatever
 * comes back, because the two say different things. A caught TypeError names
 * this file in its stack trace and reads like a bug in the fuzzer. An explicit
 * check names the engine, which is where the fault is: `EvalResult`'s `value`
 * arm declares a `Value`, and anything else is the engine breaking its own
 * declared return type.
 *
 * @param value - Whatever came back in the `value` arm.
 * @returns A description of what is wrong with it, or `null` when it is usable.
 */
function contractViolation(value: unknown): string | null {
	if (value === undefined || value === null) {
		return `executeBytecode returned {type:'value'} whose value is ${String(value)}, which EvalResult declares impossible`;
	}
	const candidate = value as { type?: unknown; toNumber?: unknown };
	if (typeof candidate.type !== "number") {
		return `returned a value whose .type is ${typeof candidate.type}, not a ValueType`;
	}
	if (typeof candidate.toNumber !== "function") {
		return "returned a value with no toNumber(), so it is not a Value";
	}
	try {
		void (candidate.toNumber as () => number).call(candidate);
	} catch (thrown) {
		return `returned a Value whose toNumber() throws: ${describeBriefly(thrown)}`;
	}
	return null;
}

/** A short rendering of a thrown value, for a one-line detail field. */
function describeBriefly(thrown: unknown): string {
	return thrown instanceof Error ? `${thrown.constructor.name}: ${thrown.message}` : String(thrown);
}

/** Build the outcome for a throw that broke the contract. */
function describeThrow(thrown: unknown, elapsedMs: number): Outcome {
	const name = thrown instanceof Error ? thrown.constructor.name : typeof thrown;
	const message = thrown instanceof Error ? thrown.message : String(thrown);
	return {
		kind: "throw",
		elapsedMs,
		thrownName: name,
		detail: `${name}: ${message}`,
		stack: firstFrames(thrown),
	};
}

/** Promote a completed outcome to `slow` when it took too long. */
function classifyDuration(outcome: Outcome, options: OracleOptions): Outcome {
	const slowMs = options.slowMs ?? 0;
	if (slowMs > 0 && outcome.elapsedMs > slowMs && outcome.kind === "ok") {
		return { ...outcome, kind: "slow", detail: `${outcome.detail}, took ${outcome.elapsedMs.toFixed(1)}ms` };
	}
	return outcome;
}

/**
 * The top of a stack trace, trimmed to what names a source location.
 *
 * A full V8 trace through a bundled fuzz build is mostly noise, and the corpus
 * has to stay readable. Four frames is enough to say which file and which
 * function, which is what the report needs.
 */
function firstFrames(thrown: unknown): string | undefined {
	const stack = (thrown as { stack?: unknown } | null)?.stack;
	if (typeof stack !== "string") return undefined;
	return stack.split("\n").slice(0, 5).join("\n");
}

/**
 * Run one case of either kind.
 *
 * @param fuzzCase - The case to run.
 * @param engine - Needed only for expression cases.
 * @param options - Limits and the slow threshold.
 * @returns What happened.
 */
export function runCase(fuzzCase: FuzzCase, engine: ExpressionEngine | null, options: OracleOptions = {}): Outcome {
	if (fuzzCase.kind === "bytecode") return runBytecodeCase(fuzzCase.program, options);
	if (!engine) throw new Error("an expression case needs an engine");
	return runExpressionCase(fuzzCase.source, engine, options);
}
