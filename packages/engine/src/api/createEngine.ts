import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { DEFAULT_CONFIG } from "@solve-js/constants/Configuration";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";

/**
 * A batteries-included {@link ExpressionEngine} with every built-in package
 * registered.
 *
 * The constructor registers only the packages it is given, so a consumer's
 * bundler can tree-shake away the built-ins they never use: an engine built
 * with `new ExpressionEngine("en", false, undefined, undefined, [ARITHMETIC_PACKAGE])`
 * carries no finance, colour or weather code. This convenience is the opposite
 * trade: it pulls the FULL built-in set (`BUILTIN_PACKAGES`) for the common
 * "I want everything" case, so importing it defeats that tree-shaking. Reach
 * for the constructor with an explicit package list when bundle size matters,
 * and for `createEngine` when it does not.
 *
 * @param localeCode - BCP-47 locale, as in the constructor. Defaults to `"en"`.
 * @param diagnosticMode - Turn on the diagnostic pipeline, as in the constructor.
 * @param config - Config overrides, merged over `DEFAULT_CONFIG`.
 * @param extraPackages - Packages to register ON TOP of the built-in set, for a
 *   host that wants everything plus its own (e.g. an OSRS or stocks package).
 * @returns An engine with the built-in packages (and any extras) registered.
 *
 * @example
 * ```typescript
 * import { createEngine } from "solve-engine";
 * const engine = createEngine();
 * const [value] = engine.evaluateExpression("2 + 2 * 10");
 * console.log(value.toNumber()); // 22
 * ```
 */
export function createEngine(
	localeCode = "en",
	diagnosticMode = false,
	config?: Partial<typeof DEFAULT_CONFIG>,
	extraPackages: IEnginePackage[] = [],
): ExpressionEngine {
	return new ExpressionEngine(
		localeCode,
		diagnosticMode,
		config,
		undefined,
		extraPackages.length > 0 ? [...BUILTIN_PACKAGES, ...extraPackages] : BUILTIN_PACKAGES,
	);
}
