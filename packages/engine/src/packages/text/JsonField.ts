/**
 * Reading one field out of a piece of JSON text.
 *
 * JSON is the text an API answers with, and the form `jwt(...)` and
 * `query(...)` hand back their contents in: `{"sub":"1234","admin":true}`.
 * This reads the value at a path such as `user.name` or `items[0].price` and
 * reports what it found as a plain result, or says precisely why there is
 * nothing there. The text is parsed as data by `JSON.parse` and never run.
 */

/** What a path led to: a value the engine can hold, or the reason there is none. */
export type FieldReading =
	| { readonly kind: "number"; readonly value: number }
	| { readonly kind: "text"; readonly value: string }
	| { readonly kind: "boolean"; readonly value: boolean }
	| { readonly kind: "fault"; readonly code: string; readonly message: string };

/** The codes a field read can be refused with. */
export const FIELD_FAULT_CODES = {
	/** The text is not a JSON object or list. */
	NOT_JSON: "TEXT_NOT_JSON",
	/** The path is empty or badly written, such as `a..b` or `a[x]`. */
	BAD_PATH: "TEXT_FIELD_PATH_INVALID",
	/** The path leads nowhere in this JSON. */
	NOT_FOUND: "TEXT_FIELD_NOT_FOUND",
	/** The field is there and holds `null`, which is no value at all. */
	NULL: "TEXT_FIELD_NULL",
	/** The field holds a whole number past 2^53, which a double cannot hold exactly. */
	INEXACT: "TEXT_FIELD_INEXACT_NUMBER",
} as const;

/** How many keys a not-found message lists before summarising the rest. */
const KEYS_LISTED = 10;

/** One step of a path: an object key, or a list position. */
type Step = { readonly key: string } | { readonly index: number };

/**
 * Split a path into steps. A dot separates keys and `[n]` picks the nth entry
 * of a list, counting from 0, so `items[0].price` and `items.0.price` are the
 * same path. Returns null when the path is empty or malformed.
 */
function parsePath(path: string): Step[] | null {
	const steps: Step[] = [];
	let i = 0;
	let expectKey = true;
	while (i < path.length) {
		const ch = path[i];
		if (ch === "[") {
			const close = path.indexOf("]", i);
			const digits = close === -1 ? "" : path.slice(i + 1, close);
			if (!/^\d+$/.test(digits)) return null;
			steps.push({ index: Number(digits) });
			i = close + 1;
			expectKey = false;
			continue;
		}
		if (ch === ".") {
			if (expectKey) return null;
			i++;
			expectKey = true;
			continue;
		}
		if (!expectKey) return null;
		let j = i;
		while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
		steps.push({ key: path.slice(i, j) });
		i = j;
		expectKey = false;
	}
	if (steps.length === 0 || expectKey) return null;
	return steps;
}

/** The path up to and including step `n`, written the way the reader wrote it. */
function describe(steps: readonly Step[], upTo: number): string {
	let out = "";
	for (let i = 0; i <= upTo; i++) {
		const step = steps[i];
		out += "index" in step ? `[${step.index}]` : `${out === "" ? "" : "."}${step.key}`;
	}
	return out;
}

/** A sentence listing an object's keys, so a misspelt path shows what was there. */
function keysSentence(object: Record<string, unknown>): string {
	const keys = Object.keys(object);
	if (keys.length === 0) return "it has no fields";
	const listed = keys.slice(0, KEYS_LISTED).map((k) => `"${k}"`).join(", ");
	const more = keys.length > KEYS_LISTED ? `, and ${keys.length - KEYS_LISTED} more` : "";
	return `its fields are ${listed}${more}`;
}

function fault(code: string, message: string): FieldReading {
	return { kind: "fault", code, message };
}

/** JSON.parse, or undefined when the text is not a JSON object or list. */
function tryParse(text: string): unknown {
	if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * The JSON a text holds, or undefined.
 *
 * A quoted string in a line keeps a backslash before each quotation mark
 * inside it, because `\"` is the only way to write one there, so JSON typed
 * into a line reads as `{\"total\": 12.5}`. When the text is not JSON as it
 * stands but is once each `\"` is read as a quotation mark, that reading is
 * taken. Text that is JSON as it stands, like the output of `jwt(...)`, is
 * never rewritten.
 */
function parseJson(text: string): unknown {
	const direct = tryParse(text);
	if (direct !== undefined || text.indexOf('\\"') === -1) return direct;
	return tryParse(text.split('\\"').join('"'));
}

/**
 * Read the value at `path` in the JSON `text`.
 *
 * A number comes back as a number, a string as text, `true` and `false` as a
 * boolean, and an object or a list as its compact JSON text, so it can be read
 * further or measured. `null` and a missing field are refused by name, and so
 * is a whole number too large to hold exactly, rather than answered with the
 * nearest double's digits.
 *
 * @param text - JSON text whose top level is an object or a list.
 * @param path - The field, as `a.b`, `a[0]` or `a.0.b`.
 */
export function readJsonField(text: string, path: string): FieldReading {
	const steps = parsePath(path);
	if (steps === null) {
		return fault(FIELD_FAULT_CODES.BAD_PATH, `"${path}" is not a field path: name the fields with dots between them, and a list entry by its position in brackets, as in "items[0].price"`);
	}
	const root = parseJson(text.trim());
	if (root === undefined) {
		return fault(FIELD_FAULT_CODES.NOT_JSON, "field(...) reads JSON, the {\"name\": value} text an API returns, and this text is not JSON. To pull a labelled value out of ordinary text, match it with a pattern: match(text, \"Total: (\\S+)\")");
	}

	let current: unknown = root;
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		const where = i === 0 ? "at the top" : `at "${describe(steps, i - 1)}"`;
		if (Array.isArray(current)) {
			const index = "index" in step ? step.index : /^\d+$/.test(step.key) ? Number(step.key) : -1;
			if (index < 0 || index >= current.length) {
				const size = current.length === 0 ? "an empty list" : `a list of ${current.length}, numbered 0 to ${current.length - 1}`;
				return fault(FIELD_FAULT_CODES.NOT_FOUND, `The JSON has no "${describe(steps, i)}": ${where} there is ${size}`);
			}
			current = current[index];
			continue;
		}
		if (current !== null && typeof current === "object") {
			const record = current as Record<string, unknown>;
			const key = "index" in step ? String(step.index) : step.key;
			// An own-property check: a key spelt like an inherited name
			// (`constructor`, `toString`) must not read a function off the prototype.
			if (!Object.prototype.hasOwnProperty.call(record, key)) {
				return fault(FIELD_FAULT_CODES.NOT_FOUND, `The JSON has no "${describe(steps, i)}": ${where} ${keysSentence(record)}`);
			}
			current = record[key];
			continue;
		}
		return fault(FIELD_FAULT_CODES.NOT_FOUND, `The JSON has no "${describe(steps, i)}": "${describe(steps, i - 1)}" is a single value, not an object or a list`);
	}

	if (current === null) return fault(FIELD_FAULT_CODES.NULL, `The field "${path}" is null: it holds no value`);
	if (typeof current === "number") {
		if (Number.isInteger(current) && !Number.isSafeInteger(current)) {
			return fault(FIELD_FAULT_CODES.INEXACT, `The field "${path}" holds a whole number past 9,007,199,254,740,991, which cannot be read exactly; read it as text with match(...) instead`);
		}
		return { kind: "number", value: current };
	}
	if (typeof current === "string") return { kind: "text", value: current };
	if (typeof current === "boolean") return { kind: "boolean", value: current };
	try {
		return { kind: "text", value: JSON.stringify(current) };
	} catch {
		// Writing a list or object back out recurses, so one nested past the
		// runtime's stack cannot be shown, though it parsed.
		return fault(FIELD_FAULT_CODES.NOT_JSON, `The field "${path}" is nested too deeply to show as JSON`);
	}
}
