/**
 * The MCP server: the three tools in tools.ts, behind the protocol's own
 * messages, written out here rather than taken from an SDK.
 *
 * MCP (the Model Context Protocol) is how an AI tool calls functions outside
 * itself: the tool lists what a server offers, each with a JSON Schema for its
 * arguments, and calls one with JSON. Underneath it is JSON-RPC 2.0, one JSON
 * object per message: a request carries an `id` and is answered with a
 * `result` or an `error` under the same `id`, and a notification has no `id`
 * and is never answered. A server that only offers tools needs five methods
 * (`initialize`, `ping`, `tools/list`, `tools/call`, and the notifications it
 * may ignore), which is little enough to own outright: the engine promises one
 * runtime dependency, and this server adds none.
 *
 * Nothing here touches a runtime API. {@link createSolveServer} turns one
 * message's text into the reply's text, so any transport can carry it, and
 * transport.ts splits a byte stream into those messages; bin.ts is the only
 * file that knows it is running under Node.
 *
 * Each tool answers with its result object twice, as `structuredContent` for a
 * client that reads JSON and as a text block for one that shows text, and
 * marks a refusal with `isError`.
 */

import {
	checkDocumentTool,
	evaluateDocumentTool,
	evaluateExpressionTool,
	ServerErrorCodes,
	type PinArguments,
	type ServerKit,
	type ServerSettings,
	type ToolOutcome,
} from "./tools";

/** The protocol versions this server speaks, newest first. */
export const PROTOCOL_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/** The JSON-RPC error codes the server answers with. */
export const RpcErrorCodes = {
	/** The message is not JSON. */
	PARSE_ERROR: -32700,
	/** The message is JSON, but not a JSON-RPC request. */
	INVALID_REQUEST: -32600,
	/** The method is not one this server offers. */
	METHOD_NOT_FOUND: -32601,
	/** The parameters are not the method's, such as a tool that does not exist. */
	INVALID_PARAMS: -32602,
	/** The server failed in a way the request did not cause. */
	INTERNAL_ERROR: -32603,
} as const;

/** What a tool call answers with. */
export interface CallResult {
	content: { type: "text"; text: string }[];
	structuredContent: Record<string, unknown>;
	isError: boolean;
}

/** The MCP answer for a tool's outcome. */
export function toCallResult(outcome: ToolOutcome): CallResult {
	const body = outcome.ok ? outcome.body : { error: outcome.error };
	return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, isError: !outcome.ok };
}

/** The JSON Schema of the arguments every tool shares. */
const PIN_SCHEMA = {
	tz: { type: "string", maxLength: 200, description: "The IANA time zone dates are read in, such as Europe/London." },
	now: {
		anyOf: [{ type: "string", maxLength: 200 }, { type: "number" }],
		description: "The moment today and now read: an ISO 8601 instant with its offset, such as 2026-01-01T09:00:00Z, or milliseconds since 1970.",
	},
	seed: { anyOf: [{ type: "string", maxLength: 200 }, { type: "number" }], description: "Makes random draws (roll, pick, shuffle) the same on every call." },
};

/** One tool: what `tools/list` says about it, and how a call reaches it. */
interface ToolEntry {
	name: string;
	title: string;
	description: string;
	inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] };
	run(args: Record<string, unknown>, settings: ServerSettings, kit: ServerKit): Promise<ToolOutcome>;
}

/** The arguments a tool reads, or why they were refused. */
type Read<T> = { ok: true; args: T } | { ok: false; outcome: ToolOutcome };

function invalid(message: string): { ok: false; outcome: ToolOutcome } {
	return { ok: false, outcome: { ok: false, error: { code: ServerErrorCodes.INPUT_INVALID, message } } };
}

/** An own property of the arguments, never one inherited from `Object.prototype`. */
function own(args: Record<string, unknown>, key: string): unknown {
	return Object.prototype.hasOwnProperty.call(args, key) ? args[key] : undefined;
}

/** A required text argument. */
function readText(args: Record<string, unknown>, key: string): Read<string> {
	const value = own(args, key);
	if (typeof value !== "string") return invalid(`${key} must be text.`);
	return { ok: true, args: value };
}

/** The shared pins, each checked against its schema. */
function readPins(args: Record<string, unknown>): Read<PinArguments> {
	const pins: PinArguments = {};
	const tz = own(args, "tz");
	if (tz !== undefined) {
		if (typeof tz !== "string" || tz.length > 200) return invalid("tz must be text of at most 200 characters.");
		pins.tz = tz;
	}
	for (const key of ["now", "seed"] as const) {
		const value = own(args, key);
		if (value === undefined) continue;
		const fits = typeof value === "number" ? Number.isFinite(value) : typeof value === "string" && value.length <= 200;
		if (!fits) return invalid(`${key} must be a number or text of at most 200 characters.`);
		pins[key] = value as string | number;
	}
	return { ok: true, args: pins };
}

/** The tools, in the order `tools/list` gives them. */
const TOOLS: readonly ToolEntry[] = [
	{
		name: "evaluate_expression",
		title: "Evaluate an expression",
		description:
			"Evaluate one Solve expression, such as 5 km in miles, 20% of $85 or today + 3 weeks, and return its answer. " +
			"Line references, tags and variables from other lines need evaluate_document instead.",
		inputSchema: {
			type: "object",
			properties: { expression: { type: "string", description: "The expression to evaluate." }, ...PIN_SCHEMA },
			required: ["expression"],
		},
		run(args, settings, kit) {
			const expression = readText(args, "expression");
			if (!expression.ok) return Promise.resolve(expression.outcome);
			const pins = readPins(args);
			if (!pins.ok) return Promise.resolve(pins.outcome);
			return evaluateExpressionTool({ expression: expression.args, ...pins.args }, settings, kit);
		},
	},
	{
		name: "evaluate_document",
		title: "Evaluate a document",
		description:
			"Evaluate a whole Solve note (one expression per line, with Markdown headings and prose) and return one answer per evaluated line. " +
			"Prose the engine cannot read is reported as not-read and does not count as a failure unless strict is true.",
		inputSchema: {
			type: "object",
			properties: {
				document: { type: "string", description: "The note, lines separated by newlines." },
				strict: { type: "boolean", description: "Count a line the engine could not read as a failure." },
				...PIN_SCHEMA,
			},
			required: ["document"],
		},
		run(args, settings, kit) {
			const document = readText(args, "document");
			if (!document.ok) return Promise.resolve(document.outcome);
			const strict = own(args, "strict");
			if (strict !== undefined && typeof strict !== "boolean") return Promise.resolve(invalid("strict must be true or false.").outcome);
			const pins = readPins(args);
			if (!pins.ok) return Promise.resolve(pins.outcome);
			return evaluateDocumentTool({ document: document.args, strict: strict === true, ...pins.args }, settings, kit);
		},
	},
	{
		name: "check_document",
		title: "Check a document",
		description:
			"Evaluate a Solve note and report its check lines (check <comparison>): which passed, which failed, and which could not be evaluated. ok is true only when every check passed.",
		inputSchema: {
			type: "object",
			properties: { document: { type: "string", description: "The note, lines separated by newlines." }, ...PIN_SCHEMA },
			required: ["document"],
		},
		run(args, settings, kit) {
			const document = readText(args, "document");
			if (!document.ok) return Promise.resolve(document.outcome);
			const pins = readPins(args);
			if (!pins.ok) return Promise.resolve(pins.outcome);
			return checkDocumentTool({ document: document.args, ...pins.args }, settings, kit);
		},
	},
];

/** A JSON-RPC request id: a string, a number, or null for a message whose id could not be read. */
type RequestId = string | number | null;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function answer(id: RequestId, result: unknown): string {
	return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function fail(id: RequestId, code: number, message: string): string {
	return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/** The server: one message in, at most one message out. */
export interface SolveServer {
	/**
	 * Handles one message.
	 *
	 * @param text - One JSON-RPC message, as the client sent it.
	 * @returns The reply's text, or `undefined` for a notification, which is never answered.
	 */
	handle(text: string): Promise<string | undefined>;
	/** What `tools/list` answers with. */
	listTools(): { tools: unknown[] };
	/**
	 * Runs one tool by name, as `tools/call` does.
	 *
	 * @returns The call's result, or `undefined` when no tool has that name.
	 */
	callTool(name: string, args: unknown): Promise<CallResult | undefined>;
}

/**
 * Builds the server with its three tools.
 *
 * @param kit - The engine functions the tools call.
 * @param settings - What the person who started the server chose.
 * @returns A server ready to be handed messages by a transport.
 */
export function createSolveServer(kit: ServerKit, settings: ServerSettings): SolveServer {
	const annotations = { readOnlyHint: true, idempotentHint: !settings.network, openWorldHint: settings.network };

	const listTools = () => ({
		tools: TOOLS.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations })),
	});

	const callTool = async (name: string, args: unknown): Promise<CallResult | undefined> => {
		const tool = TOOLS.find((t) => t.name === name);
		if (tool === undefined) return undefined;
		if (args !== undefined && !isRecord(args)) return toCallResult(invalid("The arguments must be an object.").outcome);
		return toCallResult(await tool.run(args ?? {}, settings, kit));
	};

	/** A request's answer, given its method and parameters. */
	const dispatch = async (id: RequestId, method: string, params: Record<string, unknown>): Promise<string> => {
		switch (method) {
			case "initialize": {
				const asked = own(params, "protocolVersion");
				const protocolVersion = typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
				return answer(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "solve", version: kit.serverVersion } });
			}
			case "ping":
				return answer(id, {});
			case "tools/list":
				return answer(id, listTools());
			case "tools/call": {
				const name = own(params, "name");
				if (typeof name !== "string") return fail(id, RpcErrorCodes.INVALID_PARAMS, "tools/call needs the name of a tool.");
				const result = await callTool(name, own(params, "arguments"));
				if (result === undefined) return fail(id, RpcErrorCodes.INVALID_PARAMS, `There is no tool named ${JSON.stringify(name.slice(0, 200))}.`);
				return answer(id, result);
			}
			default:
				return fail(id, RpcErrorCodes.METHOD_NOT_FOUND, `This server does not offer ${JSON.stringify(method.slice(0, 200))}.`);
		}
	};

	const handle = async (text: string): Promise<string | undefined> => {
		let message: unknown;
		try {
			message = JSON.parse(text);
		} catch {
			return fail(null, RpcErrorCodes.PARSE_ERROR, "The message is not JSON.");
		}
		if (!isRecord(message)) return fail(null, RpcErrorCodes.INVALID_REQUEST, "The message must be one JSON-RPC object.");
		const rawId = own(message, "id");
		const hasId = rawId !== undefined;
		// An answer the client sent to a request of ours; this server makes none.
		if (!Object.prototype.hasOwnProperty.call(message, "method") && hasId) return undefined;
		const id: RequestId = typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
		const method = own(message, "method");
		const params = own(message, "params");
		if (own(message, "jsonrpc") !== "2.0" || typeof method !== "string" || (hasId && id === null) || (params !== undefined && !isRecord(params))) {
			return hasId || typeof method !== "string" ? fail(id, RpcErrorCodes.INVALID_REQUEST, "The message is not a JSON-RPC 2.0 request.") : undefined;
		}
		// A notification (initialized, cancelled, progress) asks for nothing back.
		if (!hasId) return undefined;
		try {
			return await dispatch(id, method, params ?? {});
		} catch {
			return fail(id, RpcErrorCodes.INTERNAL_ERROR, "The server failed while answering.");
		}
	};

	return { handle, listTools, callTool };
}
