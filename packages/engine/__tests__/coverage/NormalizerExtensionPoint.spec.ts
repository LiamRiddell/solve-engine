/**
 * The normalizer as a third party reaches it.
 *
 * `IEnginePackage.normalizerRules` is one of the SDK's six extension points,
 * and before this file the only test of it registered a rule whose `match()`
 * always returned `null` and asserted that registering it did not throw. That
 * proves the field is accepted; it proves nothing about whether a rule that
 * DOES match is ever consulted, whether its replacement tokens reach the
 * parser, or whether the answer changes. All three are what an integrator is
 * actually buying.
 *
 * `createBuiltinNormalizerRules()` and `createFusedToken()` are both published
 * through the `solve-engine/normalizer` subpath and neither was referenced by
 * any test.
 */

import { describe, expect, test } from "@jest/globals";
import {
	BUILTIN_PHRASES,
	createBuiltinNormalizerRules,
	implicitMultiplyRule,
} from "@solve-js/normalizer/BuiltinNormalizerRules";
import { createFusedToken, TokenNormalizer } from "@solve-js/normalizer/TokenNormalizer";
import type { NormalizerMatch, NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Tokens for a source string, minus the whitespace the parser never sees. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter(
		(t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"),
	);
}

/**
 * A rule of the shape the SDK documentation describes: match a NUMBER followed
 * by a domain word, and replace the pair with a single NUMBER.
 *
 * "sixpack" is a made-up word on purpose. A real unit or keyword would be
 * recognised by the lexer and the test would then be measuring the lexer.
 */
function sixpackRule(priority = 100): NormalizerRule {
	return {
		name: "test:sixpack",
		priority,
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const count = tokens[pos];
			const word = tokens[pos + 1];
			if (!count || !word) return null;
			if (count.type !== "NUMBER") return null;
			if (word.value.toLowerCase() !== "sixpack") return null;

			const total = String(Number(count.value) * 6);
			return {
				consumed: 2,
				replacement: [createFusedToken("NUMBER", total, [count, word])],
			};
		},
	};
}

describe("createBuiltinNormalizerRules", () => {
	test("hands back the implicit-multiply rule at the documented priority", () => {
		/*
		 * 50 is the level `NormalizerRule`'s doc comment reserves for
		 * implicit operator insertion, below the 80 and 100 reserved for
		 * phrase fusion. The ordering is the whole reason "2 power of 3" is
		 * 8 rather than 2 times whatever "power" resolves to, so the number
		 * is a contract and not an implementation detail.
		 */
		const rules = createBuiltinNormalizerRules();
		expect(rules.map((r) => r.name)).toEqual(["implicit:multiply"]);
		expect(rules[0].priority).toBe(50);
	});

	test("hands back a fresh array each call", () => {
		/*
		 * Two engines in one process each build their own normalizer from
		 * this factory. A shared array would let one engine's
		 * `register()`/`unregister()` bookkeeping reach into the other's.
		 */
		const first = createBuiltinNormalizerRules();
		const second = createBuiltinNormalizerRules();
		expect(first).not.toBe(second);
		expect(first[0]).not.toBe(second[0]);
	});

	test("every built-in phrase names a token type, never an empty string", () => {
		// A phrase mapped to "" would fuse into a token no parselet can
		// dispatch, which surfaces as NO_PREFIX_PARSELET on ordinary English.
		for (const [phrase, tokenType] of Object.entries(BUILTIN_PHRASES)) {
			expect(phrase.trim()).toBe(phrase);
			expect(tokenType.length).toBeGreaterThan(0);
		}
	});
});

describe("createFusedToken", () => {
	test("takes its position from the first token it replaced", () => {
		/*
		 * A fused token is what the editor highlights and what an error span
		 * points at. If it carried the position of the LAST source token, an
		 * error on a four-word phrase would underline the final word.
		 */
		const tokens = lex("1 + sixpack");
		const word = tokens[2];
		const fused = createFusedToken("NUMBER", "6", [word]);

		expect(fused.offset).toBe(word.offset);
		expect(fused.line).toBe(word.line);
		expect(fused.col).toBe(word.col);
	});

	test("its source span ends where the last token it replaced ended", () => {
		/*
		 * The span is what tells the host how much text one token stands for.
		 * Fusing "2 sixpack" and recording only the "2" would leave seven
		 * characters unaccounted for, and a highlight that stops mid-word.
		 */
		const tokens = lex("2 sixpack");
		const fused = createFusedToken("NUMBER", "12", [tokens[0], tokens[1]]);

		expect(fused.offset).toBe(0);
		// "2 sixpack" is nine characters, so the span ends at index 9.
		expect(fused.sourceEnd).toBe(9);
	});

	test("carries the type it was asked for, and the text as its value", () => {
		const tokens = lex("2 sixpack");
		const fused = createFusedToken("NUMBER", "12", tokens);
		expect(fused.type).toBe("NUMBER");
		expect(fused.value).toBe("12");
		expect(fused.text).toBe("12");
	});
});

describe("TokenNormalizer rule management", () => {
	test("a higher-priority rule is tried first at the same position", () => {
		/*
		 * Priority is the only tool a package author has for saying "my
		 * domain rule beats the generic one here". If registration order won
		 * instead, a package would have to know when every other package
		 * registered.
		 */
		const fired: string[] = [];
		const record = (name: string, priority: number): NormalizerRule => ({
			name,
			priority,
			match(tokens, pos) {
				if (tokens[pos].type !== "NUMBER") return null;
				fired.push(name);
				return null;
			},
		});

		const normalizer = new TokenNormalizer();
		normalizer.register(record("low", 10));
		normalizer.register(record("high", 90));
		normalizer.normalize(lex("1"));

		expect(fired).toEqual(["high", "low"]);
	});

	test("unregister removes a rule by name and normalization reverts", () => {
		const normalizer = new TokenNormalizer();
		normalizer.register(sixpackRule());

		const fused = normalizer.normalize(lex("2 sixpack"));
		expect(fused).toHaveLength(1);
		expect(fused[0].value).toBe("12");

		normalizer.unregister("test:sixpack");

		const untouched = normalizer.normalize(lex("2 sixpack"));
		expect(untouched).toHaveLength(2);
		expect(untouched[1].value).toBe("sixpack");
	});

	test("the fusion callback names the rule and both halves of what it ate", () => {
		/*
		 * This record is what the playground's normalizer view renders, and
		 * it is the only place a package author can see WHY their tokens
		 * changed shape. Reporting the wrong source tokens makes that view
		 * actively misleading.
		 */
		const fusions: Array<{ rule: string; sources: string[]; fused: string }> = [];
		const normalizer = new TokenNormalizer();
		normalizer.register(sixpackRule());

		normalizer.normalize(lex("3 sixpack"), (fusion) => {
			fusions.push({
				rule: fusion.rule,
				sources: fusion.sourceTokens.map((t) => t.value),
				fused: fusion.fusedToken.value,
			});
		});

		expect(fusions).toEqual([
			{ rule: "test:sixpack", sources: ["3", "sixpack"], fused: "18" },
		]);
	});

	test("implicitMultiplyRule can be given a phrase guard by its caller", () => {
		/*
		 * The two-argument form is what the module doc tells a package author
		 * to use so that a phrase their package registered is not split by an
		 * inserted `*` before the phrase rule ever sees it. Nothing tested
		 * that the guard is consulted, only the zero-argument form.
		 */
		const asked: string[] = [];
		const guarded = implicitMultiplyRule(50, (word) => {
			asked.push(word);
			return word === "sixpack";
		});

		const normalizer = new TokenNormalizer();
		normalizer.register(guarded);

		// "2 sixpack": the guard claims "sixpack" starts a phrase, so no `*`
		// may be inserted, and the stream is left at two tokens.
		expect(normalizer.normalize(lex("2 sixpack"))).toHaveLength(2);
		expect(asked).toContain("sixpack");

		// "2 widget": the guard says no, so the implicit `*` goes in and the
		// stream grows to three.
		expect(normalizer.normalize(lex("2 widget"))).toHaveLength(3);
	});
});

describe("a package's normalizerRules, end to end through an engine", () => {
	const sixpackPackage: IEnginePackage = {
		name: "sixpack-test-package",
		normalizerRules: [sixpackRule()],
	};

	test("a registered rule changes the answer, not just the token count", () => {
		/*
		 * The claim under test is the one an integrator relies on: a rule
		 * handed to `registerPackage()` reaches the normalizer the engine
		 * actually parses with. Two sixpacks is twelve, so "2 sixpack + 1"
		 * is thirteen.
		 */
		const engine = newTrackedEngine("en");
		engine.registerPackage(sixpackPackage);

		expect(engine.evaluateExpression("2 sixpack")[0].toNumber()).toBe(12);
		expect(engine.evaluateExpression("2 sixpack + 1")[0].toNumber()).toBe(13);
		expect(engine.evaluateExpression("2 sixpack * 3")[0].toNumber()).toBe(36);
	});

	test("an engine without the package is unaffected", () => {
		/*
		 * Rules must land on the engine they were registered with, not on a
		 * process-wide normalizer. Two engines with different packages is the
		 * ordinary case for a host with two documents open, and a rule
		 * leaking between them would change answers in a document nobody
		 * configured.
		 */
		const withPackage = newTrackedEngine("en");
		withPackage.registerPackage(sixpackPackage);
		const without = newTrackedEngine("en");

		expect(withPackage.evaluateExpression("2 sixpack")[0].toNumber()).toBe(12);

		// Without the rule, "sixpack" is an undefined identifier rather than
		// a quantity, so the line has no value at all.
		expect(() => without.evaluateExpression("2 sixpack")).toThrow(/Undefined variable/);
	});

	/*
	 * `unregisterPackage()` reverses plugin functions, variable sources,
	 * async resolvers, token categories, lexer vocabulary, `as` converters
	 * and completion items. Its doc comment then names the two things it
	 * deliberately does NOT reverse, parselets and phrases, on the grounds
	 * that both live in registries discarded with the engine.
	 *
	 * Normalizer rules used to be neither reversed nor named. They are
	 * registered on a per-engine `TokenNormalizer` at `ExpressionEngine.ts`'s
	 * `this.normalizer.register(rule)`, and `TokenNormalizer.unregister(name)`
	 * exists for exactly this, so leaving them was very unlikely to be the
	 * same deliberate choice the doc comment records for the other two. They
	 * are now reversed, and the doc comment says so.
	 *
	 * It is also not equivalent to the phrase case. A phrase goes into a trie
	 * keyed by its own text, so registering it twice is idempotent; a rule
	 * goes into an array, so registering it twice left two of it. That is
	 * what the second test below measures.
	 */
	test("unregistering the package takes the rule back out", () => {
		const engine = newTrackedEngine("en");
		engine.registerPackage(sixpackPackage);
		expect(engine.evaluateExpression("2 sixpack")[0].toNumber()).toBe(12);

		engine.unregisterPackage("sixpack-test-package");

		// "sixpack" should be an undefined identifier again, exactly as it is
		// on an engine that never saw the package.
		expect(() => engine.evaluateExpression("2 sixpack")).toThrow(/Undefined variable/);
	});

	test("re-registering the same package does not stack another copy of its rules", () => {
		/*
		 * Because unregistration leaves the rule behind and registration
		 * appends, a host that re-registers a package (on a settings change,
		 * on a reload, on the duplicate-name path `registerPackage()` itself
		 * takes) accumulates one more copy of every rule each time. The
		 * normalizer tries every rule at every token position, so the cost of
		 * lexing a document grows with the number of registrations, and it is
		 * never reclaimed short of dropping the engine.
		 *
		 * Counting match() calls is how that is visible from outside: one
		 * registration should mean one attempt per position, no matter how
		 * many times the package has been registered and unregistered.
		 */
		let attempts = 0;
		const countingRule: NormalizerRule = {
			name: "test:counting",
			priority: 100,
			match(_tokens, _pos) {
				attempts++;
				return null;
			},
		};
		const countingPackage: IEnginePackage = {
			name: "counting-test-package",
			normalizerRules: [countingRule],
		};

		const engine = newTrackedEngine("en");
		engine.registerPackage(countingPackage);
		engine.evaluateExpression("1 + 1");
		const afterFirst = attempts;
		expect(afterFirst).toBeGreaterThan(0);

		engine.unregisterPackage("counting-test-package");
		engine.registerPackage(countingPackage);

		attempts = 0;
		engine.evaluateExpression("2 + 2");
		expect(attempts).toBe(afterFirst);
	});
});
