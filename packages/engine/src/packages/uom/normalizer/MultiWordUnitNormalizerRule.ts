import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

/**
 * The unit table's spellings of more than one word, keyed by their first word:
 * `nautical mile`, `square feet`, `light-years`, `US fluid ounces`. Each is kept
 * as its words and the separator after each word, a space or a hyphen, so a
 * match can be checked against the source exactly. Built once, on first use.
 */
let multiWordSpellings: Map<string, Array<{ spelling: string; words: string[]; separators: string[] }>> | null = null;

function spellingsByFirstWord(): Map<string, Array<{ spelling: string; words: string[]; separators: string[] }>> {
	if (multiWordSpellings !== null) return multiWordSpellings;
	multiWordSpellings = new Map();
	const add = (spelling: string, words: string[], separators: string[]): void => {
		const list = multiWordSpellings!.get(words[0]) ?? [];
		list.push({ spelling, words, separators });
		multiWordSpellings!.set(words[0], list);
	};
	for (const spelling of Object.keys(UNIT_TABLE)) {
		if (!/^[A-Za-z][A-Za-z.]*([ -][A-Za-z.]+)+$/.test(spelling)) continue;
		const words = spelling.split(/[ -]/);
		const separators = [...spelling.matchAll(/[ -]/g)].map((m) => m[0]);
		add(spelling, words, separators);
		// The table mirrors its upstream verbatim, and a few spellings there
		// have no plural beside them: `troy ounce`, `watt-hour`, `foot-candle`.
		// The plural a reader writes reads as the singular the table carries,
		// rather than leaving `2 troy ounces` an undefined variable. Only a
		// spelled-out word takes a plural: `kW h` is a symbol, and `kW hs` is
		// not a spelling of anything.
		const last = words[words.length - 1];
		const plural = spelling + "s";
		if (/^[a-z]{3,}$/.test(last) && !last.endsWith("s") && UNIT_TABLE[plural] === undefined) {
			add(spelling, [...words.slice(0, -1), last + "s"], separators);
		}
	}
	// Longest first, so `US fluid ounce` wins over a shorter spelling that is
	// its prefix.
	for (const list of multiWordSpellings.values()) list.sort((a, b) => b.words.length - a.words.length);
	return multiWordSpellings;
}

/** The text a token was written as. */
function textOf(token: Token): string {
	return token.text ?? token.value ?? "";
}

/**
 * How many tokens from `start` spell `words` with exactly `separators` between
 * them in the source, or 0 when they do not. A hyphen arrives as its own token,
 * so a hyphenated spelling takes one token more per hyphen.
 */
function spells(tokens: readonly Token[], start: number, words: readonly string[], separators: readonly string[]): number {
	let i = start;
	for (let w = 0; w < words.length; w++) {
		const token = tokens[i];
		if (token === undefined || textOf(token) !== words[w]) return 0;
		if (w === words.length - 1) return i - start + 1;
		const next = tokens[i + 1];
		if (next === undefined) return 0;
		if (separators[w] === " ") {
			if (token.offset + textOf(token).length + 1 !== next.offset) return 0;
			i += 1;
		} else {
			if (next.type !== "MINUS" || token.offset + textOf(token).length !== next.offset) return 0;
			const after = tokens[i + 2];
			if (after === undefined || next.offset + 1 !== after.offset) return 0;
			i += 2;
		}
	}
	return 0;
}

/** The tokens after which a unit is expected: a value, or a conversion keyword. */
const UNIT_FOLLOWS = new Set(["NUMBER", "RPAREN", "IN", "TO"]);

/**
 * Fuses a unit written in more than one word into the single unit the table
 * carries: `fl oz`, `W h`, `nautical miles`, `square feet`, `light-years`.
 *
 * The lexer reads a unit as one run of word characters, so a spelling with a
 * space in it arrives as two tokens and the first one wins on its own. That is
 * not merely a missing feature, it produced a wrong answer with no error: `fl`
 * is a lexable spelling of the FEMTOLITRE, so `1 fl oz` was one femtolitre
 * relabelled `oz` and `1 cup in fl oz` reported 236,588,236,500,000. And where
 * the first word is not a unit at all, the spelling simply failed: `5 nautical
 * miles`, `5 square feet`, `5 cubic metres` and `5 imperial gallons` were
 * undefined variables, and `5 km in nautical miles` said the two did not measure
 * the same thing (issue #548).
 *
 * Two ways in, both keeping the vocabulary where it is defined, so nothing is
 * invented and the rule cannot drift from the table:
 *
 * - Two adjacent UNIT tokens that the table spells as a pair (`fl oz`, `kW h`).
 * - After a value or a conversion keyword (`5 nautical miles`, `in square
 *   feet`), any words the table spells as one unit, matched at the value's
 *   position so they are fused before implicit multiplication could read
 *   `5 nautical` as five times a variable. The value stays where it was.
 *
 * The words must be separated exactly as the table spells them, one space or a
 * hyphen, and the lookup is case-sensitive like every other read of UNIT_TABLE:
 * `W h` is the watt-hour and `w h` is not a spelling of anything.
 */
export function multiWordUnitNormalizerRule(priority = 78): NormalizerRule {
	return {
		name: "uom:multi-word-unit",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["UNIT", "NUMBER", "RPAREN", "IN", "TO"] }],
		match(tokens, pos): NormalizerMatch | null {
			const first = tokens[pos];
			if (first === undefined) return null;

			// A value or a conversion keyword followed by a multi-word spelling.
			if (UNIT_FOLLOWS.has(first.type) && tokens[pos + 1] !== undefined) {
				const candidates = spellingsByFirstWord().get(textOf(tokens[pos + 1]));
				if (candidates !== undefined) {
					for (const candidate of candidates) {
						const length = spells(tokens, pos + 1, candidate.words, candidate.separators);
						if (length > 0) {
							return {
								consumed: 1 + length,
								replacement: [first, createFusedToken("UNIT", candidate.spelling, tokens.slice(pos + 1, pos + 1 + length))],
								ruleName: "uom:multi-word-unit",
							};
						}
					}
				}
			}

			// Two unit tokens the table spells as a pair.
			const second = tokens[pos + 1];
			if (first.type !== "UNIT" || second?.type !== "UNIT") return null;
			// Exactly one space between them, measured from the source offsets
			// rather than assumed from token order.
			if (first.offset + first.text.length + 1 !== second.offset) return null;
			const spelling = `${first.value} ${second.value}`;
			if (UNIT_TABLE[spelling] === undefined) return null;
			return {
				consumed: 2,
				replacement: [createFusedToken("UNIT", spelling, tokens.slice(pos, pos + 2))],
				ruleName: "uom:multi-word-unit",
			};
		},
	};
}
