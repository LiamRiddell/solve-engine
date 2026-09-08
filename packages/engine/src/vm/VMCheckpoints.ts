import { Value } from "@solve-js/vm/Value";
import type { VM } from "@solve-js/vm/OpRegistry";
import type { UserFunctionDef } from "@solve-js/parser/BytecodeBuilder";

// ── VMCheckpoint ────────────────────────────────────────────────────────

/**
 * A point-in-time snapshot of VM variable state.
 *
 * Each checkpoint holds only the variables that CHANGED at its line, and
 * reaches the rest through its `parent` link. A lookup walks that chain until
 * it finds the name; a restore walks it from the root applying each link's own
 * bindings in turn, so a later line's value naturally overwrites an earlier
 * one's.
 *
 * ```text
 * Checkpoint 0 (root):  {}                      // empty scope
 * Checkpoint 1 (:x=5):  { x: 5 }    parent → 0
 * Checkpoint 2 (:y=8):  { y: 8 }    parent → 1
 * Checkpoint 3 (:x=3):  { x: 3 }    parent → 2   // shadows x=5
 * ```
 *
 * To look up `x` at checkpoint 3: find own `x=3` → done.
 * To look up `y` at checkpoint 3: not own → walk parent to checkpoint 2 → `y=8`.
 * To look up `z` at checkpoint 3: not found anywhere → undefined.
 *
 * **Memory:** O(number of variable definitions) heap, independent of
 * document length. Typical Obsidian documents have < 100 variable defs,
 * so total checkpoint heap is < 10 KB.
 */
export interface VMCheckpoint {
	/** 1-based line number where this checkpoint was created. */
	lineNumber: number;
	/** Persistent line ID from DocumentModel. */
	lineId: number;
	/**
	 * Variable name → Value at this checkpoint.
	 * Only the variables set or updated at this line; the rest are reached
	 * through {@link VMCheckpoint.parent}.
	 */
	variables: Record<string, Value>;
	/**
	 * User-defined-function name → definition at this checkpoint. SEPARATE
	 * from `variables` above (not prototypally chained the same way
	 * `restoreTo()` replays every checkpoint in the chain in order, so a
	 * later redefinition of the same function name naturally overwrites an
	 * earlier one during replay, without needing its own prototype walk).
	 *
	 * Without this field, a function definition's checkpoint entry would be
	 * SILENTLY LOST: `snapshot()` used to call `vm.getVar(name)` for every
	 * written name, which returns `undefined` for a function name (function
	 * defs live in `vm.userFunctions`, not the flat variable store), and a
	 * `val !== undefined` guard silently skipped it. A scroll-triggered
	 * `restoreTo()` would then reset the VM and replay only `variables`,
	 * making a function defined above the new viewport vanish (calling it
	 * would throw `UNDEFINED_FUNCTION`) even though the document still
	 * shows its definition line as clean/cached.
	 */
	functions: Record<string, UserFunctionDef>;
	/** Parent checkpoint (closer to document start), or null for root. */
	parent: VMCheckpoint | null;
}

// ── VMCheckpointer ──────────────────────────────────────────────────────

/**
 * Manages VM state checkpoints for the three-tier evaluation strategy.
 *
 * **Checkpoint creation:** After a variable-definition line executes
 * (Tier 1 or Tier 3), `snapshot()` records the current values of the
 * written variables. The checkpoint is linked via prototypal inheritance
 * to the previous checkpoint, so only changed variables consume memory.
 *
 * **Checkpoint restoration:** Before evaluating a viewport whose start line
 * is not line 1, `restoreTo(lineNumber)` resets the VM and replays all
 * variable definitions up to and including that line. This avoids
 * re-evaluating the entire document from line 1 on every scroll.
 *
 * **Thread safety:** Checkpoints are created synchronously on the main
 * thread during evaluation. They are immutable after creation (Value is
 * an immutable type), so no synchronization is needed.
 *
 * **Integration with Phase 5.2e:** `setViewport()` will use `getNearestCheckpoint()`
 * to find the checkpoint just before the new viewport start, then call
 * `restoreTo()` to set up the VM before evaluating only the visible lines.
 * This is the key to O(visible lines) scrolling instead of O(document).
 */
export class VMCheckpointer {
	/** Ordered array of checkpoints (ascending lineNumber). */
	private checkpoints: VMCheckpoint[] = [];
	/** The VM instance whose variables are snapshotted/restored. */
	private vm: VM;

	constructor(vm: VM) {
		this.vm = vm;
	}

	// ── Snapshot ─────────────────────────────────────────────────────

	/**
	 * Create a checkpoint at the current line, recording the VM values of
	 * the specified variables.
	 *
	 * Records only what this line wrote; the rest is reached through the
	 * parent link rather than copied.
	 *
	 * A line that is snapshotted again drops every checkpoint at or after it
	 * first, so the list stays in document order and the new checkpoint
	 * inherits from the line before it rather than from one after it. See the
	 * body for what went wrong without that.
	 *
	 * @param lineNumber 1-based line position.
	 * @param lineId Persistent line ID from DocumentModel.
	 * @param variableNames Names of variables that were written at this line.
	 * @returns The new checkpoint, or null if no variable names provided.
	 */
	snapshot(
		lineNumber: number,
		lineId: number,
		variableNames: string[]
	): VMCheckpoint | null {
		if (variableNames.length === 0) return null;

		// Everything at or after this line goes before the new checkpoint is
		// taken.
		//
		// The list is a sequence of document positions and `restoreTo` reads it
		// as one, so appending on a re-run broke both halves of that. Editing
		// line 2 of a document whose lines 1, 2 and 3 each define something
		// left the list as [1, 2, 3, 2]: `getNearestCheckpoint(2)` stops at the
		// first entry past its target, so it found the stale line 2 and
		// restored the old value, and the new line 2 inherited from line 3, a
		// chain running backwards through the document that would have defined
		// a variable from a line that had not run yet.
		//
		// Nothing is lost by dropping them. A pass runs in document order and
		// every line that writes takes a checkpoint, so the ones removed here
		// are re-taken by this same pass as it continues past this line.
		let keep = this.checkpoints.length;
		while (keep > 0 && this.checkpoints[keep - 1].lineNumber >= lineNumber) keep--;
		if (keep !== this.checkpoints.length) this.checkpoints.length = keep;

		const parent = keep > 0 ? this.checkpoints[keep - 1] : null;

		// Each checkpoint holds only what its line wrote, and reaches the rest
		// through `parent`. It used to reach it through the prototype chain
		// instead, which held the same entries and cost the same memory, and
		// made the chain as deep as the document has definitions: a null
		// prototype is a flat object, and one per definition is a chain two
		// thousand deep on a document of two thousand definitions. Creating and
		// reading those took a pass over such a document from 6.0 ms to 23.1 ms.
		//
		// Nothing needed the inheritance. `restoreTo` walks `parent` and applies
		// each checkpoint's OWN keys, which is the same set either way, and the
		// one reader that did walk the prototype now walks `parent` too.
		//
		// Null-prototyped rather than `{}`, so a variable named `constructor` or
		// `toString` is a key like any other.
		const variables: Record<string, Value> = Object.create(null) as Record<string, Value>;
		const functions: Record<string, UserFunctionDef> = Object.create(null) as Record<string, UserFunctionDef>;

		// Record current VM values for the written names, routing each into
		// the right bag (a name is either a variable or a user-defined
		// function, never both; see VMCheckpoint.functions's doc comment for
		// why this dispatch is required, not optional).
		for (const name of variableNames) {
			if (this.vm.hasUserFunction(name)) {
				const fn = this.vm.getUserFunction(name);
				if (fn) functions[name] = fn;
				continue;
			}
			const val = this.vm.getVar(name);
			if (val !== undefined) {
				variables[name] = val;
			}
		}

		const checkpoint: VMCheckpoint = {
			lineNumber,
			lineId,
			variables,
			functions,
			parent,
		};
		this.checkpoints.push(checkpoint);
		return checkpoint;
	}

	// ── Restore ──────────────────────────────────────────────────────

	/**
	 * Restore the VM to the state at or just after the given line number.
	 *
	 * Finds the nearest checkpoint whose `lineNumber <= targetLineNumber`,
	 * then replays all variable definitions from root → that checkpoint
	 * into the VM via `setVar()`. The VM's stack is also reset.
	 *
	 * If no checkpoint exists at or before the target line, the VM is
	 * fully reset (empty scope, empty stack).
	 *
	 * **Performance:** O(total variable definitions before the line), since
	 * each checkpoint in the chain contributes only the names its own line
	 * wrote.
	 *
	 * @param lineNumber Target 1-based line number. The VM will have the
	 * state that existed AFTER evaluating lines up to `lineNumber`.
	 */
	restoreTo(lineNumber: number): void {
		const target = this.getNearestCheckpoint(lineNumber);
		if (!target) {
			this.vm.reset();
			return;
		}

		// Collect the checkpoint chain from root to target.
		// Walk parent links and reverse so root is first.
		const chain: VMCheckpoint[] = [];
		let current: VMCheckpoint | null = target;
		while (current) {
			chain.unshift(current);
			current = current.parent;
		}

		this.vm.reset();
		for (const cp of chain) {
			// Only the names this checkpoint's own line wrote; the ones before
			// it are applied by their own links earlier in this same walk.
			for (const key of Object.keys(cp.variables)) {
				this.vm.setVar(key, cp.variables[key]);
			}
			// Replay function definitions the same way, a later checkpoint's
			// redefinition of the same name naturally overwrites an earlier
			// one since the chain replays in root-to-target order.
			for (const key of Object.keys(cp.functions)) {
				const fn = cp.functions[key];
				this.vm.defineUserFunction(fn.name, fn.params, fn.program);
			}
		}
	}

	/**
	 * Record what `lineNumber` has just written, without disturbing the chain
	 * after it.
	 *
	 * {@link snapshot} drops every checkpoint at or after the line, which is
	 * right for a pass running forward in document order: it re-takes them as it
	 * goes. A caller re-running a few lines out of a document does not, and
	 * dropping the entries for lines it will never visit would lose the very
	 * bindings it is sweeping through them to collect. So this overwrites in
	 * place instead.
	 *
	 * Safe against the prototype chain, because it replaces only the
	 * checkpoint's OWN bindings: a later checkpoint that also writes the name
	 * holds its own copy and goes on shadowing this one.
	 *
	 * @param lineNumber 1-based line whose recorded bindings are refreshed.
	 * @param variableNames The names it wrote.
	 * @returns Whether a checkpoint existed at that line to update.
	 */
	updateCheckpointAt(lineNumber: number, variableNames: string[]): boolean {
		const checkpoint = this.getCheckpointAt(lineNumber);
		if (!checkpoint) return false;
		for (const name of variableNames) {
			if (this.vm.hasUserFunction(name)) {
				const fn = this.vm.getUserFunction(name);
				if (fn) checkpoint.functions[name] = fn;
				continue;
			}
			const value = this.vm.getVar(name);
			if (value !== undefined) checkpoint.variables[name] = value;
		}
		return true;
	}

	/**
	 * Apply the bindings recorded AT `lineNumber`, leaving the rest of the VM
	 * alone.
	 *
	 * {@link restoreTo} rebuilds the whole prefix, which costs the chain every
	 * time it is called. A caller moving forward through the document already
	 * holds the prefix up to the line before, and needs only what this line
	 * added: restoring once and then applying each line in turn as it is passed
	 * costs the chain once rather than once per line.
	 *
	 * @param lineNumber 1-based line whose own bindings are applied.
	 * @returns Whether a checkpoint existed at that line.
	 */
	applyCheckpointAt(lineNumber: number): boolean {
		const checkpoint = this.getCheckpointAt(lineNumber);
		if (!checkpoint) return false;
		for (const key of Object.keys(checkpoint.variables)) {
			this.vm.setVar(key, checkpoint.variables[key]);
		}
		for (const key of Object.keys(checkpoint.functions)) {
			const fn = checkpoint.functions[key];
			this.vm.defineUserFunction(fn.name, fn.params, fn.program);
		}
		return true;
	}

	// ── Queries ──────────────────────────────────────────────────────

	/**
	 * Find the nearest checkpoint at or before the given line number.
	 *
	 * Uses linear scan (checkpoints are sorted by lineNumber and the list
	 * is short, typically < 20 for Obsidian documents). Can be upgraded
	 * to binary search if needed for documents with 1000+ variable defs.
	 *
	 * @returns The nearest checkpoint, or null if none exists before the line.
	 */
	getNearestCheckpoint(lineNumber: number): VMCheckpoint | null {
		let result: VMCheckpoint | null = null;
		for (const cp of this.checkpoints) {
			if (cp.lineNumber <= lineNumber) {
				result = cp;
			} else {
				break; // checkpoints are sorted ascending
			}
		}
		return result;
	}

	/**
	 * Get a specific checkpoint by its line number.
	 * @returns The checkpoint, or undefined if not found.
	 */
	getCheckpointAt(lineNumber: number): VMCheckpoint | undefined {
		return this.checkpoints.find((cp) => cp.lineNumber === lineNumber);
	}

	/**
	 * Get the entire checkpoint chain from root to the last checkpoint.
	 * Useful for debugging and serialization.
	 */
	getAllCheckpoints(): readonly VMCheckpoint[] {
		return this.checkpoints;
	}

	/**
	 * Look up a variable's value through the checkpoint chain.
	 *
	 * Walks the prototype chain starting from the most recent checkpoint,
	 * looking for the variable name as an own property. This is O(depth)
	 * where depth is the number of checkpoints since the variable was
	 * last set.
	 *
	 * **Note:** This queries the checkpointer's snapshot, not the VM.
	 * The VM may have been modified since the last snapshot (e.g., by
	 * Tier 2 execution of non-variable-def lines that don't create checkpoints).
	 *
	 * @returns The Value, or undefined if the variable was never set.
	 */
	lookupVariable(name: string): Value | undefined {
		if (this.checkpoints.length === 0) return undefined;

		let checkpoint: VMCheckpoint | null = this.checkpoints[this.checkpoints.length - 1];
		while (checkpoint) {
			if (Object.prototype.hasOwnProperty.call(checkpoint.variables, name)) {
				return checkpoint.variables[name];
			}
			checkpoint = checkpoint.parent;
		}
		return undefined;
	}

	// ── Lifecycle ────────────────────────────────────────────────────

	/**
	 * Clear all checkpoints. The underlying VM is NOT reset, call
	 * `vm.reset()` separately if needed.
	 */
	clear(): void {
		this.checkpoints = [];
	}

	/** Number of checkpoints stored. */
	get count(): number {
		return this.checkpoints.length;
	}

	/** Returns true if no checkpoints have been created. */
	get isEmpty(): boolean {
		return this.checkpoints.length === 0;
	}

	/** The associated VM instance. */
	get vmInstance(): VM {
		return this.vm;
	}
}
