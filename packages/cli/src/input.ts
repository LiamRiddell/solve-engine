/**
 * Deciding what the words on the command line name, and reading a document.
 *
 * `solve notes.md` and `solve 5 km in miles` share one form, so the command
 * decides by looking: a single word that names an existing file is a document,
 * and anything else is an expression. `-e` overrides the look for the rare
 * expression that is also the name of a file in the current directory.
 */

import { statSync, readFileSync, type Stats } from "node:fs";
import { quoted } from "./terminal";

/** The largest document read, 16 MiB: far past any note, and well short of what would exhaust memory. */
export const MAX_INPUT_BYTES = 16 * 1024 * 1024;

/** The file endings that mark a word as meant to be a document, so a missing one is named rather than evaluated. */
const DOCUMENT_ENDING = /\.(?:md|markdown|mdx|txt|text|solve)$/i;

/** What the positional words name. */
export type InputKind =
	| { kind: "expression"; text: string }
	| { kind: "file"; path: string }
	| { kind: "stdin" }
	| { kind: "refused"; message: string };

/**
 * Decides whether the words are an expression, a file, or standard input.
 *
 * @param words - The positional words, in order.
 * @param forceExpression - `-e` was given: the words are an expression whatever they name.
 * @param stat - Reads a path's details; the default is the file system's.
 * @returns What the words name, or why they were refused.
 */
export function classifyInput(
	words: readonly string[],
	forceExpression: boolean,
	stat: (path: string) => Stats = statSync,
): InputKind {
	if (words.length === 0) return { kind: "refused", message: "Nothing to evaluate. Give an expression or a document; solve --help lists the forms." };
	const text = words.join(" ");
	if (forceExpression || words.length > 1) return expressionOrRefusal(text);
	const word = words[0];
	if (word === "-") return { kind: "stdin" };

	let info: Stats | null = null;
	try {
		info = stat(word);
	} catch {
		info = null;
	}
	if (info === null) {
		if (DOCUMENT_ENDING.test(word)) return { kind: "refused", message: `There is no file ${quoted(word)}.` };
		return expressionOrRefusal(text);
	}
	if (info.isDirectory()) return { kind: "refused", message: `${quoted(word)} is a directory. Give a document inside it.` };
	if (!info.isFile()) {
		return { kind: "refused", message: `${quoted(word)} is not a regular file (a device, a pipe or a socket). To read a stream, pipe it to solve - instead.` };
	}
	return { kind: "file", path: word };
}

/** An expression, or a refusal when it holds nothing to evaluate. */
function expressionOrRefusal(text: string): InputKind {
	// The engine answers an empty line with 0, which is right inside a note
	// and a confident wrong number for a command that was given nothing.
	if (text.trim() === "") return { kind: "refused", message: "The expression is empty. Give something to evaluate, such as solve \"2 + 2\"." };
	return { kind: "expression", text };
}

/** A document's text, or why it could not be read. */
export type ReadOutcome = { ok: true; text: string } | { ok: false; message: string };

/**
 * Reads a document file, refusing one that is too large or is not text.
 *
 * The size is checked before the file is read, so a very large file costs a
 * `stat`, not its contents in memory.
 *
 * @param path - The file, as the command line named it.
 * @param limit - The largest size accepted, in bytes.
 * @returns The text, or a message naming the problem.
 */
export function readDocumentFile(path: string, limit: number = MAX_INPUT_BYTES): ReadOutcome {
	try {
		const info = statSync(path);
		if (info.size > limit) return { ok: false, message: tooLarge(quoted(path), limit) };
		const bytes = readFileSync(path);
		if (bytes.length > limit) return { ok: false, message: tooLarge(quoted(path), limit) };
		return decodeDocument(bytes, quoted(path));
	} catch (error) {
		const code = (error as { code?: unknown } | null)?.code;
		if (code === "EACCES" || code === "EPERM") return { ok: false, message: `${quoted(path)} cannot be read: permission denied.` };
		if (code === "EISDIR") return { ok: false, message: `${quoted(path)} is a directory. Give a document inside it.` };
		return { ok: false, message: `${quoted(path)} cannot be read.` };
	}
}

/** The message for an input past the size limit. */
export function tooLarge(name: string, limit: number): string {
	return `${name} is larger than ${Math.floor(limit / (1024 * 1024))} MiB, the most solve reads.`;
}

/**
 * Turns a document's bytes into text: UTF-8, with a leading byte-order mark
 * dropped. Bytes that are not UTF-8, or a NUL byte, mean the input is not a
 * text document (an image, a binary), and it is refused rather than evaluated
 * as whatever the replacement characters happen to spell.
 *
 * @param bytes - The raw input.
 * @param name - How a message should name the input.
 * @returns The text, or a message naming the problem.
 */
export function decodeDocument(bytes: Uint8Array, name: string): ReadOutcome {
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return { ok: false, message: `${name} is not UTF-8 text.` };
	}
	if (text.includes("\u0000")) return { ok: false, message: `${name} holds a NUL byte, so it is not a text document.` };
	return { ok: true, text: text.startsWith("\uFEFF") ? text.slice(1) : text };
}
