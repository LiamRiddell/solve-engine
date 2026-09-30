import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { osrsLexerVocabulary } from "@solve-js-examples/osrs/OsrsLexerVocabulary";
import { OSRS_PACKAGE } from "@solve-js-examples/osrs/OsrsPackage";
import { expectPackage } from "@solve-js/testing";

/**
 * Found bug: under the playground's package set, the OSRS example package
 * claimed the word `price` as a keyword, so `price * qty` failed with an OSRS
 * item error when `price` was the reader's own variable.
 *
 * Two fixes were possible: let a reader's variable win over a package word, or
 * stop the package claiming a common word. The second is the right one. A
 * keyword is decided when a line is lexed, before any line has run, so the
 * lexer cannot know which words the document will define; letting a variable
 * win would mean re-lexing a line whenever a name above it changes, for every
 * package word. And `price` is the word the package kit's own prose check
 * (`notToShadow`) exists to catch: it had already flagged this package.
 * `price` still reads as a filler word after `osrs`, where it cannot be the
 * reader's variable.
 */

function engine() {
	// The playground's set is the built-ins, this package, stocks and knowledge; the
	// last two claim no common word, so this is the pair that collided.
	return newTrackedEngine({ packages: [...BUILTIN_PACKAGES, OSRS_PACKAGE] });
}

function lines(text: string): { batch: string[]; incremental: string[] } {
	const show = (l: { result?: { toString(): string } | null; error?: unknown }) =>
		(l.error ? `ERROR ${String(l.error)}` : l.result ? formatValue(l.result as never) : "");
	return {
		batch: engine().parseDocument(text).lines.map(show),
		incremental: evaluateDocument(engine(), text).lines.map(show),
	};
}

describe("the line that exposed it", () => {
	test("price is the reader's variable under the playground's packages, through both passes", () => {
		const { batch, incremental } = lines("price = 5\nqty = 3\nprice * qty");
		expect(batch[2]).toBe("= 15");
		expect(incremental).toEqual(batch);
	});

	test("an undefined price says so, not an OSRS item error", () => {
		expect(() => engine().evaluateExpression("price * qty")).toThrow("Undefined variable: price");
	});

	test("the package's own forms still read", () => {
		for (const line of ["osrs price of Iron Axe", 'osrs.price("Iron Axe")', 'ge("Iron Axe")']) {
			const value = engine().evaluateExpression(line);
			expect({ line, osrs: !value.isError() || String(value.errorCode).startsWith("OSRS") }).toEqual({ line, osrs: true });
		}
	});
});

describe("the parts", () => {
	test("the vocabulary claims only the package's own words", () => {
		expect(Object.keys(osrsLexerVocabulary.keywords ?? {}).sort()).toEqual(["ge", "osrs"]);
	});

	test("the kit's prose check passes on the package", () => {
		expect(() => expectPackage(OSRS_PACKAGE).notToShadow()).not.toThrow();
	});
});

describe("adversarial", () => {
	test("security: prototype words as variables beside the package's words", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch, incremental } = lines(`${word} = 5\nprice = 2\n${word} * price`);
				expect(incremental).toEqual(batch);
				expectHonestLine(`osrs price of ${word}`, { engine: engine() });
			}
		});
	});

	test("security: look-alike and markup-shaped text after price", () => {
		for (const line of fill("price X", TEXT_EDGES)) expectHonestLine(line, { engine: engine() });
	});

	test("realistic: the everyday price lines a reader writes", () => {
		const { batch } = lines("price = $4.50\nprice * 3\nprice + 20%\nprice in EUR\nsplit price between 3");
		expect(batch[1]).toBe("= $13.50");
		expect(batch[2]).toBe("= $5.40");
		expect(batch[4]).toBe("= $1.50 each");
	});

	test("edge: price as a label and in a sentence", () => {
		const { batch, incremental } = lines("price: 5\nThe price went up.\nprice * 2");
		expect(incremental.length).toBe(batch.length);
	});
});
