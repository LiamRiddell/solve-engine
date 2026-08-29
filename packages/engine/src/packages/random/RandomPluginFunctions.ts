/**
 * Everyday randomness and identifiers. Each handler draws from `Math.random`,
 * the same source the engine's `random()` and `roll` already use, so a note that
 * uses these is as reproducible (or not) as the rest of the engine.
 *
 * These results are non-deterministic by nature, so the docs page carries no
 * proven values; the tests here assert shape and membership (a uuid matches the
 * version-4 pattern, `pick` returns one of its arguments) rather than a fixed
 * output.
 */
import {
	stringValue, matrixValue, errorValue, ValueType, type Value, type MatrixData,
} from "@solve-js/vm/Value";

const HEX = "0123456789abcdef";

/** A random hex digit, 0 to f. */
function hexDigit(): string {
	return HEX[Math.floor(Math.random() * 16)];
}

/** A random version-4 UUID, the `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` form. */
export function uuidV4(): string {
	let out = "";
	for (let i = 0; i < 36; i++) {
		if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
		else if (i === 14) out += "4"; // the version nibble
		else if (i === 19) out += HEX[(Math.floor(Math.random() * 16) & 0x3) | 0x8]; // variant: 8/9/a/b
		else out += hexDigit();
	}
	return out;
}

/** `n` random hex digits. */
export function randomHexDigits(n: number): string {
	let out = "";
	for (let i = 0; i < n; i++) out += hexDigit();
	return out;
}

/** The random package's plugin functions, keyed by the names the parselets emit. */
export const RANDOM_PLUGIN_FUNCTIONS: Record<string, (args: Value[]) => Value> = {
	// `uuid`
	randomUuid: (): Value => stringValue(uuidV4()),

	// `coin`
	randomCoin: (): Value => stringValue(Math.random() < 0.5 ? "heads" : "tails"),

	// `random hex N`
	randomHex: (args: Value[]): Value => {
		const count = args[0];
		if (count?.type !== ValueType.Number) {
			return errorValue("RANDOM_EXPECTED_COUNT", "random hex expects a number of digits");
		}
		const n = Math.trunc(count.value as number);
		if (n < 0) return errorValue("RANDOM_EXPECTED_COUNT", "random hex needs a count of 0 or more");
		return stringValue(randomHexDigits(n));
	},

	// `pick(a, b, c)`: returns one of its arguments unchanged.
	randomPick: (args: Value[]): Value => {
		if (args.length === 0) return errorValue("RANDOM_PICK_EMPTY", "pick needs at least one option");
		return args[Math.floor(Math.random() * args.length)];
	},

	// `shuffle [a, b, c]`: a random permutation of a vector, same orientation.
	randomShuffle: (args: Value[]): Value => {
		const arg = args[0];
		if (arg?.type !== ValueType.Matrix) {
			return errorValue("RANDOM_SHUFFLE_EXPECTED_LIST", "shuffle expects a list, e.g. shuffle [1, 2, 3]");
		}
		const m = arg.value as MatrixData;
		if (m.rows !== 1 && m.cols !== 1) {
			return errorValue("RANDOM_SHUFFLE_EXPECTED_LIST", "shuffle expects a single row or column, not a full matrix");
		}
		const data = m.data.slice();
		// Fisher-Yates, from the back.
		for (let i = data.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[data[i], data[j]] = [data[j], data[i]];
		}
		return matrixValue(m.rows, m.cols, data);
	},
};
