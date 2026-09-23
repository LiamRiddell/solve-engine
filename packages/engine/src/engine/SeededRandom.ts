/**
 * Reproducible random draws: a seeded stream per line (issue #523).
 *
 * `roll`, `pick`, `shuffle`, `coin`, `uuid` and `random()` draw from the line's
 * random source (LineExecutionContext.random). Unseeded that is `Math.random`.
 * Seeded, each line gets its own stream, started from a hash of the seed and of
 * the line's compiled program. That makes a draw the same on every run and every
 * machine, and makes it change only when its own line is edited: a line added
 * above it, or an edit elsewhere, leaves it where it was, which a single stream
 * shared across the document could not do.
 *
 * The generator is mulberry32, a small 32-bit generator with a full period and
 * good statistical quality for draws a person looks at; it is not meant for
 * cryptography, and nothing here claims otherwise.
 */

import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/** FNV-1a over a string, as an unsigned 32-bit integer. */
function hash32(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * A stream of numbers in [0, 1), the same stream for the same seed and key.
 *
 * @param seed - The seed the reader or host named.
 * @param key - What distinguishes this line's draws from another's.
 */
export function seededStream(seed: string, key: string): () => number {
	let state = hash32(`${seed}\u0000${key}`);
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * A key for a line's compiled program: its opcodes, numbers and strings. Two
 * lines that compile alike share a key, and so draw alike under one seed.
 *
 * A plugin function call is keyed by the function's name, not by the index
 * in its opcode. The index is allocated process-wide, in the order packages
 * first register, so it depends on what else the process registered first and
 * on the engine version's package list. Keying on it made a seeded `uuid`
 * answer differently in a process that had registered another package first,
 * and again after an upgrade added a package. The name is the same in every
 * engine that can run the line.
 */
export function programKey(program: BytecodeProgram): string {
	const opcodes = Array.from(program.opcodes);
	const calls = program.pluginCalls;
	if (calls !== undefined) {
		// From the last call back, so dropping a wide call's second index byte
		// does not move a position still to be visited. A wide call is keyed as
		// the narrow one, since which form is emitted depends on the index too.
		for (let i = calls.at.length - 1; i >= 0; i--) {
			const at = calls.at[i];
			if (opcodes[at - 1] === OpCode.CALL_PLUGIN_WIDE) {
				opcodes[at - 1] = OpCode.CALL_PLUGIN;
				opcodes.splice(at, 2, 0);
			} else {
				opcodes[at] = 0;
			}
		}
	}
	const names = calls === undefined ? "" : calls.names.join("\u0001");
	return `${opcodes.join(",")}|${Array.from(program.numbers).join(",")}|${program.strings.join("\u0001")}|${names}`;
}

/** A line that seeds the document's draws: `random seed 42`. */
const SEED_LINE = /^\s*random\s+seed\s+(\S.*?)\s*$/i;

/**
 * The seed a document names with a `random seed <value>` line, or undefined
 * when it names none. The first such line wins, and it seeds the whole
 * document, lines above it included, so a draw does not depend on where the
 * seed happens to be written.
 *
 * @param lines - The document's lines of text.
 */
export function documentRandomSeed(lines: readonly string[]): string | undefined {
	for (const line of lines) {
		const match = SEED_LINE.exec(line);
		if (match) return match[1];
	}
	return undefined;
}
