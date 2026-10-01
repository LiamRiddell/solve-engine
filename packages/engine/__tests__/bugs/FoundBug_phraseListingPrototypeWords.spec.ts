import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { PhraseTrie } from "@solve-js/normalizer/PhraseTrie";

/**
 * Found bug: `PhraseTrie.getAllPhrases` built its listing in a plain object
 * literal, so a phrase spelled exactly `__proto__` went through the prototype
 * setter and was silently missing from the listing, and a lookup of
 * `constructor` or `toString` in it found the inherited function rather than
 * nothing. The listing now has no prototype and holds only its own entries;
 * everything else about it (keys, values, order) is unchanged.
 */

/** The key a phrase is listed under: the trie stores its words lower-cased. */
const keyOf = (phrase: string): string => phrase.toLowerCase();

describe("getAllPhrases", () => {
	test("ordinary phrases are listed with their token types, single and several words", () => {
		const trie = new PhraseTrie();
		trie.addPhrase("total of", "TOTAL_OF");
		trie.addPhrase("total", "TOTAL");
		trie.addPhrase("present value of", "PV");
		expect(trie.getAllPhrases()).toEqual({ "total of": "TOTAL_OF", total: "TOTAL", "present value of": "PV" });
	});

	test("an empty trie lists nothing, and nothing is inherited", () => {
		const listing = new PhraseTrie().getAllPhrases();
		expect(Object.keys(listing)).toEqual([]);
		expect(Object.getPrototypeOf(listing)).toBeNull();
		expect("toString" in listing).toBe(false);
		expect(listing["constructor"]).toBeUndefined();
	});

	test("every prototype word as a phrase is listed as its own entry, and the prototype is untouched", () => {
		expectPrototypeUntouched(() => {
			const trie = new PhraseTrie();
			PROTOTYPE_WORDS.forEach((word, i) => trie.addPhrase(word, `TYPE_${i}`));
			PROTOTYPE_WORDS.forEach((word, i) => trie.addPhrase(`${word} of`, `OF_${i}`));
			const listing = trie.getAllPhrases();
			expect(Object.keys(listing)).toHaveLength(PROTOTYPE_WORDS.length * 2);
			PROTOTYPE_WORDS.forEach((word, i) => {
				expect(Object.prototype.hasOwnProperty.call(listing, keyOf(word))).toBe(true);
				expect(listing[keyOf(word)]).toBe(`TYPE_${i}`);
				expect(listing[`${keyOf(word)} of`]).toBe(`OF_${i}`);
			});
			expect(Object.entries(listing)).toContainEqual(["__proto__", "TYPE_1"]);
		});
	});

	test("a hostile token type is held as text, and a phrase cannot reach the prototype through the listing", () => {
		expectPrototypeUntouched(() => {
			const trie = new PhraseTrie();
			trie.addPhrase("__proto__", "polluted");
			trie.addPhrase("prototype", "__proto__");
			const listing = trie.getAllPhrases();
			expect(listing["__proto__"]).toBe("polluted");
			expect(listing["prototype"]).toBe("__proto__");
			expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
		});
	});

	test("the listing survives a JSON round trip, as the diagnostics view sends it", () => {
		const trie = new PhraseTrie();
		trie.addPhrase("__proto__", "A");
		trie.addPhrase("rent", "B");
		const listing = trie.getAllPhrases();
		expect(Object.keys(listing)).toEqual(["__proto__", "rent"]);
		expect(JSON.stringify(listing)).toBe('{"__proto__":"A","rent":"B"}');
	});

	test("the engine's own listing is unchanged in content: every built-in phrase is there", () => {
		const phrases = newTrackedEngine().getNormalizer().getPhrases();
		expect(Object.getPrototypeOf(phrases)).toBeNull();
		expect(Object.keys(phrases).length).toBeGreaterThan(100);
		expect(Object.keys(phrases)).toEqual(expect.arrayContaining(["total of", "average of"]));
		for (const [phrase, type] of Object.entries(phrases)) {
			expect(typeof phrase).toBe("string");
			expect(typeof type).toBe("string");
		}
	});
});
