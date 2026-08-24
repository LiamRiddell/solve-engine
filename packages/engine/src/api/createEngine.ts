import { ExpressionEngine, type EngineOptions } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";

/** Options for {@link createEngine}: the engine options, minus `packages` (the
 *  built-in set is always registered), plus `extraPackages` to add your own. */
export interface CreateEngineOptions extends Omit<EngineOptions, "packages"> {
	/** Packages to register ON TOP of the built-in set (e.g. an OSRS or stocks package). */
	extraPackages?: IEnginePackage[];
}

/**
 * A batteries-included {@link ExpressionEngine} with every built-in package
 * registered.
 *
 * The constructor registers only the packages it is given, so a consumer's
 * bundler can tree-shake away the built-ins they never use: an engine built
 * with `new ExpressionEngine({ packages: [ARITHMETIC_PACKAGE] })` carries no
 * finance, colour or weather code. This convenience is the opposite trade: it
 * pulls the FULL built-in set (`BUILTIN_PACKAGES`) for the common "I want
 * everything" case, so importing it defeats that tree-shaking. Reach for the
 * constructor with an explicit package list when bundle size matters, and for
 * `createEngine` when it does not.
 *
 * @param options - Engine options ({@link EngineOptions}) minus `packages`, plus
 *   an optional `extraPackages` to register alongside the built-in set.
 * @returns An engine with the built-in packages (and any extras) registered.
 *
 * @example
 * ```typescript
 * import { createEngine } from "solve-engine";
 * const engine = createEngine();
 * const value = engine.evaluateExpression("2 + 2 * 10");
 * console.log(value.toNumber()); // 22
 * ```
 */
export function createEngine(options: CreateEngineOptions = {}): ExpressionEngine {
	const { extraPackages = [], ...engineOptions } = options;
	return new ExpressionEngine({
		...engineOptions,
		packages: extraPackages.length > 0 ? [...BUILTIN_PACKAGES, ...extraPackages] : BUILTIN_PACKAGES,
	});
}
