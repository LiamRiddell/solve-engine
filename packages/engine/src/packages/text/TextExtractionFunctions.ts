/**
 * The plugin functions that read values out of pasted text: the numbers and
 * amounts of money in it (`numbers in`, `amounts in`, and the aggregates over
 * them), the part a pattern matches (`match`, `matches`, `matchcount`), and a
 * field of JSON (`field`).
 *
 * Each answers with a value or with a structured Error that names what went
 * wrong, never a throw and never a guessed number. Every one is bounded: a scan
 * stops at {@link MAX_NUMBERS_READ} numbers, and a pattern stops at a fixed
 * count of steps, so a pasted log of any size cannot hold up the engine.
 */
import { Value, ValueType, stringValue, numberValue, boolValue, uomValue, errorValue, rowVectorValue } from "@solve-js/vm/Value";
import { chargeAllocation, currentEvaluation } from "@solve-js/vm/AllocationBudget";
import { builtinFunctions } from "@solve-js/vm/VMBuiltins";
import { scanNumbers, numberFormatFor, type FoundNumber } from "./TextExtraction";
import {
	compilePattern, isPatternFault, PatternRunner, PatternBudget, PatternBudgetExceeded,
	PATTERN_FAULT_CODES, MAX_PATTERN_STEPS, type CompiledPattern,
} from "./TextPattern";
import { readJsonField, FIELD_FAULT_CODES } from "./JsonField";

/** The most numbers read out of one piece of text. */
export const MAX_NUMBERS_READ = 10_000;

/**
 * Every code the text-extraction forms can answer with, so a host can tell the
 * refusals apart without reading the sentence.
 */
export const TextExtractionErrorCodes = {
	/** A form was given something other than text where it reads text. */
	TEXT_EXPECTED: "TEXT_EXPECTED",
	/** A call form was given the wrong number of arguments. */
	TEXT_ARGUMENT_COUNT: "TEXT_ARGUMENT_COUNT",
	/** The text has no numbers for an aggregate to work on. */
	TEXT_NO_NUMBERS: "TEXT_NO_NUMBERS",
	/** The text has no amounts of money for an aggregate to work on. */
	TEXT_NO_AMOUNTS: "TEXT_NO_AMOUNTS",
	/** The text holds more numbers than one read allows. */
	TEXT_TOO_MANY_NUMBERS: "TEXT_TOO_MANY_NUMBERS",
	/** The pattern does not occur in the text. */
	TEXT_NO_MATCH: "TEXT_NO_MATCH",
	/** Matching took more steps than one call allows. */
	TEXT_PATTERN_TOO_COSTLY: "TEXT_PATTERN_TOO_COSTLY",
	/** The pattern is not well formed. */
	TEXT_PATTERN_INVALID: PATTERN_FAULT_CODES.INVALID,
	/** The pattern uses a feature the matcher refuses. */
	TEXT_PATTERN_UNSUPPORTED: PATTERN_FAULT_CODES.UNSUPPORTED,
	/** The pattern is past a size limit. */
	TEXT_PATTERN_TOO_LARGE: PATTERN_FAULT_CODES.TOO_LARGE,
	/** `field` was given text that is not JSON. */
	TEXT_NOT_JSON: FIELD_FAULT_CODES.NOT_JSON,
	/** `field` was given a malformed path. */
	TEXT_FIELD_PATH_INVALID: FIELD_FAULT_CODES.BAD_PATH,
	/** The path leads nowhere in the JSON. */
	TEXT_FIELD_NOT_FOUND: FIELD_FAULT_CODES.NOT_FOUND,
	/** The field holds `null`. */
	TEXT_FIELD_NULL: FIELD_FAULT_CODES.NULL,
	/** The field holds a whole number too large to read exactly. */
	TEXT_FIELD_INEXACT_NUMBER: FIELD_FAULT_CODES.INEXACT,
} as const;

const CODES = TextExtractionErrorCodes;

/** The shipped aggregates an extraction may feed, by builtin index, with the phrase each is written as. */
const AGGREGATES: ReadonlyMap<number, string> = new Map([
	[42, "average of"],
	[43, "median of"],
	[44, "total of"],
	[45, "count of"],
	[101, "standard deviation of"],
	[102, "sample standard deviation of"],
	[103, "variance of"],
	[104, "sample variance of"],
	[105, "spread of"],
	[106, "mode of"],
]);

/** The builtin index of `count of`, the one aggregate with an answer for an empty text. */
const COUNT_INDEX = 45;

/** The text of a String value, or null when the value is not text. */
function asText(value: Value | undefined): string | null {
	return value?.type === ValueType.String ? (value.value as string) : null;
}

/** A clear "this wanted text" error for an operation given a non-string. */
function expectedText(operation: string): Value {
	return errorValue(CODES.TEXT_EXPECTED, `${operation} expects text (a "quoted string")`);
}

/** A pattern as it appears in a message, shortened when long. */
function quoted(pattern: string): string {
	return pattern.length > 60 ? `"${pattern.slice(0, 57)}..."` : `"${pattern}"`;
}

/**
 * The call forms' argument check: a wrong count is refused by name rather than
 * the missing argument read as nothing.
 */
function argumentCountFault(name: string, args: Value[], expected: number, example: string): Value | null {
	if (args.length === expected) return null;
	return errorValue(CODES.TEXT_ARGUMENT_COUNT, `${name} takes ${expected} arguments, but was given ${args.length}, as in ${example}`);
}

/**
 * The numbers (or, with `money`, the amounts) in a text, or the Error that
 * says why they cannot be read.
 */
function readNumbers(operation: string, args: Value[], money: boolean): FoundNumber[] | Value {
	const text = asText(args[0]);
	if (text === null) return expectedText(operation);
	const localeCode = asText(args[1]) ?? "en";
	const found = scanNumbers(text, numberFormatFor(localeCode), MAX_NUMBERS_READ);
	if (!Array.isArray(found)) {
		return errorValue(
			CODES.TEXT_TOO_MANY_NUMBERS,
			`${operation}: this text holds more than ${MAX_NUMBERS_READ.toLocaleString("en-US")} numbers, the limit for reading numbers out of one piece of text`,
		);
	}
	return money ? found.filter((n) => n.currency !== undefined) : found;
}

/** The refusal for a text with nothing to read. */
function nothingFound(operation: string, money: boolean): Value {
	return money
		? errorValue(CODES.TEXT_NO_AMOUNTS, `${operation}: there are no amounts of money in this text. An amount is a number with a currency sign or code beside it, as in £3.20, $5 or 12 EUR`)
		: errorValue(CODES.TEXT_NO_NUMBERS, `${operation}: there are no numbers in this text`);
}

/** `numbers in X` and `amounts in X`: the list of what was found. */
function extractList(operation: string, money: boolean): (args: Value[]) => Value {
	return (args) => {
		const found = readNumbers(operation, args, money);
		if (found instanceof Value) return found;
		if (found.length === 0) return nothingFound(operation, money);
		// A list holds plain numbers, so an amount's currency is not carried
		// into it; the aggregates, which read the amounts directly, keep it.
		return rowVectorValue(found.map((n) => n.value));
	};
}

/** Compile a pattern argument, or the Error that says why it cannot be used. */
function patternFrom(name: string, args: Value[], keepGroups: boolean, example: string): { text: string; source: string; pattern: CompiledPattern } | Value {
	const countFault = argumentCountFault(name, args, 2, example);
	if (countFault) return countFault;
	const text = asText(args[0]);
	const source = asText(args[1]);
	if (text === null || source === null) return errorValue(CODES.TEXT_EXPECTED, `${name} expects text and a pattern, both "quoted", as in ${example}`);
	const compiled = compilePattern(source, keepGroups);
	if (isPatternFault(compiled)) return errorValue(compiled.code, `${name}: in the pattern ${quoted(source)}, ${compiled.message}`);
	return { text, source, pattern: compiled };
}

/**
 * The steps the pattern forms have spent in the evaluation in flight, keyed by
 * that evaluation so the tally resets itself when the next one opens (see
 * `currentEvaluation()` in vm/AllocationBudget.ts). A call made outside any
 * evaluation, as a unit test makes, starts from nothing.
 */
const tally = { evaluation: 0, spent: 0 };

/** Run a search, turning a spent budget into the Error that names it. */
function withBudget(name: string, source: string, run: (budget: PatternBudget) => Value): Value {
	const evaluation = currentEvaluation();
	if (evaluation === 0 || evaluation !== tally.evaluation) {
		tally.evaluation = evaluation;
		tally.spent = 0;
	}
	const budget = new PatternBudget(MAX_PATTERN_STEPS, tally.spent);
	try {
		return run(budget);
	} catch (signal) {
		if (!(signal instanceof PatternBudgetExceeded)) throw signal;
		return errorValue(
			CODES.TEXT_PATTERN_TOO_COSTLY,
			`${name}: matching the pattern ${quoted(source)} against this text took more than ${MAX_PATTERN_STEPS.toLocaleString("en-US")} steps, the limit for evaluating one line. Use a shorter text or a simpler pattern`,
		);
	} finally {
		tally.spent = budget.spent;
	}
}

/**
 * The text package's extraction functions, keyed by the names the parselets
 * and call forms emit. Merged into the package's plugin functions.
 */
export const TEXT_EXTRACTION_FUNCTIONS: Record<string, (args: Value[]) => Value> = {
	// `numbers in X`: every number, as a list. Args: text, locale code.
	textNumbers: extractList("numbers in", false),
	// `amounts in X`: every amount of money, as a list of their numbers.
	textAmounts: extractList("amounts in", true),

	// `total of numbers in X`, `average of amounts in X`, ...: the shipped
	// aggregate, handed the values read from the text. Args: text, builtin
	// index, "numbers" or "amounts", locale code.
	textExtractAggregate: (args: Value[]): Value => {
		const index = args[1]?.type === ValueType.Number ? (args[1].value as number) : -1;
		const phrase = AGGREGATES.get(index);
		const money = asText(args[2]) === "amounts";
		const operation = `${phrase ?? "an aggregate of"} ${money ? "amounts" : "numbers"} in`;
		if (phrase === undefined) return errorValue(CODES.TEXT_EXPECTED, `${operation}: not an aggregate the text package can feed`);
		const found = readNumbers(operation, [args[0], args[3]], money);
		if (found instanceof Value) return found;
		if (found.length === 0 && index !== COUNT_INDEX) return nothingFound(operation, money);
		chargeAllocation(found.length, "numbers read from text");
		const values = found.map((n) => (n.currency === undefined || !money ? numberValue(n.value) : uomValue(n.value, n.currency)));
		return builtinFunctions[index](values);
	},

	// `match(text, pattern)`: the first group that took part in the first
	// match, or the whole match when no group did.
	textMatch: (args: Value[]): Value => {
		const example = 'match("Order #4471", "#(\\d+)")';
		const input = patternFrom("match", args, true, example);
		if (input instanceof Value) return input;
		const { text, source, pattern } = input;
		return withBudget("match", source, (budget) => {
			const slots = new PatternRunner(pattern, text, budget).search(0);
			if (slots === null) return errorValue(CODES.TEXT_NO_MATCH, `match: the pattern ${quoted(source)} does not occur in the text`);
			for (let group = 1; group <= pattern.groupCount; group++) {
				const start = slots[2 * group];
				const end = slots[2 * group + 1];
				if (start !== -1 && end !== -1) return stringValue(text.slice(start, end));
			}
			return stringValue(text.slice(slots[0], slots[1]));
		});
	},

	// `matches(text, pattern)`: whether the pattern occurs anywhere.
	textMatches: (args: Value[]): Value => {
		const input = patternFrom("matches", args, false, 'matches("2026-09-23", "^\\d{4}-\\d{2}-\\d{2}$")');
		if (input instanceof Value) return input;
		const { text, source, pattern } = input;
		return withBudget("matches", source, (budget) => boolValue(new PatternRunner(pattern, text, budget).search(0) !== null));
	},

	// `matchcount(text, pattern)`: how many times the pattern occurs, without overlaps.
	textMatchCount: (args: Value[]): Value => {
		const input = patternFrom("matchcount", args, false, 'matchcount("a1 b22 c333", "\\d+")');
		if (input instanceof Value) return input;
		const { text, source, pattern } = input;
		return withBudget("matchcount", source, (budget) => {
			let count = 0;
			new PatternRunner(pattern, text, budget).each(() => {
				count++;
				return true;
			});
			return numberValue(count);
		});
	},

	// `field(json, "path")`: one value out of JSON text.
	textField: (args: Value[]): Value => {
		const example = 'field(jwt(token), "sub")';
		const countFault = argumentCountFault("field", args, 2, example);
		if (countFault) return countFault;
		const text = asText(args[0]);
		const path = asText(args[1]);
		if (text === null || path === null) return errorValue(CODES.TEXT_EXPECTED, `field expects JSON text and a "quoted" field name, as in ${example}`);
		const reading = readJsonField(text, path);
		switch (reading.kind) {
			case "number":
				return numberValue(reading.value);
			case "text":
				return stringValue(reading.value);
			case "boolean":
				return boolValue(reading.value);
			default:
				return errorValue(reading.code, reading.message);
		}
	},
};
