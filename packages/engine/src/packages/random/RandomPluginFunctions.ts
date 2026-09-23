/**
 * Everyday randomness and identifiers. Each handler draws from the line's random
 * source, the same one the engine's `random()` and `roll` use (see
 * LineExecutionContext.random): `Math.random` by default, or a seeded stream when
 * the engine or the document names a seed, in which case a note's draws are the
 * same on every run and change only when their own line is edited.
 */
import {
	stringValue, matrixValue, errorValue, ValueType, type Value, type MatrixData,
} from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { drawRandom } from "@solve-js/vm/VMBuiltins";

const HEX = "0123456789abcdef";

/** The line's random source as a function, `Math.random` when it has none. */
function sourceOf(context?: LineExecutionContext): () => number {
	return () => drawRandom(context);
}

/** A random hex digit, 0 to f. */
function hexDigit(random: () => number): string {
	return HEX[Math.floor(random() * 16)];
}

/** A random version-4 UUID, the `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` form. */
export function uuidV4(random: () => number = Math.random): string {
	let out = "";
	for (let i = 0; i < 36; i++) {
		if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
		else if (i === 14) out += "4"; // the version nibble
		else if (i === 19) out += HEX[(Math.floor(random() * 16) & 0x3) | 0x8]; // variant: 8/9/a/b
		else out += hexDigit(random);
	}
	return out;
}

/** `n` random hex digits. */
export function randomHexDigits(n: number, random: () => number = Math.random): string {
	let out = "";
	for (let i = 0; i < n; i++) out += hexDigit(random);
	return out;
}

/** The random package's plugin functions, keyed by the names the parselets emit. */
export const RANDOM_PLUGIN_FUNCTIONS: Record<string, (args: Value[], context?: LineExecutionContext) => Value> = {
	// `uuid`
	randomUuid: (_args, context): Value => stringValue(uuidV4(sourceOf(context))),

	// `coin`
	randomCoin: (_args, context): Value => stringValue(drawRandom(context) < 0.5 ? "heads" : "tails"),

	// `random hex N`
	randomHex: (args: Value[], context?: LineExecutionContext): Value => {
		const count = args[0];
		if (count?.type !== ValueType.Number) {
			return errorValue("RANDOM_EXPECTED_COUNT", "random hex expects a number of digits");
		}
		const n = Math.trunc(count.value as number);
		if (n < 0) return errorValue("RANDOM_EXPECTED_COUNT", "random hex needs a count of 0 or more");
		return stringValue(randomHexDigits(n, sourceOf(context)));
	},

	// `pick(a, b, c)`: returns one of its arguments unchanged.
	randomPick: (args: Value[], context?: LineExecutionContext): Value => {
		if (args.length === 0) return errorValue("RANDOM_PICK_EMPTY", "pick needs at least one option");
		return args[Math.floor(drawRandom(context) * args.length)];
	},

	// `shuffle [a, b, c]`: a random permutation of a vector, same orientation.
	randomShuffle: (args: Value[], context?: LineExecutionContext): Value => {
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
			const j = Math.floor(drawRandom(context) * (i + 1));
			[data[i], data[j]] = [data[j], data[i]];
		}
		return matrixValue(m.rows, m.cols, data);
	},
};
