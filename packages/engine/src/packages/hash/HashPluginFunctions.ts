/**
 * The engine-facing layer over Hashes.ts: read the String argument, hash it, and
 * return the hex digest as a String. A non-text argument is answered with a
 * structured Error naming the function, never a wrong value.
 */
import { stringValue, errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import { md5, sha1, sha256, sha512, crc32 } from "./Hashes";

/** Maps each call name to the plugin-function name the parselet emits. */
export const HASH_CALL_FUNCTIONS: Record<string, string> = {
	md5: "hashMd5",
	sha1: "hashSha1",
	sha256: "hashSha256",
	sha512: "hashSha512",
	crc32: "hashCrc32",
};

function hashFn(name: string, fn: (t: string) => string): (args: Value[]) => Value {
	return (args) => {
		const arg = args[0];
		if (arg?.type !== ValueType.String) {
			return errorValue("HASH_EXPECTED_TEXT", `${name}(...) expects text (a "quoted string")`);
		}
		return stringValue(fn(arg.value as string));
	};
}

/** The hash package's plugin functions, keyed by the names the parselet emits. */
export const HASH_PLUGIN_FUNCTIONS: Record<string, (args: Value[]) => Value> = {
	hashMd5: hashFn("md5", md5),
	hashSha1: hashFn("sha1", sha1),
	hashSha256: hashFn("sha256", sha256),
	hashSha512: hashFn("sha512", sha512),
	hashCrc32: hashFn("crc32", crc32),
};
