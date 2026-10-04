/**
 * Reading the command line into the options a run needs.
 *
 * Hand-written rather than taken from an argument library, because the package
 * promises one runtime dependency (the engine) and the grammar here is small.
 * Nothing in this module touches the file system or the engine: whether a word
 * names a file is decided later, by {@link classifyInput} in input.ts.
 */

import { quoted as shown } from "./terminal";

/** The three exit codes a run can end with. */
export const EXIT = {
	/** Every line answered (or every check passed). */
	OK: 0,
	/** A line failed, a check failed, or a live value never arrived. */
	FAILED: 1,
	/** The command could not run as asked: a bad option, or an input it refused. */
	USAGE: 2,
} as const;

/** One of {@link EXIT}'s values. */
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** The longest a `--wait` may be, ten minutes, so a typo cannot hold CI for hours. */
export const MAX_WAIT_MS = 600_000;

/** How long a run waits for live values when `--wait` is not given. */
export const DEFAULT_WAIT_MS = 10_000;

/** The longest `--tz` or `--seed` value read, so a hostile argument is refused by name. */
const MAX_OPTION_LENGTH = 200;

/** What the command line asked for. */
export interface CliOptions {
	/** `run` evaluates an expression or a document; `check` reports only the check lines. */
	command: "run" | "check" | "help" | "version";
	/** The words that are not options, in order. */
	positionals: string[];
	/** `-e`: read the words as an expression even when one names a file. */
	forceExpression: boolean;
	/** `--json`: one JSON object on standard output instead of text. */
	json: boolean;
	/** `--strict`: a line the engine could not read counts as a failure. */
	strict: boolean;
	/** `--tz`: the IANA zone dates are read in. */
	tz?: string;
	/** `--now`: the moment `today` and `now` read, in epoch milliseconds. */
	now?: number;
	/** `--seed`: makes random draws reproducible. A whole number is passed as a number. */
	seed?: number | string;
	/** `--network on|off`. Absent means the engine's default, which is on. */
	network?: boolean;
	/** `--wait`: how long to wait for live values, in milliseconds. */
	waitMs: number;
}

/** The outcome of reading the command line: options, or the reason it was refused. */
export type ParsedArguments = { ok: true; options: CliOptions } | { ok: false; message: string };

/** The options that take a value, by every spelling. */
const VALUE_OPTIONS: Readonly<Record<string, "tz" | "now" | "seed" | "network" | "wait">> = {
	"--tz": "tz",
	"--now": "now",
	"--seed": "seed",
	"--network": "network",
	"--wait": "wait",
};

/** The options that are switches, by every spelling. */
const FLAG_OPTIONS: Readonly<Record<string, "json" | "strict" | "expression" | "help" | "version">> = {
	"--json": "json",
	"--strict": "strict",
	"-e": "expression",
	"--expression": "expression",
	"-h": "help",
	"--help": "help",
	"-V": "version",
	"--version": "version",
};

/**
 * Whether a word that starts with a minus sign is an expression rather than an
 * option: `-5 + 3`, `-(2)`, `-.5`, and a lone `-`, which names standard input.
 */
function isNegativeOrStdin(word: string): boolean {
	return word === "-" || /^-[\d.(]/.test(word);
}

/** A moment written as epoch milliseconds or as an ISO 8601 instant with its offset. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The largest moment `Date` can hold, either side of 1970. */
const MAX_EPOCH_MS = 8.64e15;

/**
 * Reads a `--now` value into epoch milliseconds, or null when it is not one.
 *
 * A date and time with no offset is refused rather than guessed at: whether
 * `2026-01-01T09:00` means nine in London or in the zone `--tz` names is the
 * very question the option exists to settle, so the offset is asked for.
 */
export function parseNow(text: string): number | null {
	let ms: number;
	if (/^-?\d{1,16}$/.test(text)) ms = Number(text);
	else if (ISO_INSTANT.test(text) && isCalendarDay(text)) ms = Date.parse(text);
	else return null;
	return Number.isFinite(ms) && Math.abs(ms) <= MAX_EPOCH_MS ? ms : null;
}

/**
 * Whether an ISO instant's date is a day the calendar has. `Date.parse` rolls
 * 29 February 2027 over to 1 March rather than refusing it, which would pin
 * the clock to a day the reader never wrote.
 */
function isCalendarDay(text: string): boolean {
	const year = Number(text.slice(0, 4));
	const month = Number(text.slice(5, 7));
	const day = Number(text.slice(8, 10));
	const date = new Date(Date.UTC(2000, month - 1, day));
	date.setUTCFullYear(year);
	return month >= 1 && month <= 12 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Reads a `--seed` value: a safe whole number as a number, any other text as itself. */
export function parseSeed(text: string): number | string {
	if (/^-?\d{1,16}$/.test(text)) {
		const n = Number(text);
		if (Number.isSafeInteger(n)) return n;
	}
	return text;
}

/**
 * Reads the words after `solve` into {@link CliOptions}.
 *
 * `--name value` and `--name=value` are both read. `--` ends the options, so
 * `solve -- -x + 1` evaluates `-x + 1`. A word that starts with a minus and a
 * digit, a point or a bracket is an expression, not an option. The first
 * word `check` selects the check command only when a document follows it;
 * `solve -e check 1 == 1` evaluates the expression instead.
 *
 * @param argv - The arguments after the program name.
 * @returns The options, or a message naming what was wrong.
 */
export function parseArguments(argv: readonly string[]): ParsedArguments {
	const options: CliOptions = {
		command: "run",
		positionals: [],
		forceExpression: false,
		json: false,
		strict: false,
		waitMs: DEFAULT_WAIT_MS,
	};
	let help = false;
	let version = false;
	let optionsEnded = false;

	for (let i = 0; i < argv.length; i++) {
		const word = String(argv[i]);
		if (optionsEnded || !word.startsWith("-") || isNegativeOrStdin(word)) {
			options.positionals.push(word);
			continue;
		}
		if (word === "--") {
			optionsEnded = true;
			continue;
		}
		const eq = word.startsWith("--") ? word.indexOf("=") : -1;
		const name = eq > 0 ? word.slice(0, eq) : word;
		// Own-property lookups, so an option spelled `--constructor` or
		// `--__proto__` is unknown rather than a match on Object.prototype.
		const flag = hasOwn(FLAG_OPTIONS, name) ? FLAG_OPTIONS[name] : undefined;
		const valued = hasOwn(VALUE_OPTIONS, name) ? VALUE_OPTIONS[name] : undefined;

		if (flag !== undefined) {
			if (eq > 0) return { ok: false, message: `${name} takes no value.` };
			if (flag === "json") options.json = true;
			else if (flag === "strict") options.strict = true;
			else if (flag === "expression") options.forceExpression = true;
			else if (flag === "help") help = true;
			else version = true;
			continue;
		}
		if (valued === undefined) {
			return { ok: false, message: `${shown(name)} is not an option solve knows. Run solve --help for the list.` };
		}

		let value: string;
		if (eq > 0) value = word.slice(eq + 1);
		else if (i + 1 < argv.length) value = String(argv[++i]);
		else return { ok: false, message: `${name} needs a value after it.` };

		const refused = applyValue(options, valued, name, value);
		if (refused !== null) return { ok: false, message: refused };
	}

	if (help) options.command = "help";
	else if (version) options.command = "version";
	else if (!options.forceExpression && options.positionals[0] === "check" && options.positionals.length > 1) {
		options.command = "check";
		options.positionals.shift();
		if (options.positionals.length > 1) {
			return { ok: false, message: "solve check reads one document. Give one file, or - for standard input." };
		}
	}
	return { ok: true, options };
}

/** Whether a table has the key as its own property, not one it inherits. */
function hasOwn(table: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(table, key);
}

/** Stores one option's value, or returns why it was refused. */
function applyValue(options: CliOptions, key: "tz" | "now" | "seed" | "network" | "wait", name: string, value: string): string | null {
	if (value.length > MAX_OPTION_LENGTH) return `${name} is longer than ${MAX_OPTION_LENGTH} characters.`;
	switch (key) {
		case "tz":
			if (value.trim() === "") return "--tz needs a time zone name, such as Europe/London.";
			options.tz = value;
			return null;
		case "now": {
			const ms = parseNow(value);
			if (ms === null) {
				return `--now ${shown(value)} is not a moment solve can read. Give an instant with its offset, such as 2026-01-01T09:00:00Z, or milliseconds since 1970.`;
			}
			options.now = ms;
			return null;
		}
		case "seed":
			if (value === "") return "--seed needs a value, such as 42.";
			options.seed = parseSeed(value);
			return null;
		case "network":
			if (value === "on") options.network = true;
			else if (value === "off") options.network = false;
			else return `--network takes on or off, not ${shown(value)}.`;
			return null;
		case "wait": {
			if (!/^\d{1,7}$/.test(value) || Number(value) > MAX_WAIT_MS) {
				return `--wait takes a whole number of milliseconds from 0 to ${MAX_WAIT_MS}, not ${shown(value)}.`;
			}
			options.waitMs = Number(value);
			return null;
		}
	}
}

