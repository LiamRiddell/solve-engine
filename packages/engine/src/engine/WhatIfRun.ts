/**
 * The pieces of a what-if run that do not need the engine's private state.
 *
 * A what-if (`line 4 with deposit = 150000`, a sweep, or the host's
 * {@link ExpressionEngine.whatIf}) re-runs a document's lines from their text in
 * a scratch engine, with some names held at values the reader chose. The
 * engine builds and drives that scratch engine; what lives here is the reading
 * either side of it: which lines a run may not re-run, whether a name is used
 * at all, and what the target line's answer is once the run is done.
 */
import type { QueryClient } from "@tanstack/query-core";
import type { Token } from "@solve-js/lexer";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { Value, ValueType, errorValue, numberValue } from "@solve-js/vm/Value";
import { ErrorFactory, normalizeUnknownError } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * The inputs a host holds fixed for {@link ExpressionEngine.whatIf}, by
 * variable name. Each is a number, an expression in text (`"$120"`, `"5%"`,
 * `"3 kg"`), or a `Value`.
 */
export type WhatIfOverrides = Readonly<Record<string, number | string | Value>>;

/**
 * The Value a host's override stands for, or a thrown refusal.
 *
 * Text is evaluated as an expression of its own, in the scratch engine before
 * any line has run, so `"$120"` is money and `"5%"` a percentage while a name
 * from the document (`"deposit * 2"`) is refused: it has no value there, and a
 * scenario's inputs are values rather than formulas over the document.
 *
 * @param name - The variable being overridden, for the message.
 * @param raw - The host's number, text or Value.
 * @param evaluate - Evaluates one expression in the scratch engine.
 * @throws `WHAT_IF_OVERRIDE_INVALID` for a non-finite number, text that fails
 * or evaluates to an error, or anything that is not one of the three.
 */
export function overrideValue(name: string, raw: number | string | Value, evaluate: (expression: string) => Value): Value {
	const refuse = (why: string) =>
		ErrorFactory.validation("WHAT_IF_OVERRIDE_INVALID", `The override for ${name} ${why}.`, { name });
	if (typeof raw === "number") {
		if (!Number.isFinite(raw)) throw refuse("is not a finite number");
		return numberValue(raw);
	}
	let value: Value;
	if (typeof raw === "string") {
		try {
			value = evaluate(raw);
		} catch (e) {
			throw refuse(`could not be read: ${normalizeUnknownError(e).message}`);
		}
	} else if (raw instanceof Value) {
		value = raw;
	} else {
		throw refuse("must be a number, an expression in text, or a Value");
	}
	if (value.type === ValueType.Error) throw refuse(`is an error: ${typeof value.unit === "string" ? value.unit : String(value.value)}`);
	if (value.type === ValueType.Pending) throw refuse("is still waiting on live data");
	return value;
}

/** A line's tokens, as the engine's own lexer reads them. */
export type Tokenize = (text: string) => Token[];

/**
 * The first line that sets a `global :name`, or -1 when none does.
 *
 * A global is shared with every other document in the process, so a scratch
 * re-run of a line that sets one would write the scenario's value where other
 * documents read it. That is the one side effect a scratch engine cannot keep
 * to itself, so a run over such a line is refused instead.
 *
 * @param texts - The lines of the span, line 1 first.
 * @param tokenize - The engine's lexer.
 * @returns The 1-based line, or -1.
 */
export function firstGlobalWrite(texts: readonly string[], tokenize: Tokenize): number {
	for (let i = 0; i < texts.length; i++) {
		// Every global write has a colon in it, and most lines do not.
		if (!texts[i].includes(":")) continue;
		const tokens = tokenize(texts[i]);
		for (let j = 0; j + 3 < tokens.length; j++) {
			if (
				tokens[j].type === "GLOBAL" &&
				tokens[j + 1].type === "COLON" &&
				(tokens[j + 2].type === "IDENT" || tokens[j + 2].type === "UNIT") &&
				tokens[j + 3].type === "EQUALS"
			) {
				return i + 1;
			}
		}
	}
	return -1;
}

/**
 * Whether a line mentions `name` as a word the lexer reads as a name.
 *
 * Deliberately generous: a name in a definition, a read, a function body or a
 * heading all count. It answers "could overriding this matter at all", which
 * is the question a misspelt input fails, and a false "yes" costs nothing but
 * an answer that did not change.
 *
 * @param text - The line.
 * @param name - The variable name.
 * @param tokenize - The engine's lexer.
 */
export function lineMentions(text: string, name: string, tokenize: Tokenize): boolean {
	if (!text.includes(name)) return false;
	return tokenize(text).some((t) => (t.type === "IDENT" || t.type === "UNIT") && t.value === name);
}

/**
 * Copy what one engine has already fetched into another's query cache.
 *
 * The scratch engine a what-if runs in has live data switched off, so that a
 * re-run never starts a fetch. Handing it the answers the document already has
 * keeps a line that reads a value fetched earlier (a weather reading, a stock
 * price) working in the re-run, exactly as it reads in the document.
 *
 * @param from - The document's engine's cache.
 * @param to - The scratch engine's cache.
 */
export function copyFetchedData(from: QueryClient, to: QueryClient): void {
	for (const query of from.getQueryCache().getAll()) {
		if (query.state.data !== undefined) to.setQueryData(query.queryKey, query.state.data);
	}
}

/**
 * The answer a re-run gives for its target line, or the error that says why
 * there is none.
 *
 * @param result - The scratch engine's pass over the span.
 * @param targetLine - The 1-based line asked about.
 * @param liveDataEnabled - Whether the document's own engine fetches live
 * data. The scratch engine never does, so when the document's engine would
 * have, a line that found nothing fetched is reported as live data a re-run
 * cannot fetch, rather than with the scratch engine's "switched off" message,
 * which would not be true of the reader's engine.
 * @returns The target's Value, which may itself be an error Value.
 */
export function targetAnswer(result: ParsingResult, targetLine: number, liveDataEnabled: boolean): Value {
	const line = result.lines[targetLine - 1];
	if (line === undefined) {
		return errorValue("WHAT_IF_LINE_OUT_OF_RANGE", `There is no line ${targetLine} to re-run.`);
	}
	if (line.error !== null) {
		return errorValue("WHAT_IF_TARGET_ERROR", `Line ${targetLine} has no answer with these inputs: ${line.error}`);
	}
	if (line.hasInlineSolves) {
		return errorValue(
			"WHAT_IF_TARGET_HAS_SEVERAL_ANSWERS",
			`Line ${targetLine} holds several inline answers, so a what-if cannot tell which one to give.`,
		);
	}
	const value = line.result;
	if (line.isEmpty || value === null) {
		return errorValue(
			"WHAT_IF_TARGET_NOT_A_CALCULATION",
			`Line ${targetLine} is not a calculation (it is prose, a heading or a blank line), so it has no answer to work out again.`,
		);
	}
	const waitsOnLiveData =
		value.type === ValueType.Pending ||
		(liveDataEnabled && value.type === ValueType.Error && value.value === "NETWORK_DISABLED");
	if (waitsOnLiveData) {
		return errorValue(
			"WHAT_IF_LIVE_DATA",
			`Line ${targetLine} depends on live data that has not arrived (a weather reading, a price, a rate, a global another document sets), and a what-if re-runs lines without fetching anything.`,
		);
	}
	return value;
}
