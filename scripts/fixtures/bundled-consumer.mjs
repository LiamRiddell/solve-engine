/**
 * The consumer that `scripts/check-tree-shaking.mjs` runs twice: once directly
 * under Node, once after bundling it with Rollup. Both runs print this report
 * and the two have to match exactly.
 *
 * It is a fixture rather than a string inside the checker so that a developer
 * can run it by hand to see the baseline:
 *
 *   node scripts/fixtures/bundled-consumer.mjs
 *
 * What it prints is chosen to be sensitive to module-level registration being
 * dropped, not to be a second copy of the test suite:
 *
 *   - The token type id table. `registerAllTokenTypes()` runs as a top-level
 *     statement when the lexer chunk is evaluated and mints an id for every
 *     name in `TokenTypes`. If that statement is shaken out, ids get minted
 *     lazily in first-use order instead, so both the individual ids and the
 *     `highestId === tableSize - 1` invariant below change.
 *   - One expression per built-in package. A package that failed to register
 *     its parselets or normalizer rules does not evaluate, it throws, and the
 *     thrown message is captured rather than escaping, so a regression shows
 *     up as a diff on one line instead of as a stack trace with no baseline.
 *   - `sharedParseletRegistry`, which is constructed at module scope.
 *
 * Everything here is deterministic: no clock, no network, no random. An
 * expression that could not be made deterministic does not belong in it.
 */

import { ExpressionEngine, ENGINE_VERSION } from "solve-engine";
import { sharedParseletRegistry } from "solve-engine/parser";
import { tokenTypeId, tokenTypeName, TokenTypes } from "solve-engine/lexer";
import { formatValue, DEFAULT_FORMATTING_SETTINGS } from "solve-engine/format";

const report = { engine: ENGINE_VERSION, ids: {}, tokenTable: {}, evals: {}, registry: {} };

// ── Token type ids ──────────────────────────────────────────────────────────

/**
 * A spread across the table rather than the first N entries, so a shift in any
 * region of it registers. The algebra verbs, the timezone phrases and the
 * finance keywords are here in particular because they are the token types
 * declared in `Token.ts` purely so `registerAllTokenTypes()` covers them.
 */
const PROBE_TOKEN_TYPES = [
	"NUMBER", "IDENT", "PLUS", "FUNC",
	"EXPAND_FN", "FACTOR_FN", "SOLVE_FN", "DER_FN", "INTEGRAL_FN",
	"IMAGINARY", "THEREFORE",
	"TIME_IN", "DATE_IN", "CITY_NAME",
	"MAP", "REDUCE", "SUM_FN", "PROD_FN",
	"VEC2", "VEC3", "VEC4", "COMMENT", "OVER",
];

for (const name of PROBE_TOKEN_TYPES) report.ids[name] = tokenTypeId(name);

// An id that exists but maps back to a different name is a worse failure than
// a missing one, and comparing ids alone would not catch it.
report.ids.__roundtrip = PROBE_TOKEN_TYPES.every(
	(name) => tokenTypeName(tokenTypeId(name)) === name,
);

// The invariant that survives a bundler reordering modules: when
// registerAllTokenTypes() has run before anything mints an id lazily, the
// declared token types occupy exactly ids 0..n-1 and nothing else is in the
// map. A dropped registration leaves the highest id far below the table size.
let highestId = -1;
for (const name of Object.values(TokenTypes)) {
	const id = tokenTypeId(name);
	if (id > highestId) highestId = id;
}
report.tokenTable.size = Object.keys(TokenTypes).length;
report.tokenTable.highestId = highestId;
report.tokenTable.contiguous = highestId === Object.keys(TokenTypes).length - 1;

// ── One expression per built-in package ─────────────────────────────────────

const EXPRESSIONS = [
	"1 + 2 * 3",                        // arithmetic
	"50% of 200 + 10% of 100",          // percentage
	"2 km + 300 m in m",                // uom
	"sqrt(144)",                        // function
	"sin(pi / 2)",                      // function, constants
	"min(3, 9) + max(1, 7)",            // function
	"2^10",                             // arithmetic, Tier 1 CARET path
	"0xFF + 0b1010",                    // bases
	"true and false",                   // conditionals
	"expand((x + 1)^2)",                // symbolic
	"factor(x^2 - 1)",                  // symbolic
	"der(x^3, x)",                      // symbolic
	"(3 + 2i) * (1 - 4i)",              // symbolic, complex
	"[1, 2; 3, 4] + [5, 2; 7, 4]",      // matrix
	"[1, 2, 3] * 10",                   // vector
	"reduce (acc + x, [1, 2, 3])",      // mapreduce
	"2024-01-15 + 5 days",              // datetime
	"90 days as week",                  // converters
];

const engine = new ExpressionEngine();

for (const source of EXPRESSIONS) {
	try {
		const values = engine.evaluateExpression(source);
		const list = Array.isArray(values) ? values : [values];
		report.evals[source] = list
			.map((value) => {
				let formatted;
				try {
					formatted = formatValue(value, DEFAULT_FORMATTING_SETTINGS);
				} catch {
					formatted = undefined;
				}
				// Fall back to the raw shape rather than "[object Object]", so a
				// Value the formatter cannot render still contributes something
				// that would differ if the value itself differed.
				return formatted ?? `${value?.constructor?.name}:${JSON.stringify(value?.value ?? value)}`;
			})
			.join(" | ");
	} catch (error) {
		report.evals[source] = `THREW: ${error?.constructor?.name}: ${error?.message}`;
	}
}

// ── sharedParseletRegistry ──────────────────────────────────────────────────
// Deprecated, but exported, so a consumer can still reach it. It is created by
// a top-level `new ParseletRegistry()`, which is the other shape of load-time
// work in the built output.

report.registry.type = sharedParseletRegistry?.constructor?.name ?? "MISSING";
report.registry.hasApi =
	typeof sharedParseletRegistry?.registerPrefix === "function" &&
	typeof sharedParseletRegistry?.hasPrefix === "function";
sharedParseletRegistry.registerPrefix("__PROBE__", { parse: () => null });
report.registry.roundTrip = sharedParseletRegistry.hasPrefix("__PROBE__");

console.log(JSON.stringify(report, null, 2));

// The engine can hold an open handle from a resolver that was never used, and
// this process has nothing left to do. Same reasoning as smoke-package.mjs.
process.exit(0);
