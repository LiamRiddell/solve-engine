/**
 * The `solve` executable: hands the real engine and the process's streams to
 * {@link run}, then exits with its code.
 *
 * The exit is explicit. `run` clears the engine, which releases every timer
 * the engine armed, but a fetch still in flight at the deadline holds a socket
 * of its own until the network gives up on it, and a command that has already
 * printed its answer must not wait for that.
 */

import { createEngine, dateCalendarInZone, ENGINE_VERSION } from "solve-engine";
import { evaluateDocument } from "solve-engine/engine";
import { run, type CliIO } from "./run";
import { EXIT } from "./arguments";
import { CLI_VERSION } from "./version";

/** Reads standard input to its end, or until more than `limit` bytes have arrived. */
function readStdin(limit: number): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const stdin = process.stdin;
		const finish = () => {
			stdin.off("data", onData);
			stdin.pause();
			resolve(Buffer.concat(chunks));
		};
		const onData = (chunk: Buffer | string) => {
			const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			chunks.push(bytes);
			size += bytes.length;
			if (size > limit) finish();
		};
		stdin.on("data", onData);
		stdin.once("end", finish);
		stdin.once("error", reject);
	});
}

/** Resolves once everything written to a stream so far has been handed to the system. */
function flushed(stream: NodeJS.WriteStream): Promise<void> {
	return new Promise((resolve) => {
		stream.write("", () => resolve());
	});
}

const io: CliIO = {
	out: (text) => void process.stdout.write(text),
	err: (text) => void process.stderr.write(text),
	readStdin,
	systemZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
};

// A reader that stops early (`solve notes.md | head -1`) closes the pipe, and
// the next write fails with EPIPE. That is the reader's choice, not a fault:
// end quietly rather than with a stack trace.
for (const stream of [process.stdout, process.stderr]) {
	stream.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code === "EPIPE") process.exit(typeof process.exitCode === "number" ? process.exitCode : EXIT.OK);
		throw error;
	});
}

async function main(): Promise<void> {
	let code: number;
	try {
		code = await run(process.argv.slice(2), io, {
			createEngine,
			evaluateDocument,
			dateCalendarInZone,
			engineVersion: ENGINE_VERSION,
			cliVersion: CLI_VERSION,
		});
	} catch (error) {
		// run() contains its own failures; this is the last line of defence,
		// so a fault is still one line and a usage code, never a stack trace.
		process.stderr.write(`solve: stopped: ${error instanceof Error ? error.message : String(error)}\n`);
		code = EXIT.USAGE;
	}
	process.exitCode = code;
	await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
	process.exit(code);
}

void main();
