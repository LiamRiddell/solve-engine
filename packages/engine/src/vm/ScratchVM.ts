import type { Value } from "@solve-js/vm/Value";
import type { VM, EquationDef, ScalarEquationDef } from "@solve-js/vm/OpRegistry";
import type { BytecodeProgram, UserFunctionDef } from "@solve-js/parser/BytecodeBuilder";

/**
 * A VM that reads the document's state and keeps its own writes to itself.
 *
 * `ExpressionEngine.explainLine` has to run the line it explains, since a
 * derivation is made of the values the line arrives at. Running it against the
 * document's own VM applied the line: explaining `total += 5` added 5 to the
 * total each time, and explaining `:x = 30` set `x` (#566). This is the VM that
 * run happens in instead.
 *
 * Every read falls through to `live` until this VM has written the name itself,
 * so the line sees the document exactly as it stands. Every write (a variable,
 * a function, an equation) stays here, and so does a delete, recorded as a
 * tombstone so the name stops reading through. Dropping this object discards
 * all of it, and `live` is never written.
 *
 * What is not copied is the transient machinery a run balances for itself: the
 * value stack, the call frames and the instruction count are `live`'s own,
 * reached through the prototype, exactly as an ordinary run on `live` would use
 * them. A caller that runs a program here pops the stack back to where it found
 * it, as `ExpressionEngine.executeRaw` already does.
 *
 * `reset()` clears this VM's own writes and stops reading through, so the VM
 * reads as empty, without touching `live`.
 *
 * @param live - The document's VM, read and never written.
 * @returns A VM for one scratch run, to be dropped afterwards.
 */
export function createScratchVM(live: VM): VM {
	// `undefined` is a tombstone: the name was deleted here.
	const variables = new Map<string, Value | undefined>();
	const functions = new Map<string, UserFunctionDef | undefined>();
	const equations = new Map<string, EquationDef>();
	const scalarEquations = new Map<string, ScalarEquationDef>();
	let readsThrough = true;

	const variableEntries = (): [string, Value][] => {
		const merged = new Map<string, Value>(readsThrough ? live.getVariableEntries() : []);
		for (const [name, value] of variables) {
			if (value === undefined) merged.delete(name);
			else merged.set(name, value);
		}
		return [...merged];
	};

	const overrides: Partial<VM> = {
		getVar(key: string): Value | undefined {
			// A call frame's binding wins over any variable, as it does on `live`.
			const frame = live.getCallFrame();
			if (frame !== undefined) {
				const bound = frame.get(key);
				if (bound !== undefined) return bound;
			}
			if (variables.has(key)) return variables.get(key);
			return readsThrough ? live.getVar(key) : undefined;
		},
		setVar(key: string, value: Value): void {
			variables.set(key, value);
		},
		deleteVar(key: string): void {
			variables.set(key, undefined);
		},
		getVariableNames(limit: number): Iterable<string> | undefined {
			const names = variableEntries().map(([name]) => name);
			return names.length > limit ? undefined : names;
		},
		getVariableEntries: variableEntries,
		defineUserFunction(name: string, params: string[], program: BytecodeProgram): void {
			functions.set(name, { name, params, program });
		},
		getUserFunction(name: string): UserFunctionDef | undefined {
			if (functions.has(name)) return functions.get(name);
			return readsThrough ? live.getUserFunction(name) : undefined;
		},
		hasUserFunction(name: string): boolean {
			if (functions.has(name)) return functions.get(name) !== undefined;
			return readsThrough && live.hasUserFunction(name);
		},
		deleteUserFunction(name: string): void {
			functions.set(name, undefined);
		},
		getUserFunctionDefs(): UserFunctionDef[] {
			const merged = new Map<string, UserFunctionDef>();
			if (readsThrough) for (const def of live.getUserFunctionDefs()) merged.set(def.name, def);
			for (const [name, def] of functions) {
				if (def === undefined) merged.delete(name);
				else merged.set(name, def);
			}
			return [...merged.values()];
		},
		defineEquation(variable: string, factorNames: string[], rhsProgram: BytecodeProgram): void {
			equations.set(variable, { variable, factorNames, rhsProgram });
		},
		getEquation(variable: string): EquationDef | undefined {
			return equations.get(variable) ?? (readsThrough ? live.getEquation(variable) : undefined);
		},
		hasEquation(variable: string): boolean {
			return equations.has(variable) || (readsThrough && live.hasEquation(variable));
		},
		defineScalarEquation(variable: string, lhsProgram: BytecodeProgram, rhsProgram: BytecodeProgram): void {
			scalarEquations.set(variable, { variable, lhsProgram, rhsProgram });
		},
		getScalarEquation(variable: string): ScalarEquationDef | undefined {
			return scalarEquations.get(variable) ?? (readsThrough ? live.getScalarEquation(variable) : undefined);
		},
		hasScalarEquation(variable: string): boolean {
			return scalarEquations.has(variable) || (readsThrough && live.hasScalarEquation(variable));
		},
		reset(): void {
			variables.clear();
			functions.clear();
			equations.clear();
			scalarEquations.clear();
			readsThrough = false;
		},
	};

	// Everything not overridden above (the stack, call frames, limits, the
	// registry and context) is `live`'s own, reached through the prototype.
	return Object.assign(Object.create(live) as VM, overrides);
}
