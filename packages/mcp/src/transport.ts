/**
 * The stdio transport's framing, kept free of any runtime: MCP over standard
 * input and output sends one JSON-RPC message per line, UTF-8, with no
 * newline inside a message. {@link createLineReader} turns the bytes as they
 * arrive into whole lines, and {@link serveLines} answers each one, so the
 * same code runs under Node, Deno, Bun or in a browser worker; bin.ts only
 * hands it the process's streams.
 */

import type { SolveServer } from "./server";
import { RpcErrorCodes } from "./server";

/**
 * The longest message read, in characters: room for the server's largest
 * input written entirely as `\uXXXX` escapes, and short of exhausting memory.
 * A longer line is dropped as it arrives rather than held.
 */
export const MAX_MESSAGE_CHARS = 8 * 1024 * 1024;

/** Splits arriving bytes into lines. */
export interface LineReader {
	/** Takes the next chunk of bytes, or of text already decoded. */
	push(chunk: Uint8Array | string): void;
	/** The input has ended: a last line with no newline after it is still a line. */
	end(): void;
}

/**
 * Builds a line reader.
 *
 * @param onLine - Called with each line, its `\r\n` or `\n` removed. Empty lines are skipped.
 * @param onOverflow - Called once for each line longer than `maxChars`, which is dropped.
 * @param maxChars - The longest line kept.
 */
export function createLineReader(onLine: (line: string) => void, onOverflow: () => void, maxChars: number = MAX_MESSAGE_CHARS): LineReader {
	// One decoder for the whole stream, so a character split across two
	// chunks is joined rather than read as two replacement characters.
	const decoder = new TextDecoder("utf-8");
	let pending = "";
	let dropping = false;

	const emit = (line: string) => {
		const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
		if (trimmed.trim() !== "") onLine(trimmed);
	};

	const take = (text: string) => {
		let start = 0;
		let newline: number;
		while ((newline = text.indexOf("\n", start)) >= 0) {
			if (dropping) dropping = false;
			else if (pending.length + (newline - start) > maxChars) onOverflow();
			else emit(pending + text.slice(start, newline));
			pending = "";
			start = newline + 1;
		}
		if (dropping) return;
		pending += text.slice(start);
		if (pending.length > maxChars) {
			pending = "";
			dropping = true;
			onOverflow();
		}
	};

	return {
		push(chunk) {
			take(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
		},
		end() {
			take(decoder.decode());
			if (!dropping && pending !== "") emit(pending);
			pending = "";
			dropping = false;
		},
	};
}

/**
 * Connects a server to a line transport.
 *
 * Each message is answered as soon as it is ready, so a slow call does not
 * hold up a `ping` behind it; JSON-RPC matches answers to requests by `id`,
 * not by order.
 *
 * @param server - The server to hand each message to.
 * @param write - Sends one line of output. The newline is added here.
 * @returns The reader to push the input's bytes into, and `settled`, which resolves once every answer so far has been written.
 */
export function serveLines(server: SolveServer, write: (line: string) => void): LineReader & { settled(): Promise<void> } {
	const inFlight = new Set<Promise<void>>();
	const send = (text: string | undefined) => {
		if (text !== undefined) write(`${text}\n`);
	};
	const reader = createLineReader(
		(line) => {
			const task = server.handle(line).then(send, () => undefined);
			inFlight.add(task);
			void task.finally(() => inFlight.delete(task));
		},
		() => send(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: RpcErrorCodes.INVALID_REQUEST, message: `The message is longer than ${MAX_MESSAGE_CHARS} characters, the most this server reads.` } })),
	);
	return {
		push: reader.push,
		end: reader.end,
		settled: async () => {
			while (inFlight.size > 0) await Promise.all([...inFlight]);
		},
	};
}
