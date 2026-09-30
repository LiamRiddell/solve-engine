/**
 * The `solve-mcp` executable: the server over standard input and output, the
 * transport an AI tool uses when it starts a server as a child process.
 *
 * Standard output carries the protocol and nothing else, so anything the
 * engine or a package logs with `console.log` is sent to standard error; one
 * stray line on standard output would be read by the client as a malformed
 * message. The process exits when the client closes its end.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dateCalendarInZone, ENGINE_VERSION, ExpressionEngine } from "solve-engine";
import { evaluateDocument } from "solve-engine/engine";
import { BUILTIN_PACKAGES } from "solve-engine/packages";
import { HELP, parseServerArguments } from "./options";
import { createSolveServer } from "./server";
import { SERVER_VERSION } from "./version";

console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.debug = (...args: unknown[]) => console.error(...args);

async function main(): Promise<void> {
	const parsed = parseServerArguments(process.argv.slice(2));
	if (!parsed.ok) {
		process.stderr.write(`solve-mcp: ${parsed.message}\n`);
		process.exit(2);
	}
	if (parsed.command === "help") {
		process.stderr.write(HELP);
		process.exit(0);
	}
	if (parsed.command === "version") {
		process.stderr.write(`solve-mcp ${SERVER_VERSION} (solve-engine ${ENGINE_VERSION})\n`);
		process.exit(0);
	}
	if (parsed.command !== "serve") return;

	const server = createSolveServer(
		{
			createEngine: (options) => new ExpressionEngine(options),
			packages: BUILTIN_PACKAGES,
			evaluateDocument: (engine, text) => evaluateDocument(engine, text),
			dateCalendarInZone,
			engineVersion: ENGINE_VERSION,
			serverVersion: SERVER_VERSION,
		},
		parsed.settings,
	);
	const transport = new StdioServerTransport();
	// The client closing standard input is the end of the session. A fetch
	// still in flight holds a socket of its own, so the exit is explicit.
	process.stdin.once("end", () => process.exit(0));
	transport.onclose = () => process.exit(0);
	await server.connect(transport);
}

main().catch((error) => {
	process.stderr.write(`solve-mcp: stopped: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(2);
});
