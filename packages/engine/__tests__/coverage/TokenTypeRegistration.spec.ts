/**
 * The token-type registry and the locale token lookup, both published through
 * the `solve-engine/lexer` subpath.
 *
 * `registerTokenType`, `registerAllTokenTypes` and `buildTokenLookup` had no
 * test that named them. They are what a package registering its own token
 * type through `IEnginePackage.lexerVocabulary` sits on top of, and the
 * property that matters is not that they run but that a custom type gets an
 * id of its own and never collides with, or inherits behaviour from, a
 * built-in one.
 *
 * The collision case is worth guarding specifically. Token type ids index a
 * `Uint8Array` of binding powers and are compared as integers in the parser's
 * hot switch, so two names sharing an id would not fail loudly: the parser
 * would simply treat one operator as the other.
 */

import { describe, expect, test } from "@jest/globals";
import {
	TokenTypes,
	registerAllTokenTypes,
	registerTokenType,
	tokenTypeId,
	tokenTypeName,
} from "@solve-js/lexer/Token";
import { buildTokenLookup } from "@solve-js/lexer/tokenRegistration";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { newTrackedEngine } from "@tools/trackedEngine";

describe("registerTokenType", () => {
	test("is idempotent, so asking twice is asking once", () => {
		/*
		 * `tokenTypeId()` is literally a call to this, and it runs on every
		 * token the parser dispatches. If registering twice allocated twice,
		 * the same name would answer to two ids and every comparison between
		 * them would be false.
		 */
		const first = registerTokenType("COVERAGE_TEST_ALPHA");
		const second = registerTokenType("COVERAGE_TEST_ALPHA");
		const viaLookup = tokenTypeId("COVERAGE_TEST_ALPHA");

		expect(second).toBe(first);
		expect(viaLookup).toBe(first);
	});

	test("distinct names get distinct ids", () => {
		// The property the parser's integer switch rests on.
		const ids = new Set<number>();
		for (const name of ["COVERAGE_TEST_B1", "COVERAGE_TEST_B2", "COVERAGE_TEST_B3"]) {
			ids.add(registerTokenType(name));
		}
		expect(ids.size).toBe(3);
	});

	test("a custom name never collides with a built-in one", () => {
		/*
		 * A package picks its own token-type strings, and nothing stops it
		 * choosing something close to a built-in. The ids must stay apart
		 * even so, or a package's token would be dispatched as arithmetic.
		 */
		const builtinIds = new Set(Object.values(TokenTypes).map((name) => tokenTypeId(name)));
		const custom = registerTokenType("COVERAGE_TEST_PLUS_LOOKALIKE");
		expect(builtinIds.has(custom)).toBe(false);
	});

	test("ids and names round-trip", () => {
		const id = registerTokenType("COVERAGE_TEST_ROUNDTRIP");
		expect(tokenTypeName(id)).toBe("COVERAGE_TEST_ROUNDTRIP");
		expect(tokenTypeId(tokenTypeName(id))).toBe(id);
	});

	test("an unregistered id is named rather than left undefined", () => {
		/*
		 * `tokenTypeName` feeds error messages. Returning undefined would put
		 * the word "undefined" in a parse error where the token type belongs,
		 * which tells a package author nothing at all.
		 */
		expect(tokenTypeName(9_999_999)).toBe("UNKNOWN_9999999");
	});
});

describe("registerAllTokenTypes", () => {
	test("every built-in name has an id", () => {
		// The bootstrap runs at module load; this is the assertion that it
		// covered the whole table rather than part of it.
		for (const name of Object.values(TokenTypes)) {
			expect(typeof tokenTypeId(name)).toBe("number");
		}
	});

	test("running it again changes nothing", () => {
		/*
		 * It is called at module load and the module can be loaded more than
		 * once in a process with several realms. A second run that
		 * reallocated ids would renumber tokens out from under an engine that
		 * had already compiled bytecode against the old numbering.
		 */
		const before = Object.values(TokenTypes).map((name) => tokenTypeId(name));
		registerAllTokenTypes();
		const after = Object.values(TokenTypes).map((name) => tokenTypeId(name));

		expect(after).toEqual(before);
	});
});

describe("the binding-power fast path and custom token types", () => {
	test("a custom token type carries no built-in binding power", () => {
		/*
		 * `PrecedenceParser.BP_TABLE` is indexed by token type id, and a
		 * non-zero entry means "handle this inline as a built-in infix
		 * operator at this precedence". A custom type must read zero so it
		 * falls through to the parselet registry, which is where a package's
		 * own parselet lives. Reading anything else would silently run a
		 * package's operator as arithmetic.
		 *
		 * Ids past the end of the table are the ordinary case for a package
		 * registering late, and an out-of-range typed-array read is
		 * undefined, which the parser coalesces to zero. Both branches are
		 * covered by asking for a type registered after the table was built.
		 */
		const custom = registerTokenType("COVERAGE_TEST_CUSTOM_OP");
		expect(PrecedenceParser.BP_TABLE[custom] ?? 0).toBe(0);
	});

	test("the built-in operators do carry one, so the check above is not vacuous", () => {
		// If every entry were zero the previous test would pass for the wrong
		// reason. These four are the fast path's whole purpose.
		expect(PrecedenceParser.BP_TABLE[tokenTypeId(TokenTypes.PLUS)]).toBeGreaterThan(0);
		expect(PrecedenceParser.BP_TABLE[tokenTypeId(TokenTypes.STAR)]).toBeGreaterThan(0);
		expect(PrecedenceParser.BP_TABLE[tokenTypeId(TokenTypes.CARET)]).toBeGreaterThan(0);
		expect(PrecedenceParser.BP_TABLE[tokenTypeId(TokenTypes.PERCENT)]).toBeGreaterThan(0);
	});

	test("multiplication binds tighter than addition, which is what the table encodes", () => {
		// The table is only meaningful through the answers it produces.
		// 2 + 3 * 4 is 14, not 20.
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("2 + 3 * 4")[0].toNumber()).toBe(14);
		// And exponentiation binds tighter still, right-associatively:
		// 2 ^ 3 ^ 2 is 2 ^ 9, which is 512, not 64.
		expect(engine.evaluateExpression("2 ^ 3 ^ 2")[0].toNumber()).toBe(512);
	});
});

describe("buildTokenLookup", () => {
	test("maps a locale's own keywords to token types, lowercased", () => {
		/*
		 * The lexer lowercases before looking up, so a keyword table that
		 * kept its original case would never match. "sqrt" is a function
		 * keyword in every locale this ships.
		 */
		const lookup = buildTokenLookup("en");
		expect(lookup.keywordToType.get("sqrt")).toBeDefined();
		for (const key of lookup.keywordToType.keys()) {
			expect(key).toBe(key.toLowerCase());
		}
	});

	test("a different locale gets that locale's words", () => {
		/*
		 * German writes "plus" and "mal"; the point of the parameter is that
		 * asking for "de" produces a different vocabulary, not the same one
		 * under a different name.
		 */
		const english = buildTokenLookup("en");
		const german = buildTokenLookup("de");

		expect(german.keywordToType.get("mal")).toBeDefined();
		expect(english.keywordToType.get("mal")).toBeUndefined();
	});

	test("an unknown locale code falls back rather than producing an empty vocabulary", () => {
		/*
		 * A lookup with no keywords is an engine that cannot read a single
		 * word, which is a much worse failure than answering in English. The
		 * locale layer already falls back; this checks the fallback survives
		 * the trip through the registry.
		 */
		const fallback = buildTokenLookup("zz-not-a-locale");
		const english = buildTokenLookup("en");

		expect(fallback.keywordToType.size).toBe(english.keywordToType.size);
		expect(fallback.keywordToType.get("sqrt")).toBe(english.keywordToType.get("sqrt"));
	});

	test("units are kept apart from keywords, since they are checked after them", () => {
		/*
		 * The two layers are deliberately separate: a unit name that is also
		 * a keyword must resolve as the keyword. Holding units in the keyword
		 * map would make that ordering impossible to express.
		 */
		const lookup = buildTokenLookup("en");
		expect(lookup.unitNames.size).toBeGreaterThan(0);
		expect(lookup.unitNames.has("km")).toBe(true);
		expect(lookup.keywordToType.has("km")).toBe(false);
	});

	test("phrase-start words are recorded so the lexer can defer to the phrase matcher", () => {
		/*
		 * "to the power of" is a phrase, so "to" has to reach the normalizer
		 * as an IDENT rather than being claimed by a keyword rule first.
		 * That deferral is exactly what this set drives.
		 */
		const lookup = buildTokenLookup("en");
		expect(lookup.phraseStartWords.has("to")).toBe(true);
		expect(lookup.phraseTrie).not.toBeNull();
	});

	test("each call builds a fresh lookup", () => {
		// Two engines with different locales must not share one map, or the
		// second would overwrite the first's vocabulary.
		const first = buildTokenLookup("en");
		const second = buildTokenLookup("en");
		expect(first.keywordToType).not.toBe(second.keywordToType);
	});
});
