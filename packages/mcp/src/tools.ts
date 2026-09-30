/**
 * The three tools the server offers, as plain functions from arguments to a
 * result object, with no protocol in sight. server.ts wraps them for MCP.
 *
 * Every call builds its own engine and clears it in a `finally`, so no call
 * can read what another left behind: not a variable, not a user unit, not a
 * cached live value. The engine is built without `solve-global-variables`,
 * whose `global :name` is the one syntax that reaches outside a document
 * into a store shared by every engine in the process; without the package the
 * syntax is a parse error, and the store is unreachable. The network is off
 * unless whoever started the server turned it on, since a tool call is text
 * from a model, and a model should not be the one deciding to fetch.
 *
 * The waiting and the result shapes are the `solve` command's own
 * (packages/cli/src/evaluate.ts), bundled into this package at build time, so
 * the object a tool returns is the object `solve --json` prints, with `ok`
 * in place of the exit code.
 */

import type { CalendarBackend, DateCalendarOptions, EngineOptions, ExpressionEngine, IEnginePackage } from "solve-engine";
import type { ParsingResult } from "solve-engine/engine";
import { parseNow, parseSeed } from "../../cli/src/arguments";
import {
	answerExpression,
	checkReport,
	codeOf,
	documentReport,
	evaluateDocumentSettled,
	expressionReport,
	isKnownZone,
	messageOf,
} from "../../cli/src/evaluate";

/** The engine functions the tools call, so a test can hand in its own. */
export interface ServerKit {
	/** Builds an engine with exactly the packages given, `new ExpressionEngine(options)`. */
	createEngine(options: EngineOptions): ExpressionEngine;
	/** The packages to start from, `BUILTIN_PACKAGES`; the excluded ones are taken out of it. */
	packages: readonly IEnginePackage[];
	/** Evaluates a whole document, `evaluateDocument` from `solve-engine/engine`. */
	evaluateDocument(engine: ExpressionEngine, text: string): ParsingResult;
	/** A `Date` calendar in a named zone, `dateCalendarInZone` from `solve-engine`. */
	dateCalendarInZone(zone: string, options?: DateCalendarOptions): CalendarBackend;
	/** The engine's version. */
	engineVersion: string;
	/** This server's version. */
	serverVersion: string;
}

/** What the person who started the server chose. A tool call cannot change any of it. */
export interface ServerSettings {
	/** Whether a line may fetch live data. Off unless the server was started with `--network on`. */
	network: boolean;
	/** How long a call waits for live data, in milliseconds. */
	waitMs: number;
	/** The longest expression or document a call accepts, in characters. */
	maxInputChars: number;
}

/** The defaults the server starts with. */
export const DEFAULT_SETTINGS: Readonly<ServerSettings> = { network: false, waitMs: 10_000, maxInputChars: 1_000_000 };

/** The packages every call's engine is built without, by name. */
export const EXCLUDED_PACKAGES: readonly string[] = ["solve-global-variables"];

/** The codes a refused call carries that are the server's own rather than the engine's. */
export const ServerErrorCodes = {
	/** The expression or document is longer than the server accepts. */
	INPUT_TOO_LARGE: "INPUT_TOO_LARGE",
	/** An argument is not one the tool can use: an unknown zone, a moment that is not one, an empty expression. */
	INPUT_INVALID: "INPUT_INVALID",
	/** The engine refused the input as a whole and gave no code of its own. */
	EVALUATION_REFUSED: "EVALUATION_REFUSED",
} as const;

/** The arguments every tool shares, which pin what a line reads from outside. */
export interface PinArguments {
	/** The IANA zone dates are read in. */
	tz?: string;
	/** The moment `today` and `now` read: an ISO instant with its offset, or epoch milliseconds. */
	now?: string | number;
	/** Makes random draws the same on every call. */
	seed?: string | number;
}

/** A tool's outcome: a result object, or a coded refusal. */
export type ToolOutcome =
	| { ok: true; body: Record<string, unknown> }
	| { ok: false; error: { code: string; message: string } };

/** A coded refusal. */
function refuse(code: string, message: string): ToolOutcome {
	return { ok: false, error: { code, message } };
}

/** The engine options a call's pins describe, or why they were refused. */
export function engineOptionsFor(pins: PinArguments, settings: ServerSettings, kit: ServerKit): { ok: true; options: EngineOptions } | { ok: false; outcome: ToolOutcome } {
	const options: EngineOptions = {
		packages: kit.packages.filter((pkg) => !EXCLUDED_PACKAGES.includes(pkg.name)),
		config: { network: { enabled: settings.network } },
	};
	if (pins.seed !== undefined) {
		const seed = typeof pins.seed === "number" ? pins.seed : parseSeed(pins.seed);
		if (seed === "" || (typeof seed === "number" && !Number.isSafeInteger(seed))) {
			return { ok: false, outcome: refuse(ServerErrorCodes.INPUT_INVALID, "seed must be a whole number or some text.") };
		}
		options.random = { seed };
	}
	if (pins.tz !== undefined || pins.now !== undefined) {
		const zone = pins.tz ?? "UTC";
		if (!isKnownZone(zone)) {
			return { ok: false, outcome: refuse(ServerErrorCodes.INPUT_INVALID, `tz ${JSON.stringify(zone)} is not a time zone this server knows. Give an IANA name, such as Europe/London.`) };
		}
		let now: number | undefined;
		if (pins.now !== undefined) {
			const read = parseNow(String(pins.now));
			if (read === null) {
				return { ok: false, outcome: refuse(ServerErrorCodes.INPUT_INVALID, "now must be an instant with its offset, such as 2026-01-01T09:00:00Z, or milliseconds since 1970.") };
			}
			now = read;
		}
		try {
			options.calendar = kit.dateCalendarInZone(zone, now === undefined ? {} : { now: () => now as number });
		} catch (error) {
			return { ok: false, outcome: refuse(codeOf(error) ?? ServerErrorCodes.INPUT_INVALID, messageOf(error)) };
		}
	}
	return { ok: true, options };
}

/**
 * Runs one call on a fresh engine and clears it afterwards, whatever happened.
 * Anything the engine throws becomes a coded refusal rather than a protocol
 * error, so a hostile input costs its own call and nothing more.
 */
async function withEngine(
	text: string,
	what: string,
	pins: PinArguments,
	settings: ServerSettings,
	kit: ServerKit,
	body: (engine: ExpressionEngine) => Promise<Record<string, unknown>>,
): Promise<ToolOutcome> {
	if (typeof text !== "string") return refuse(ServerErrorCodes.INPUT_INVALID, `${what} must be text.`);
	if (text.length > settings.maxInputChars) {
		return refuse(ServerErrorCodes.INPUT_TOO_LARGE, `The ${what} is ${text.length} characters, and this server accepts at most ${settings.maxInputChars}.`);
	}
	const built = engineOptionsFor(pins, settings, kit);
	if (!built.ok) return built.outcome;
	const engine = kit.createEngine(built.options);
	// A call reads a live value by evaluating again once it has settled, so it
	// needs no per-line push; an empty hook tells the engine a host is there.
	engine.getBatcher().onLineResult = () => {};
	try {
		return { ok: true, body: await body(engine) };
	} catch (error) {
		return refuse(codeOf(error) ?? ServerErrorCodes.EVALUATION_REFUSED, messageOf(error));
	} finally {
		engine.clear();
	}
}

/** `evaluate_expression`: one expression, with no document around it. */
export function evaluateExpressionTool(args: { expression: string } & PinArguments, settings: ServerSettings, kit: ServerKit): Promise<ToolOutcome> {
	const text = args.expression;
	if (typeof text === "string" && text.trim() === "") {
		return Promise.resolve(refuse(ServerErrorCodes.INPUT_INVALID, "The expression is empty."));
	}
	return withEngine(text, "expression", args, settings, kit, async (engine) => {
		const report = expressionReport(await answerExpression(engine, text, settings.waitMs));
		return { ...report, ok: report.status === "answered" };
	});
}

/** `evaluate_document`: a whole note, one answer per evaluated line. */
export function evaluateDocumentTool(args: { document: string; strict?: boolean } & PinArguments, settings: ServerSettings, kit: ServerKit): Promise<ToolOutcome> {
	return withEngine(args.document, "document", args, settings, kit, async (engine) => {
		const result = await evaluateDocumentSettled(engine, kit.evaluateDocument, args.document, settings.waitMs);
		const report = documentReport(engine, result, settings.waitMs, args.strict === true);
		return { ...report, ok: report.failed === 0 };
	});
}

/** `check_document`: a note's check lines, and whether every one passed. */
export function checkDocumentTool(args: { document: string } & PinArguments, settings: ServerSettings, kit: ServerKit): Promise<ToolOutcome> {
	return withEngine(args.document, "document", args, settings, kit, async (engine) => {
		const result = await evaluateDocumentSettled(engine, kit.evaluateDocument, args.document, settings.waitMs);
		const report = checkReport(engine, result, settings.waitMs);
		return { ...report, ok: report.checks.every((c) => c.status === "passed") };
	});
}
