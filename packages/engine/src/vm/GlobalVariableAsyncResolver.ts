import type { QueryClient } from "@tanstack/query-core";
import type { Token } from "@solve-js/lexer";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import type { Value } from "@solve-js/vm/Value";
import type { IAsyncResolver, AsyncCheckResult } from "@solve-js/resolvers/ResolverRegistry";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import { nextInstruction } from "@solve-js/parser/OperandWidth";

/**
 * Async resolver for `global :name` reads that aren't yet known, i.e. no
 * currently-loaded document has run `global :name = value` for this name.
 *
 * Plugs into the engine's EXISTING async-resolution pipeline (the same one
 * CurrencyAsyncResolver/OsrsAsyncResolver use for currency rates and OSRS
 * prices): `preflight()` runs BEFORE the VM, and if a referenced global is
 * missing, returns an `AsyncCheckResult`, the engine immediately shows a
 * Pending value and, when the returned promise resolves, re-executes the
 * line via the same batching/DAG/event-stream machinery already built and
 * tested for currency. No new UI wiring is needed: `ExpressionResultWidget`
 * already renders Pending as a spinner.
 *
 * Unlike currency/OSRS, there is no network fetch here and no timeout
 * the promise for a missing name resolves the moment ANY loaded document
 * calls `global :name = value` (via GlobalVariableStore.subscribe()), and
 * simply stays pending forever if nothing ever does. This mirrors how an
 * unresolved external reference in a real spreadsheet behaves, and is the
 * deliberate design choice confirmed for this feature (no artificial
 * "give up and error" timer).
 */
export class GlobalVariableAsyncResolver implements IAsyncResolver {
	readonly namespace = "global-variables";

	/**
	 * Waits on a value another line declares, never on a network, so it keeps
	 * working when the host has switched live data off. See
	 * {@link IAsyncResolver.local}.
	 */
	readonly local = true;

	/**
	 * The scan below keys on the global read, so a program without one is
	 * never this resolver's and the engine need not ask. See
	 * {@link IAsyncResolver.watchedOpcodes}.
	 */
	readonly watchedOpcodes: readonly OpCode[] = [OpCode.LOAD_GLOBAL_VAR];

	/**
	 * In-flight (not-yet-resolved) promises, keyed by variable name.
	 *
	 * Without this, every re-evaluation of a still-pending line (every
	 * keystroke elsewhere in the document, every scroll, every unrelated
	 * evaluate() call) would call preflight() again and, without dedup
	 * create a BRAND NEW GlobalVariableStore subscription each time. Since
	 * "never declared" is an explicitly supported, indefinitely-pending
	 * outcome (no timeout), those listeners would never naturally clean
	 * themselves up, growing unboundedly. This cache means repeated
	 * preflight() calls for the same still-missing name return the exact
	 * same promise (and therefore the same single subscription) every time.
	 *
	 * TanStack Query's fetchQuery() gives currency/OSRS this same dedup
	 * for free; this resolver doesn't use TanStack Query (its "cache" is
	 * GlobalVariableStore, not a network response), so it needs its own.
	 */
	private pending = new Map<string, Promise<Value>>();

	preflight(_tokens: Token[], bytecode: BytecodeProgram, packageId: string, signal: AbortSignal, _queryClient: QueryClient): AsyncCheckResult | null {
		const { opcodes, strings } = bytecode;
		const len = opcodes.length;
		let i = 0;

		// Every unresolved name on the line, not just the first. Returning at
		// the first miss made a line resolve its references strictly serially:
		// the engine waited on that one name, re-executed the line, found the
		// second name still missing, waited again, and so on, so a line reading
		// three undeclared globals needed three full pend-and-re-execute round
		// trips to produce an answer it could give after one. The scan already
		// walks the whole program, so collecting the rest costs only the array.
		let missing: string[] | null = null;

		while (i < len) {
			const op = opcodes[i] as OpCode;

			if (op === OpCode.LOAD_GLOBAL_VAR) {
				const varName = strings[opcodes[i + 1]];
				if (!sharedGlobalVariableStore.has(varName)) {
					(missing ??= []).push(varName);
				}
			}

			// Every opcode's operand width, needed to correctly skip operand
			// bytes while scanning, mirrors the identical table already
			// duplicated in CurrencyAsyncResolver/OsrsAsyncResolver (this
			// codebase has no shared bytecode-walking utility yet). Keep
			// this in sync with those two files' switch blocks: an opcode
			// missing here (or there) causes a resolver to misread the next
			// opcode's operand byte as if it were itself an opcode, silently
			// corrupting the rest of that resolver's scan for ANY bytecode
			// that happens to also contain this opcode.
			// Step over this instruction and its operands. Shared table, because
			// three hand-copied versions of this had already drifted.
			i = nextInstruction(opcodes, i);
		}

		return missing === null ? null : this.pendingResultFor(missing, packageId, signal);
	}

	private pendingResultFor(varNames: string[], packageId: string, signal: AbortSignal): AsyncCheckResult {
		// Deduplicated and ordered, so a line reading the same name twice waits
		// once, and two lines reading the same pair produce the same key
		// whichever order they read them in. The key is a DAG data-source
		// dependency as well as the Pending payload, so a stable spelling
		// matters.
		const names = varNames.length === 1 ? varNames : [...new Set(varNames)].sort();

		// Waits for ALL of them, because the line cannot produce an answer
		// until every name it reads exists. Resolving on the first arrival
		// would re-execute the line into the same pending state it just left,
		// which is the serial behaviour this replaces.
		//
		// A name nobody ever declares leaves this pending for ever, exactly as
		// a single one always has: there is deliberately no timeout here, and
		// that is unchanged.
		const waits = names.map((name) => this.promiseFor(name));
		const resolver = waits.length === 1 ? waits[0] : Promise.all(waits).then((values) => values[values.length - 1]);

		return {
			// The single-name spelling is unchanged, byte for byte. Only a line
			// with more than one unresolved name gets the composite form.
			queryKey: names.length === 1 ? `global:${names[0]}` : `global:${names.join(",")}`,
			resolver,
			packageId,
			signal,
			metadata: { varNames: names },
		};
	}

	/**
	 * The shared in-flight promise for one name, created on first demand.
	 *
	 * Kept per NAME rather than per line or per call so the dedup described on
	 * {@link pending} still holds when several lines, in several documents,
	 * wait on the same undeclared name: they all receive this promise and
	 * therefore this single store subscription.
	 */
	private promiseFor(varName: string): Promise<Value> {
		let resolver = this.pending.get(varName);
		if (!resolver) {
			resolver = new Promise<Value>((resolve) => {
				const unsubscribe = sharedGlobalVariableStore.subscribe((name, value) => {
					if (name !== varName) return;
					unsubscribe();
					this.pending.delete(varName);
					resolve(value);
				});
			});
			this.pending.set(varName, resolver);
		}
		return resolver;
	}

	destroy(): void {
		// The underlying GlobalVariableStore subscriptions self-remove on
		// resolve; nothing here needs to force-unsubscribe in-flight ones
		// letting an already-pending global keep waiting even after this
		// particular resolver instance is torn down (e.g. package
		// unregister/re-register elsewhere) is harmless, since the
		// subscription only ever touches sharedGlobalVariableStore itself.
		this.pending.clear();
	}
}
