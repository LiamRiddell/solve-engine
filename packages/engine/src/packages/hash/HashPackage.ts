import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { HASH_PLUGIN_FUNCTIONS, HASH_CALL_FUNCTIONS } from "./HashPluginFunctions";
import { HashCallParselet } from "./parselets/HashCallParselet";

/**
 * Cryptographic and checksum digests (issue #240): `sha256`, `sha1`, `sha512`,
 * `md5` and `crc32`, each turning a piece of text into its short fixed-length
 * fingerprint, written as lower-case hex.
 *
 * A neighbour of the text-encoding package, and like it on by default and
 * removable. The implementations are pure and synchronous (no Node `crypto`, no
 * async Web Crypto), so a digest is an ordinary value produced on the spot and
 * works unchanged in the browser worker.
 *
 * The output is hex, the universal default that `sha256sum` and its kin produce.
 * `md5` and `sha1` are offered for compatibility with existing systems; both are
 * long broken for collision resistance and should not be used where that
 * matters. A non-text input is answered with a structured Error.
 */
export const HASH_PACKAGE: IEnginePackage = {
	name: "solve-hash",
	prefixParselets: {
		HASH_CALL: new HashCallParselet(),
	},
	// `sha256(...)`, `md5(...)`, ... fused to HASH_CALL by the engine's shared rule.
	callFusions: Object.fromEntries(Object.keys(HASH_CALL_FUNCTIONS).map((n) => [n, "HASH_CALL"])),
	pluginFunctions: HASH_PLUGIN_FUNCTIONS,
	tokenCategories: {
		HASH_CALL: "function",
	},
};
