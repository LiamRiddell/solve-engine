import type { QueryClient } from "@tanstack/query-core";
import type { Token } from "@solve-js/lexer";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import type { Value } from "@solve-js/vm/Value";
import type { IAsyncResolver, AsyncCheckResult } from "@solve-js/resolvers/ResolverRegistry";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import { nextInstruction } from "@solve-js/parser/OperandWidth";

/**
 * One engine's wait on one undeclared name: the promise every line of that
 * engine reading the name shares, and what settles it.
 */
interface Wait {
	readonly name: string;
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
	/** The engine's waits this one is filed under, so settling it can remove it. */
	readonly waits: Map<string, Wait>;
}

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
	 * Each engine's in-flight waits, by name, keyed by the engine's query
	 * client.
	 *
	 * Repeated preflight() calls for a name still missing return the same
	 * promise: every re-evaluation of a pending line (every keystroke, every
	 * scroll) asks again, and "never declared" is a supported outcome that
	 * pends for ever, so a new wait per call would grow without bound.
	 *
	 * The waits are the engine's, not this resolver's (#695). One resolver
	 * serves every engine, and a wait's promise carries the engine's
	 * continuation, so a map on the resolver itself held every engine that ever
	 * read an undeclared name: 40,000 reads kept 137 MB and the engine alive
	 * after it was dropped. Keyed weakly by the engine's query client, an
	 * engine's waits go when the engine does.
	 */
	private readonly waitsByEngine = new WeakMap<object, Map<string, Wait>>();

	/**
	 * Every live wait by name, held weakly, so a write finds the waits on its
	 * name in one lookup. A wait whose engine has gone is pruned by
	 * {@link forgotten}, or passed over when its name is written.
	 */
	private readonly waitsByName = new Map<string, Set<WeakRef<Wait>>>();

	/** Prunes a collected wait from {@link waitsByName}. */
	private readonly forgotten = new FinalizationRegistry<{ name: string; ref: WeakRef<Wait> }>(({ name, ref }) => this.unfile(name, ref));

	/**
	 * The resolver's one subscription to the store, held while anything waits.
	 *
	 * One per name used to be the rule, and the store calls every listener on
	 * every write, so each write cost as much as the number of names waited on
	 * anywhere in the process: 2,000 writes took 1.1 s beside 40,000 waits
	 * against 0.16 s in a fresh process (#695). One subscription dispatches
	 * through {@link waitsByName} instead.
	 */
	private unsubscribe: (() => void) | null = null;

	/** The one listener {@link unsubscribe} removes, kept so subscribing twice is one subscription. */
	private readonly onWrite = (name: string, value: Value): void => this.settle(name, value);

	preflight(_tokens: Token[], bytecode: BytecodeProgram, packageId: string, signal: AbortSignal, queryClient: QueryClient): AsyncCheckResult | null {
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

		return missing === null ? null : this.pendingResultFor(missing, packageId, signal, queryClient);
	}

	private pendingResultFor(varNames: string[], packageId: string, signal: AbortSignal, owner: object): AsyncCheckResult {
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
		const waits = names.map((name) => this.promiseFor(name, owner));
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
	 * The engine's in-flight promise for one name, created on first demand.
	 *
	 * Kept per name rather than per line or per call, so several lines in
	 * several of the engine's documents waiting on one undeclared name share
	 * this promise.
	 *
	 * @param varName - The undeclared name.
	 * @param owner - The engine's query client, which the wait lives and dies with.
	 */
	private promiseFor(varName: string, owner: object): Promise<Value> {
		let waits = this.waitsByEngine.get(owner);
		if (waits === undefined) {
			waits = new Map();
			this.waitsByEngine.set(owner, waits);
		}
		const known = waits.get(varName);
		if (known !== undefined) return known.promise;

		let resolve!: (value: Value) => void;
		const promise = new Promise<Value>((settle) => {
			resolve = settle;
		});
		const wait: Wait = { name: varName, promise, resolve, waits };
		waits.set(varName, wait);
		const ref = new WeakRef(wait);
		let refs = this.waitsByName.get(varName);
		if (refs === undefined) {
			refs = new Set();
			this.waitsByName.set(varName, refs);
		}
		refs.add(ref);
		this.forgotten.register(wait, { name: varName, ref });
		// Subscribing the same function again is a no-op while it is subscribed
		// (the store keeps a Set), and puts it back if the store was reset.
		this.unsubscribe = sharedGlobalVariableStore.subscribe(this.onWrite);
		return promise;
	}

	/** A name has been written: settle every live wait on it, in any engine. */
	private settle(name: string, value: Value): void {
		const refs = this.waitsByName.get(name);
		if (refs === undefined) return;
		this.waitsByName.delete(name);
		for (const ref of refs) {
			const wait = ref.deref();
			if (wait === undefined) continue;
			wait.waits.delete(name);
			wait.resolve(value);
		}
		this.releaseIfIdle();
	}

	/** Removes one collected wait from the name index. */
	private unfile(name: string, ref: WeakRef<Wait>): void {
		const refs = this.waitsByName.get(name);
		if (refs === undefined) return;
		refs.delete(ref);
		if (refs.size === 0) this.waitsByName.delete(name);
		this.releaseIfIdle();
	}

	/** Drops the store subscription when nothing waits, so an idle resolver costs a write nothing. */
	private releaseIfIdle(): void {
		if (this.waitsByName.size > 0 || this.unsubscribe === null) return;
		this.unsubscribe();
		this.unsubscribe = null;
	}

	/**
	 * Called when one engine's registry unregisters or clears this resolver.
	 *
	 * The resolver is one instance shared by every engine, so it ends no wait
	 * here: the waits belong to the engines, and another engine's must go on.
	 * Clearing a shared map on one engine's teardown used to cut every
	 * engine's dedup. An engine's waits go with the engine (see
	 * {@link waitsByEngine}), and a name that is written settles every wait
	 * on it.
	 */
	destroy(): void {
		// Nothing to release: see above.
	}
}
