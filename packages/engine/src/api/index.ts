// Public entry point, the "start here" surface for consuming the engine.
// Deeper/specific needs are covered by each module's own barrel:
// @solve-js/vm, @solve-js/parser, @solve-js/language, @solve-js/format,
// @solve-js/packages, @solve-js/constants (all public), plus the
// advanced-public escape hatches (@solve-js/lexer, @solve-js/normalizer,
// @solve-js/resolvers, @solve-js/errors, @solve-js/utilities,
// @solve-js/uom) for authoring custom packages.

export { PackageRegistry, packageRegistry } from "./PackageRegistry";
export type { IPackageRegistry, IEnginePackage } from "./PackageRegistry";

export { defineFunction, DefineFunctionErrorCodes } from "./defineFunction";
export type { FunctionSpec, FunctionArg, FunctionValueType } from "./defineFunction";

export { checkPackageCompatibility } from "./PackageCompatibility";
export type {
  CompatibilityReport,
  CompatibilityConflict,
  CompatibilityConflictKind,
  CompatibilitySeverity,
} from "./PackageCompatibility";

export { checkEngineVersionCompatibility, assertEngineVersionCompatible } from "./EngineVersionCompatibility";
export type { EngineVersionCheckResult } from "./EngineVersionCompatibility";

// A batteries-included engine (every built-in package) for the common case;
// the constructor stays bring-your-own-packages so a consumer can tree-shake.
export { createEngine } from "./createEngine";

export { ExpressionEngine, SNAPSHOT_FORMAT, SNAPSHOT_VERSION, SnapshotErrorCodes } from "@solve-js/engine";
export type { Explanation, ExplanationStep } from "@solve-js/engine";
export type {
  EngineRestoreOptions,
  EngineSnapshot,
  SerializedValue,
  SerializedBytecode,
  SerializedUserFunction,
  SerializedAnonymousBody,
  SerializedLineCacheEntry,
  SerializedDecimal,
  SerializedRational,
  SerializedNumber,
} from "@solve-js/engine";

export { ENGINE_VERSION } from "@solve-js/constants/version";
