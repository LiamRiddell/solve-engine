/**
 * The server's own command line: the few settings the person starting it
 * chooses, and a tool call never can.
 */

import { MAX_WAIT_MS } from "../../cli/src/arguments";
import { DEFAULT_SETTINGS, type ServerSettings } from "./tools";

/** The help text, `solve-mcp --help`. */
export const HELP = `solve-mcp: a Model Context Protocol server for the Solve engine, over standard input and output.

Usage:
  solve-mcp [--network on|off] [--wait <ms>]

Options:
  --network on|off   allow tool calls to fetch live data; off unless given
  --wait <ms>        how long a call waits for live data, 0 to ${MAX_WAIT_MS}; ${DEFAULT_SETTINGS.waitMs} unless given
  -h, --help         show this help
  -V, --version      show the version

Tools: evaluate_expression, evaluate_document, check_document.
`;

/** What the command line asked for. */
export type ServerArguments =
	| { ok: true; command: "serve"; settings: ServerSettings }
	| { ok: true; command: "help" | "version" }
	| { ok: false; message: string };

/**
 * Reads the server's arguments.
 *
 * @param argv - The arguments after the program name.
 * @returns The settings, a request for help or the version, or why the arguments were refused.
 */
export function parseServerArguments(argv: readonly string[]): ServerArguments {
	const settings: ServerSettings = { ...DEFAULT_SETTINGS };
	for (let i = 0; i < argv.length; i++) {
		const word = String(argv[i]);
		if (word === "-h" || word === "--help") return { ok: true, command: "help" };
		if (word === "-V" || word === "--version") return { ok: true, command: "version" };
		const eq = word.startsWith("--") ? word.indexOf("=") : -1;
		const name = eq > 0 ? word.slice(0, eq) : word;
		if (name !== "--network" && name !== "--wait") {
			return { ok: false, message: `${JSON.stringify(word.slice(0, 200))} is not an option solve-mcp knows. Run solve-mcp --help for the list.` };
		}
		const value = eq > 0 ? word.slice(eq + 1) : argv[++i];
		if (value === undefined) return { ok: false, message: `${name} needs a value after it.` };
		if (name === "--network") {
			if (value !== "on" && value !== "off") return { ok: false, message: `--network takes on or off, not ${JSON.stringify(value.slice(0, 200))}.` };
			settings.network = value === "on";
		} else {
			if (!/^\d{1,7}$/.test(value) || Number(value) > MAX_WAIT_MS) {
				return { ok: false, message: `--wait takes a whole number of milliseconds from 0 to ${MAX_WAIT_MS}, not ${JSON.stringify(value.slice(0, 200))}.` };
			}
			settings.waitMs = Number(value);
		}
	}
	return { ok: true, command: "serve", settings };
}
