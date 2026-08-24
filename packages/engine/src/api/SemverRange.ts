/**
 * A small semver-range checker, enough for engine-version package gating.
 *
 * Replaces a dependency on `semver` that backed a single caret/range check in
 * {@link EngineVersionCompatibility}. The whole of `semver`'s named-import slice
 * pulled into the bundle for that one use; this covers the range grammar a
 * package's declared `engineVersion` actually uses, and nothing more:
 *
 * - exact `1.2.0`,
 * - caret `^1.2.0` (with node-semver's documented `0.x` narrowing: `^0.1.0` is
 *   `>=0.1.0 <0.2.0`, `^0.0.3` is `>=0.0.3 <0.0.4`),
 * - tilde `~1.2.0` (`>=1.2.0 <1.3.0`),
 * - comparators `>=`, `<=`, `>`, `<`, `=`,
 * - AND by whitespace (`>=0.2.0 <1.0.0`) and OR by `||`,
 * - the `*` / `x` wildcard.
 *
 * Anything it cannot parse is reported invalid rather than guessed at, so a
 * typo in a package's own descriptor surfaces as a distinct error (see
 * {@link EngineVersionCompatibility}). Prerelease and build tails are not part
 * of the grammar: {@link coerceVersion} drops them, so a `1.0.0-beta.0` engine
 * is compared as the `1.0.0` release it presents the API of.
 */

/** A `[major, minor, patch]` version, with any prerelease/build tail dropped. */
export type SemverVersion = readonly [number, number, number];

type Op = "<" | "<=" | ">" | ">=" | "=";
interface Comparator {
	readonly op: Op;
	readonly v: SemverVersion;
}

const VERSION_CORE = /(\d+)\.(\d+)\.(\d+)/;
const NUMERIC_PART = /^\d+$/;

/**
 * Parse a version to `[major, minor, patch]`, ignoring any prerelease or build
 * tail so `1.0.0-beta.0` reads as `1.0.0`. Returns `null` when no
 * `major.minor.patch` core is present.
 */
export function coerceVersion(input: string): SemverVersion | null {
	const match = VERSION_CORE.exec(input.trim());
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Order two versions the semver way: major, then minor, then patch. */
function compare(a: SemverVersion, b: SemverVersion): number {
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Parse `major[.minor[.patch]]` with numeric parts only, missing parts filled
 * with 0. Returns `null` if any present part is not a number, so a non-version
 * token (`garbage`, `not`) is rejected rather than coerced.
 */
function parseParts(text: string): SemverVersion | null {
	const parts = text.split(".");
	if (parts.length === 0 || parts.length > 3) return null;
	const nums = [0, 0, 0];
	for (let i = 0; i < parts.length; i++) {
		if (!NUMERIC_PART.test(parts[i])) return null;
		nums[i] = Number(parts[i]);
	}
	return [nums[0], nums[1], nums[2]];
}

/** `^a.b.c` -> `>=a.b.c` and the narrowed upper bound node-semver uses for 0.x. */
function caret([a, b, c]: SemverVersion): Comparator[] {
	const upper: SemverVersion = a > 0 ? [a + 1, 0, 0] : b > 0 ? [0, b + 1, 0] : [0, 0, c + 1];
	return [
		{ op: ">=", v: [a, b, c] },
		{ op: "<", v: upper },
	];
}

/** `~a.b.c` -> `>=a.b.c <a.(b+1).0`. */
function tilde([a, b, c]: SemverVersion): Comparator[] {
	return [
		{ op: ">=", v: [a, b, c] },
		{ op: "<", v: [a, b + 1, 0] },
	];
}

/**
 * One whitespace-delimited token to the comparators it imposes (ALL must hold),
 * or `null` when it is not a recognised comparator. `*` / `x` / empty impose no
 * constraint (an empty comparator list, which every version satisfies).
 */
function parseComparator(token: string): Comparator[] | null {
	if (token === "" || token === "*" || token === "x" || token === "X") return [];
	if (token[0] === "^") {
		const v = parseParts(token.slice(1));
		return v && caret(v);
	}
	if (token[0] === "~") {
		const v = parseParts(token.slice(1));
		return v && tilde(v);
	}
	const opMatch = /^(>=|<=|>|<|=)/.exec(token);
	const op = (opMatch ? opMatch[1] : "=") as Op;
	const v = parseParts(opMatch ? token.slice(opMatch[1].length) : token);
	return v && [{ op, v }];
}

/**
 * Parse a range into OR-clauses of AND-comparators, or `null` if any token is
 * unrecognised. A clause with no tokens (a bare `*` or empty string) is the
 * always-true clause.
 */
function parseRange(range: string): Comparator[][] | null {
	const clauses: Comparator[][] = [];
	for (const orClause of range.split("||")) {
		const tokens = orClause.trim().split(/\s+/).filter((token) => token !== "");
		const comparators: Comparator[] = [];
		for (const token of tokens) {
			const parsed = parseComparator(token);
			if (parsed === null) return null;
			comparators.push(...parsed);
		}
		clauses.push(comparators);
	}
	return clauses;
}

/**
 * Whether `range` is a range this checker can parse. A range it cannot parse is
 * reported invalid rather than treated as an unsatisfied constraint, so a typo
 * is distinguishable from a genuine version mismatch.
 */
export function isValidRange(range: string): boolean {
	return parseRange(range.trim()) !== null;
}

/** Whether a version satisfies one primitive comparator. */
function satisfiesComparator(version: SemverVersion, comparator: Comparator): boolean {
	const ordering = compare(version, comparator.v);
	switch (comparator.op) {
		case "<":
			return ordering < 0;
		case "<=":
			return ordering <= 0;
		case ">":
			return ordering > 0;
		case ">=":
			return ordering >= 0;
		case "=":
			return ordering === 0;
	}
}

/**
 * Whether `version` satisfies `range`. An unparseable range is not satisfied by
 * anything; callers that need to tell "invalid range" apart from "valid range,
 * not satisfied" check {@link isValidRange} first.
 */
export function satisfies(version: SemverVersion, range: string): boolean {
	const clauses = parseRange(range.trim());
	if (clauses === null) return false;
	return clauses.some((clause) => clause.every((comparator) => satisfiesComparator(version, comparator)));
}
