import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { GlobalVariableParselet } from "./parselets/GlobalVariableParselet";
import { GlobalVariableAsyncResolver } from "@solve-js/vm/GlobalVariableAsyncResolver";

/**
 * `global :name`, a variable that spans documents, backed by the shared
 * {@link GlobalVariableStore} rather than the VM's own local scope.
 *
 * Deliberately a separate package from `solve-variables`, which owns the
 * ordinary `:name = expr` local. The two are different levels of
 * functionality, and separating them is what lets a host refuse one without
 * losing the other: everything in this package reaches outside the document
 * being evaluated, and a host may have good reason to disallow that (a
 * single-document editor, a sandboxed evaluation, a product where one
 * document reaching into another would be surprising) while still wanting
 * ordinary variables, which are the far lower-risk primitive.
 *
 * While both lived in one package, the documented way to drop a feature,
 * `BUILTIN_PACKAGES.filter((p) => p !== VARIABLES_PACKAGE)`, took `:x = 1`
 * down with `global :x = 1`, and there was no supported way to refuse only
 * the document-spanning half. A host that wanted one had to register a
 * replacement parselet for the `GLOBAL` token and rely on last-one-wins.
 *
 * Dropping this package removes the SYNTAX, not the values: the store is
 * realm-wide and outlives any one engine, so anything another engine has
 * already written is still there, merely unaddressable from this one. That
 * asymmetry is a consequence of the store being a module-level singleton and
 * is resolved by the workspace in
 * `docs-internal/plans/CROSS_SCOPE_CELLS.md`, after which refusing the
 * feature is simply declining to pass a workspace.
 *
 * The `global` keyword itself is claimed by the locale (`constants/locales`)
 * regardless of whether this package is registered, so a document containing
 * `global :x` without it does not silently evaluate to something else: the
 * `GLOBAL` token has no prefix parselet and the line reports a parse error,
 * contained to that line.
 */
export const GLOBAL_VARIABLES_PACKAGE: IEnginePackage = {
	name: "solve-global-variables",
	// Resolves a `global :name` read that no currently-loaded document has
	// declared yet: the line shows Pending and re-resolves the instant some
	// document declares it, through the same async pipeline the currency
	// package uses for rates. It travels with this package rather than with
	// `solve-variables` because it exists only to serve this syntax.
	asyncResolvers: [new GlobalVariableAsyncResolver()],
	prefixParselets: {
		// `global :name` (read) and `global :name = expr` (write). The parselet
		// consumes the colon and the name itself rather than delegating to
		// VariableParselet, so this package stands alone: registering it
		// without `solve-variables` still parses, and registering
		// `solve-variables` without it still parses ordinary locals.
		GLOBAL: new GlobalVariableParselet(),
	},
};
