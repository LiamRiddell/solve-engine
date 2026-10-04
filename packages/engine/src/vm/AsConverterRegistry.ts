import { errorValue, type Value } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";

/**
 * A package-registered `as <name>` converter: the value on the left of `as`
 * in, the converted value out.
 *
 * The optional `context` is the per-line execution context the VM passes to
 * a plugin function, handed to a converter for the same reason: a converter
 * that reads a date computes through the engine's calendar backend on it
 * rather than a module-level default, so `<date> as weekday` and `weekday on
 * <date>` cannot disagree. A converter that needs nothing from it ignores it.
 */
export type AsConverter = (value: Value, context?: LineExecutionContext) => Value;

/**
 * How an `as` target matches a registry: `"exact"` when a converter is
 * registered under that spelling, `"folded"` when only its lower-cased form
 * is and reading it so changes no prefix, `"ambiguous"` when the lower-cased
 * form belongs to two spellings (`mw`), `"prefix"` when the one spelling it
 * folds to has a prefix of another case (`MV` for `mV`), and `undefined` when
 * nothing is registered.
 */
export type AsConverterMatch = "exact" | "folded" | "ambiguous" | "prefix" | undefined;

/**
 * The refusal for a lower-cased key two spellings share, such as `mw` for `mW`
 * and `MW`. It refuses by name rather than guess which prefix was meant.
 *
 * @param typed - The target as the reader wrote it.
 * @param spellings - The registered spellings that share its lower-cased form.
 */
function ambiguousCaseRefusal(typed: string, spellings: readonly string[]): Value {
	const choices = spellings.map((s) => `"as ${s}"`).join(" or ");
	return errorValue(
		"AS_CONVERTER_AMBIGUOUS_CASE",
		`"as ${typed}" could be ${choices}: write the unit with its prefix in its own case (m is milli, M is mega, p is pico, P is peta)`,
	);
}

/**
 * Whether reading `typed` as `spelling` would change the case of a prefix
 * letter whose case is its meaning: `MV` read as `mV` turns a mega into a
 * milli, and `PW` read as `pW` a peta into a pico. A one-letter unit has no
 * prefix (`as n` is the newton), so it is never such a change.
 */
function changesPrefixCase(typed: string, spelling: string): boolean {
	return spelling.length > 1 && typed[0] !== spelling[0] && "mMpP".includes(spelling[0]);
}

/**
 * The converter for a lower-cased key that two spellings share, kept in the
 * folded map so a reader of that map alone refuses too.
 */
function ambiguousCaseConverter(key: string, spellings: readonly string[]): AsConverter {
	return () => ambiguousCaseRefusal(key, spellings);
}

/**
 * One engine's `as <name>` converters, the store behind
 * `IEnginePackage.asConverters` (#710).
 *
 * Held on the engine's `EngineContext`, so a converter one engine registers is
 * invisible to every other engine in the process, and unregistering a package
 * from one engine leaves another's copy in place. A unit's prefix is carried by
 * its case (`mW` is a milliwatt, `MW` a megawatt), so a converter is kept both
 * under its exact spelling and under its lower-cased key, with the spellings
 * each key has, and a folded spelling two units share refuses by name (#824).
 * All three maps move together; none is meaningful without the others.
 *
 * Every map is a `Map`, so a name such as `constructor` or `__proto__` is a
 * key like any other and resolves to nothing it was not given.
 */
export class AsConverterRegistry {
	/**
	 * Converters by lower-cased key. A key two case-distinct spellings share
	 * holds a converter that refuses by name.
	 */
	readonly folded = new Map<string, AsConverter>();
	/** The converters whose registered name carries capitals, by that exact spelling. */
	readonly exact = new Map<string, AsConverter>();
	/**
	 * The spellings registered under each lower-cased key, so a second spelling
	 * that differs only by case (`MW` beside `mW`) is recognised as a case pair
	 * rather than a collision.
	 */
	private readonly spellings = new Map<string, string[]>();

	/**
	 * Register a converter. Warns (does not throw) on a name collision, since
	 * two independently authored packages picking one name is a real
	 * possibility and silently overwriting is worse than a visible warning.
	 * The warning is skipped when `handler` is the one already registered
	 * (a package's converters are module-level constants, registered afresh by
	 * every engine that loads the package).
	 *
	 * @param name - The converter's name, as a reader writes it after `as`.
	 * @param handler - The converter.
	 */
	register(name: string, handler: AsConverter): void {
		const key = name.toLowerCase();
		const spellings = this.spellings.get(key) ?? [];
		const known = spellings.includes(name);
		// A second spelling of the same key that differs only by case (`MW`
		// beside `mW`) is a case pair, not a collision: both keep their exact
		// spelling, and the shared lower-case key refuses by name.
		const casePair = !known && spellings.length > 0 && name !== key && !spellings.includes(key);
		const prior = known ? (name !== key ? this.exact.get(name) : this.folded.get(key)) : this.folded.get(key);
		if (prior && prior !== handler && !casePair) {
			console.warn(`[asConverterRegistry] Converter name "${key}" is already registered, so it is overwritten.`);
		}
		let next = spellings;
		if (!known && !casePair) {
			for (const spelling of spellings) this.exact.delete(spelling);
			next = [];
		}
		if (!known) next = [...next, name];
		this.spellings.set(key, next);
		if (name !== key) this.exact.set(name, handler);
		this.folded.set(key, next.length > 1 ? ambiguousCaseConverter(key, next) : handler);
	}

	/**
	 * Reverse a {@link register} call. A name never registered is ignored.
	 *
	 * @param name - The name as it was registered.
	 */
	unregister(name: string): void {
		const key = name.toLowerCase();
		this.exact.delete(name);
		const remaining = (this.spellings.get(key) ?? []).filter((s) => s !== name);
		if (remaining.length === 0) {
			this.spellings.delete(key);
			this.folded.delete(key);
			return;
		}
		// One spelling of a case pair is left: the lower-case key is its again.
		this.spellings.set(key, remaining);
		const survivor = remaining.length === 1 ? this.exact.get(remaining[0]) : undefined;
		this.folded.set(key, survivor ?? ambiguousCaseConverter(key, remaining));
	}

	/**
	 * How `typed` matches this registry; see {@link AsConverterMatch}.
	 *
	 * @param typed - The target as the reader wrote it.
	 */
	match(typed: string): AsConverterMatch {
		if (this.exact.has(typed)) return "exact";
		const key = typed.toLowerCase();
		if (!this.folded.has(key)) return undefined;
		const spellings = this.spellings.get(key) ?? [key];
		if (spellings.includes(typed)) return "exact";
		if (spellings.length > 1) return "ambiguous";
		return changesPrefixCase(typed, spellings[0]) ? "prefix" : "folded";
	}

	/**
	 * The converter an `as` target names. The spelling as typed is tried first,
	 * so `as mW` and `as MW` reach different units; then the lower-cased key,
	 * so `as ISO8601` still reaches `iso8601` and `as n` the newton. A folded
	 * spelling that two units share (`as mw`), or that would change a prefix's
	 * case (`as MV` when only `mV` is registered), gets a converter that refuses
	 * by name (#824).
	 *
	 * @param typed - The target as the reader wrote it.
	 * @returns The converter, or `undefined` when nothing is registered.
	 */
	resolve(typed: string): AsConverter | undefined {
		const match = this.match(typed);
		if (match === undefined) return undefined;
		if (match === "exact") return this.exact.get(typed) ?? this.folded.get(typed.toLowerCase());
		if (match === "folded") return this.folded.get(typed.toLowerCase());
		const spellings = this.spellings.get(typed.toLowerCase()) ?? [];
		if (match === "ambiguous") return () => ambiguousCaseRefusal(typed, spellings);
		return () => errorValue(
			"AS_CONVERTER_PREFIX_CASE",
			`"as ${typed}" is not a unit: the one spelled alike is "as ${spellings[0]}", whose prefix is written in the other case (m is milli, M is mega, p is pico, P is peta)`,
		);
	}
}
