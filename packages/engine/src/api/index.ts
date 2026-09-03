// Public entry point, the "start here" surface for consuming the engine.
// Deeper/specific needs are covered by each module's own barrel:
// @solve-js/vm, @solve-js/parser, @solve-js/language, @solve-js/format,
// @solve-js/packages, @solve-js/constants (all public), plus the
// advanced-public escape hatches (@solve-js/lexer, @solve-js/normalizer,
// @solve-js/resolvers, @solve-js/errors, @solve-js/utilities,
// @solve-js/uom) for authoring custom packages.

export type { IEnginePackage } from "./PackageRegistry";

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
export type { CreateEngineOptions } from "./createEngine";
export type { EngineConfigOverride } from "@solve-js/constants/Configuration";

// The value a result comes back as, and the one function most hosts call on
// it. Every "read a result" snippet used to import these from
// `solve-engine/vm` and `solve-engine/format`, subpaths named after internals,
// for the type the root entry's own `evaluateExpression` returns. Both
// subpaths keep exporting them; this is the same binding under the name a
// first-time reader reaches for.
export { Value, ValueType } from "@solve-js/vm/Value";
export { formatValue } from "@solve-js/format/FormatEngine";
export type { FormattingSettings } from "@solve-js/format/FormattingSettings";

export { ExpressionEngine, SNAPSHOT_FORMAT, SNAPSHOT_VERSION, SnapshotErrorCodes } from "@solve-js/engine";
export type { Explanation, ExplanationStep } from "@solve-js/engine";
export type {
  EngineOptions,
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
