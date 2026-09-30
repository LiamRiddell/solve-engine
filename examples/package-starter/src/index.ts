/**
 * A starter for a third-party solve-engine package: one function, one phrase,
 * one `as` converter and one live-data lookup, built only from the engine's
 * public entry points. Copy the directory, rename the words, keep the shape.
 *
 * Each piece is explained in README.md before it is shown here.
 */

import { defineFunction, type IEnginePackage } from "solve-engine";
import type { PrefixParselet, Parser, BytecodeBuilder } from "solve-engine/parser";
import { BindingPower } from "solve-engine/parser";
import type { Token } from "solve-engine/lexer";
import { errorValue, stringValue, uomValue, ValueType, type Value } from "solve-engine/vm";

/** The engine versions this package is built and tested against: every 2.x. */
export const ENGINE_RANGE = "^2.0.0";

// ── The function ──────────────────────────────────────────────────────────

/**
 * `tip(40, 15)`: a 15% tip on 40, which is 6. Built with `defineFunction`,
 * which writes the call word, the parser rule and the argument checks, so a
 * wrong type (`tip("x", 15)`) is refused with `DEFINE_FUNCTION_ARGUMENT_TYPE`
 * rather than computed on.
 */
export const tipFunction: IEnginePackage = {
	...defineFunction({
		name: "tip",
		args: [
			{ name: "amount", type: "number" },
			{ name: "percent", type: "number" },
		],
		returns: "number",
		call: (amount, percent) => (amount * percent) / 100,
	}),
	engineVersion: ENGINE_RANGE,
};

// ── The phrase, the converter and the lookup ──────────────────────────────

/** What the host gives the package: where rainfall figures come from. */
export interface StarterOptions {
	/**
	 * The millimetres of rain today in `place`. The package never reaches a
	 * network itself; the host (or a test) says how. A rejection is shown as
	 * `STARTER_RAINFALL_FAILED`, never as a number.
	 */
	fetchRainfall: (place: string) => Promise<number>;
}

/** The longest place name the lookup sends on, so a pasted paragraph is refused rather than posted. */
export const MAX_PLACE_LENGTH = 80;

/**
 * Why `place` is not sent on, or null when it may be. A place is a short
 * name: text of at most {@link MAX_PLACE_LENGTH} characters, with no path
 * separator or control character, since a host that builds a URL from it
 * should never be handed `../` or a line break.
 */
export function placeProblem(place: unknown): string | null {
	if (typeof place !== "string") return "rainfall takes a place name in quotes, such as rainfall(\"Oslo\")";
	const trimmed = place.trim();
	if (trimmed === "") return "rainfall needs a place name";
	if (trimmed.length > MAX_PLACE_LENGTH) return `a place name is at most ${MAX_PLACE_LENGTH} characters`;
	if (/[\\/]/.test(trimmed)) return "a place name cannot contain a slash";
	// Control characters, including a line break, never belong in a place name.
	if (/[\u0000-\u001f\u007f]/.test(trimmed)) return "a place name cannot contain a control character";
	return null;
}

/** Seven as tally marks in fives: `||||| ||`. A count outside 0 to 100, or not whole, is returned unchanged. */
export function toTally(value: Value): Value {
	const n = value.toNumber();
	if (value.type !== ValueType.Number || !Number.isInteger(n) || n < 0 || n > 100) return value;
	return stringValue("|".repeat(n).replace(/(\|{5})(?=\|)/g, "$1 "));
}

/** `tea break`: the phrase takes no operands and answers a quarter of an hour. */
class TeaBreakParselet implements PrefixParselet {
	readonly category = "Starter";
	parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		builder.emitPluginCall("teaBreak", 0);
	}
}

/** `rainfall("Oslo")`: parses the bracketed argument and calls the lookup with it. */
class RainfallParselet implements PrefixParselet {
	readonly category = "Starter";
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");
		builder.emitPluginCall("rainfall", 1);
	}
}

/**
 * The package: the phrase `tea break`, the converter `as tally`, and the live
 * lookup `rainfall("<place>")`, which is Pending on its first evaluation and
 * settles to millimetres once the host's `fetchRainfall` answers.
 */
export function createStarterPackage(options: StarterOptions): IEnginePackage {
	// What each place's fetch settled to, and the fetches still on their way.
	// Once a promise settles the engine calls the function once more, and an
	// answer given then, from this cache, is the one it keeps; without it the
	// second call would ask the service again. A fetch still on its way is
	// shared the same way, so a line evaluated twice before the answer lands
	// asks once. Maps, so a place named like `constructor` is an ordinary key.
	// A figure that must refresh while a note is open belongs in an async
	// resolver with a refresh cadence instead (see the async data source guide).
	const settled = new Map<string, Value>();
	const inFlight = new Map<string, Promise<Value>>();
	const fetchOnce = (place: string): Value | Promise<Value> => {
		const key = place.toLowerCase();
		const known = settled.get(key);
		if (known !== undefined) return known;
		let pending = inFlight.get(key);
		if (pending === undefined) {
			pending = options
				.fetchRainfall(place)
				.then(
					(mm) => (Number.isFinite(mm) && mm >= 0 ? uomValue(mm, "mm") : errorValue("STARTER_RAINFALL_FAILED", `the rainfall service answered ${String(mm)}, which is not a rainfall`)),
					(error: unknown) => errorValue("STARTER_RAINFALL_FAILED", `the rainfall for ${place} could not be fetched: ${error instanceof Error ? error.message : String(error)}`),
				)
				.then((value) => {
					settled.set(key, value);
					return value;
				})
				.finally(() => inFlight.delete(key));
			inFlight.set(key, pending);
		}
		return pending;
	};

	return {
		name: "package-starter",
		engineVersion: ENGINE_RANGE,

		// A two-word phrase claims neither word on its own: `tea` and `break`
		// stay free for variables and prose.
		phrases: { "tea break": "STARTER_TEA_BREAK" },

		// A call word fires only before "(", so `:rainfall = 3` still defines a variable.
		callFusions: { rainfall: "STARTER_RAINFALL" },

		prefixParselets: {
			STARTER_TEA_BREAK: new TeaBreakParselet(),
			STARTER_RAINFALL: new RainfallParselet(),
		},

		pluginFunctions: {
			teaBreak: () => uomValue(15, "minutes"),
			rainfall: (args: Value[]) => {
				const place = args[0]?.type === ValueType.String ? (args[0].value as string) : undefined;
				const problem = placeProblem(place);
				if (problem !== null) return errorValue("STARTER_BAD_PLACE", problem);
				// A promise tells the engine the answer is on its way: the line is
				// Pending until it settles, and the value is kept for the next run.
				return fetchOnce(place!.trim());
			},
		},

		asConverters: { tally: toTally },

		tokenCategories: {
			STARTER_TEA_BREAK: "keyword",
			STARTER_RAINFALL: "function",
		},
	};
}

/** Both packages, for a host that wants the whole starter: `createEngine({ extraPackages: createStarterPackages(options) })`. */
export function createStarterPackages(options: StarterOptions): IEnginePackage[] {
	return [tipFunction, createStarterPackage(options)];
}
