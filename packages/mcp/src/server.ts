/**
 * The MCP server: the three tools in tools.ts, registered with the official
 * SDK's `McpServer`.
 *
 * MCP (the Model Context Protocol) is how an AI tool calls functions outside
 * itself: the tool lists what a server offers, each with a JSON Schema for its
 * arguments, and calls one with JSON. Each tool here answers with its result
 * object twice, as `structuredContent` for a client that reads JSON and as a
 * text block for one that shows text, and marks a refusal with `isError`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	checkDocumentTool,
	evaluateDocumentTool,
	evaluateExpressionTool,
	type ServerKit,
	type ServerSettings,
	type ToolOutcome,
} from "./tools";

/** The arguments every tool shares. */
const PINS = {
	tz: z.string().max(200).optional().describe("The IANA time zone dates are read in, such as Europe/London."),
	now: z
		.union([z.string().max(200), z.number()])
		.optional()
		.describe("The moment today and now read: an ISO 8601 instant with its offset, such as 2026-01-01T09:00:00Z, or milliseconds since 1970."),
	seed: z.union([z.string().max(200), z.number()]).optional().describe("Makes random draws (roll, pick, shuffle) the same on every call."),
};

/** The MCP answer for a tool's outcome. */
export function toCallResult(outcome: ToolOutcome): { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown>; isError: boolean } {
	const body = outcome.ok ? outcome.body : { error: outcome.error };
	return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, isError: !outcome.ok };
}

/**
 * Builds the server with its three tools.
 *
 * @param kit - The engine functions the tools call.
 * @param settings - What the person who started the server chose.
 * @returns A server ready to `connect` to a transport.
 */
export function createSolveServer(kit: ServerKit, settings: ServerSettings): McpServer {
	const server = new McpServer({ name: "solve", version: kit.serverVersion });
	const annotations = { readOnlyHint: true, idempotentHint: !settings.network, openWorldHint: settings.network };

	server.registerTool(
		"evaluate_expression",
		{
			title: "Evaluate an expression",
			description:
				"Evaluate one Solve expression, such as 5 km in miles, 20% of $85 or today + 3 weeks, and return its answer. " +
				"Line references, tags and variables from other lines need evaluate_document instead.",
			inputSchema: { expression: z.string().describe("The expression to evaluate."), ...PINS },
			annotations,
		},
		async (args) => toCallResult(await evaluateExpressionTool(args, settings, kit)),
	);

	server.registerTool(
		"evaluate_document",
		{
			title: "Evaluate a document",
			description:
				"Evaluate a whole Solve note (one expression per line, with Markdown headings and prose) and return one answer per evaluated line. " +
				"Prose the engine cannot read is reported as not-read and does not count as a failure unless strict is true.",
			inputSchema: {
				document: z.string().describe("The note, lines separated by newlines."),
				strict: z.boolean().optional().describe("Count a line the engine could not read as a failure."),
				...PINS,
			},
			annotations,
		},
		async (args) => toCallResult(await evaluateDocumentTool(args, settings, kit)),
	);

	server.registerTool(
		"check_document",
		{
			title: "Check a document",
			description:
				"Evaluate a Solve note and report its check lines (check <comparison>): which passed, which failed, and which could not be evaluated. ok is true only when every check passed.",
			inputSchema: { document: z.string().describe("The note, lines separated by newlines."), ...PINS },
			annotations,
		},
		async (args) => toCallResult(await checkDocumentTool(args, settings, kit)),
	);

	return server;
}
