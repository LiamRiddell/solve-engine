/**
 * The running engine's own semver version, sourced directly from this
 * package's package.json so it can never drift from what's actually
 * published. Exists so IEnginePackage.engineVersion range checks
 * (api/EngineVersionCompatibility.ts) have something real to check
 * against.
 */
import { version } from "../../package.json";

/**
 * The running engine's version, taken from package.json.
 *
 * What a package's `engineVersion` range is checked against at registration.
 * A prerelease is compared by its coerced release version, so a 1.0.0 beta
 * satisfies `^1.0.0`. See `api/EngineVersionCompatibility.ts`.
 */
export const ENGINE_VERSION: string = version;
