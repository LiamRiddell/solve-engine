/**
 * Names of several words: `hourly rate = $50`, then `hourly rate * 8` (#743).
 *
 * A name is one word to the parser, and people name a value the way they say
 * it. So a run of plain words is fused into one name, but only where a line
 * defines it: the words at the start of a line, directly before its `=`. That
 * line registers the name with the engine's document-scoped table, and from
 * then on the same run of words on any line reads as that name, longest
 * registered name first. Fusing only where a name is defined is what keeps an
 * ordinary sentence from turning into one: `the hourly rate went up` stays
 * prose until a line says `hourly rate = ...`, and even then it is prose with a
 * name in it, which still does not parse.
 *
 * The words are plain words, every one an identifier. A word the engine
 * already reads (a unit, a keyword, an operator spelled as a word, a fused
 * phrase such as `tax on`) is never part of a name, so a name cannot shadow
 * anything the engine understands. Where a would-be name holds such a word the
 * line is refused by name ({@link multiWordNameRefusal}) rather than read some
 * other way: `take home = 5` used to be stored as the equation `-home = 5`,
 * since `take` is a spelling of minus, and that quiet reading is exactly what a
 * reader who meant a name would never guess.
 *
 * The table is scoped the way user-defined units are (see UserUnitTable.ts):
 * it lives on the engine, a batch pass starts it empty and fills it top to
 * bottom, a definition belongs to the line that made it (by persistent line
 * id), and a change to it invalidates every compiled program, since a program
 * compiled before a name existed read its words apart.
 */

import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { ErrorFactory, type EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import { VariablesErrorCodes } from "./VariablesErrorCodes";

/**
 * The most words a name may have. Enough for `take home pay after tax`, and
 * few enough that a sentence with an `=` in it (`I think the answer = 5`) is
 * not taken whole: a longer run is left as the error it was.
 */
export const MAX_NAME_WORDS = 4;

/** The spelling of arithmetic each operator word stands for, for the refusal. */
const OPERATOR_WORD_MEANING: Readonly<Record<string, string>> = {
	PLUS: "plus",
	AND_CONJ: "plus",
	MINUS: "minus",
	STAR: "times",
	SLASH: "divided by",
	MOD: "modulo",
};

/** The symbol for each operator word, for the equation the refusal shows. */
const OPERATOR_SYMBOL: Readonly<Record<string, string>> = {
	PLUS: "+",
	AND_CONJ: "+",
	MINUS: "-",
	STAR: "*",
	SLASH: "/",
	MOD: "mod ",
};

/** A single word: letters, with an apostrophe or hyphen inside. */
const WORD = /^\p{L}[\p{L}\p{M}'’-]*$/u;

/** Words separated by single spaces, the text of a fused phrase. */
const PHRASE = /^\p{L}[\p{L}\p{M}'’-]*(?: \p{L}[\p{L}\p{M}'’-]*)+$/u;

/**
 * Whether a token is a plain word a name can be made of: an identifier whose
 * text is one word. A digit, an underscore or any other symbol leaves it out;
 * `hourly_rate` is already a name of one word and needs nothing from here.
 *
 * @param token - A token from the line.
 * @returns `true` for a plain word.
 */
export function isNameWord(token: Token | undefined): boolean {
	return token !== undefined && token.type === "IDENT" && WORD.test(token.text);
}

/**
 * How many plain words start at `pos`, up to `limit`.
 *
 * @param tokens - The line's tokens.
 * @param pos - Where the run starts.
 * @param limit - The most words to count.
 * @returns The length of the run.
 */
export function nameWordRun(tokens: readonly Token[], pos: number, limit: number): number {
	let n = 0;
	while (n < limit && isNameWord(tokens[pos + n])) n++;
	return n;
}

/**
 * The name a definition line gives, when its left side is a run of two to
 * {@link MAX_NAME_WORDS} plain words: `hourly rate = $50` gives `hourly rate`.
 *
 * @param tokens - The line's tokens.
 * @returns The words, or `null` when the line does not define a name of
 * several words.
 */
export function definedNameWords(tokens: readonly Token[]): string[] | null {
	// The token types first: a run of identifiers and then the `=`. A line of
	// prose has no `=` after its words, and is turned away before any of them
	// meets the letter pattern. A word that fails the pattern inside the run
	// would have ended the run at an identifier, which is no `=` either.
	let run = 0;
	while (run <= MAX_NAME_WORDS && tokens[run]?.type === "IDENT") run++;
	if (run < 2 || run > MAX_NAME_WORDS) return null;
	if (tokens[run]?.type !== "EQUALS") return null;
	if (nameWordRun(tokens, 0, run) !== run) return null;
	const words: string[] = [];
	for (let i = 0; i < run; i++) words.push(tokens[i].value);
	return words;
}

/** The key a name is stored and matched under: its words, one space apart. */
export function nameKey(words: readonly string[]): string {
	return words.join(" ");
}

/**
 * The names of several words the document has defined, per engine.
 *
 * Matched case-sensitively, as every variable name is: `Hourly Rate` and
 * `hourly rate` are two names.
 *
 * A name belongs to the lines that define it, by persistent line id. The
 * incremental evaluator drops a line's names before it compiles the line
 * again, and the line puts them straight back when it still defines them. So a
 * name its last line gave up is not forgotten at once: it is held as released
 * until the end of the pass ({@link settle}), and a definition that takes it
 * back in the meantime is not a new name. Without that, every run of a
 * definition line would look like a new name and invalidate the whole
 * document on every pass.
 */
export class MultiWordNameTable {
	/** The lines defining each name, keyed by {@link nameKey}. A `Map`, so `constructor thing` is only ever its own entry. */
	private readonly owners = new Map<string, Set<number>>();
	/** Names whose last defining line let go of them during this pass. */
	private readonly released = new Set<string>();
	private longestName = 0;
	/** Which names the line now being read may use, by their defining lines; null for every name. See {@link setVisibility}. */
	private visible: ((definedByLineIds: ReadonlySet<number>) => boolean) | null = null;
	/** Whether {@link match} passed over a name {@link visible} hid, since {@link takeHidden} last asked. */
	private hidSome = false;

	/** Whether no name is registered, the hot path's guard. */
	get isEmpty(): boolean {
		return this.owners.size === 0;
	}

	/** The most words any registered name spans, bounding the lookup scan. */
	get maxWordCount(): number {
		return this.longestName;
	}

	/** Every registered name. */
	get names(): string[] {
		return [...this.owners.keys()];
	}

	/**
	 * Register a name for a line.
	 *
	 * @param words - The name's words, at least two.
	 * @param definedByLineId - The persistent id of the defining line, -1 for none.
	 * @returns Whether the name is new, which is when compiled programs that read
	 * its words apart must be dropped. A name taken back from {@link released}
	 * is not new.
	 */
	define(words: readonly string[], definedByLineId = -1): boolean {
		if (words.length < 2) return false;
		const key = nameKey(words);
		let lines = this.owners.get(key);
		const known = lines !== undefined || this.released.delete(key);
		if (lines === undefined) {
			lines = new Set();
			this.owners.set(key, lines);
		}
		lines.add(definedByLineId);
		if (words.length > this.longestName) this.longestName = words.length;
		return !known;
	}

	/**
	 * How many of `words` the longest registered name they begin with spans, or
	 * 0 when they begin with none.
	 *
	 * @param words - A run of plain words.
	 * @returns The word count of the match, at least 2, or 0.
	 */
	match(words: readonly string[]): number {
		for (let length = Math.min(words.length, this.longestName); length >= 2; length--) {
			const lines = this.owners.get(nameKey(words.slice(0, length)));
			if (lines === undefined) continue;
			if (this.visible === null || this.visible(lines)) return length;
			this.hidSome = true;
		}
		return 0;
	}

	/**
	 * Limit {@link match} to the names a line may read, or lift the limit with
	 * `null`. `visible` is given the ids of a name's defining lines and answers
	 * whether the line now being read comes after one of them.
	 *
	 * The table holds every name the document defines, and a document read from
	 * the top has defined only those above the line it is reading: `hourly rate
	 * * 2` above `hourly rate = 5` is two words there, not the name. The
	 * incremental evaluator keeps the table between passes, so it sets this for
	 * the length of a pass to read each line as a pass from the top does.
	 *
	 * @param visible - The test, or null.
	 */
	setVisibility(visible: ((definedByLineIds: ReadonlySet<number>) => boolean) | null): void {
		this.visible = visible;
		this.hidSome = false;
	}

	/**
	 * Whether a name of these words is registered and the line now being read
	 * may not use it. False for a name not registered at all, and for every name
	 * while no visibility test is set.
	 *
	 * @param name - The name's words, one space apart, as {@link nameKey} joins them.
	 */
	isHidden(name: string): boolean {
		if (this.visible === null) return false;
		const lines = this.owners.get(name);
		return lines !== undefined && !this.visible(lines);
	}

	/**
	 * Whether {@link match} has passed over a hidden name since this was last
	 * asked, and start counting again. A program compiled while a name was
	 * hidden reads its words apart, which is right only above the name's
	 * definition, so the engine does not keep it for a line below.
	 */
	takeHidden(): boolean {
		const hid = this.hidSome;
		this.hidSome = false;
		return hid;
	}

	/**
	 * Let go of every name `lineId` defines, for a line compiled again or
	 * removed. A name no other line defines is released until {@link settle}.
	 *
	 * @param lineId - The persistent id of the line.
	 * @returns Whether a name lost its last defining line.
	 */
	undefineFrom(lineId: number): boolean {
		if (lineId < 0) return false;
		let released = false;
		for (const [key, lines] of this.owners) {
			if (!lines.delete(lineId) || lines.size > 0) continue;
			this.owners.delete(key);
			this.released.add(key);
			released = true;
		}
		return released;
	}

	/**
	 * End a pass: a name released and not defined again is gone.
	 *
	 * @returns Whether any name went, which is when compiled programs that fused
	 * its words must be dropped.
	 */
	settle(): boolean {
		const gone = this.released.size > 0;
		this.released.clear();
		return gone;
	}

	/**
	 * Run `read` with `names` registered as well, then take them away again.
	 *
	 * For reading a document's text without evaluating it (the language
	 * service's references, hover and rename): a line below `hourly rate = $50`
	 * reads `hourly rate` as one name only once the name is registered, and a
	 * reading must not register it for real. A name already in the table is
	 * left as it is, and exactly the names this added are removed afterwards.
	 *
	 * @param names - Names of several words, one space apart.
	 * @param read - The work to do with them in place.
	 * @returns Whatever `read` returns.
	 */
	withNames<T>(names: readonly string[], read: () => T): T {
		if (names.length === 0) return read();
		const added: string[] = [];
		const longestBefore = this.longestName;
		for (const name of names) {
			// A name held, or released mid-pass, is the engine's to keep or drop.
			if (this.owners.has(name) || this.released.has(name)) continue;
			if (this.define(name.split(" "))) added.push(name);
		}
		try {
			return read();
		} finally {
			for (const name of added) this.owners.delete(name);
			this.longestName = longestBefore;
		}
	}

	/** Drop every name, when a fresh document pass begins. */
	clear(): void {
		this.owners.clear();
		this.released.clear();
		this.longestName = 0;
	}
}

/** The fused name token: an identifier whose value is the words one space apart. */
function fusedName(tokens: readonly Token[], pos: number, count: number): Token {
	const words = tokens.slice(pos, pos + count);
	const fused = createFusedToken("IDENT", words.map((t) => t.text).join(" "), words);
	fused.value = nameKey(words.map((t) => t.value));
	return fused;
}

/**
 * The words before a definition's `=` fused into one name: `hourly rate = $50`
 * reads as the name `hourly rate` given `$50`. Needs no table, so the line that
 * defines a name reads the same on every path, a single expression included.
 *
 * @param priority - Above {@link multiWordNameRule}, so a definition that
 * extends a registered name (`hourly rate cap = 70` under `hourly rate`) takes
 * all its words.
 */
export function multiWordDefinitionRule(priority = 84): NormalizerRule {
	return {
		name: "variables:multi-word-definition",
		priority,
		shape: [{ types: ["IDENT"] }, { types: ["IDENT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			if (pos !== 0) return null;
			const words = definedNameWords(tokens);
			if (words === null) return null;
			return { consumed: words.length, replacement: [fusedName(tokens, 0, words.length)], ruleName: "variables:multi-word-definition" };
		},
	};
}

/**
 * A run of words the document has defined as a name, fused into it wherever it
 * appears: `hourly rate * 8` under `hourly rate = $50`. The longest registered
 * name wins, so `hourly rate` and `rate` can both be defined and each reads
 * as itself.
 *
 * Not after a colon that opens `:name` (the colon forms keep their one-word
 * name), and never in front of a `(`, which makes the last word a call.
 *
 * @param table - The engine's table of names.
 * @param priority - Below every phrase rule, so a registered name never takes
 * words a phrase would fuse: a name cannot shadow a phrase.
 */
export function multiWordNameRule(table: MultiWordNameTable, priority = 30): NormalizerRule {
	return {
		name: "variables:multi-word-name",
		priority,
		shape: [{ types: ["IDENT"] }, { types: ["IDENT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			if (table.isEmpty) return null;
			const previous = tokens[pos - 1];
			if (previous?.type === "COLON" && (pos === 1 || tokens[pos - 2]?.type === "GLOBAL")) return null;
			const run = nameWordRun(tokens, pos, table.maxWordCount);
			if (run < 2) return null;
			const words: string[] = [];
			for (let i = 0; i < run; i++) words.push(tokens[pos + i].value);
			const count = table.match(words);
			if (count === 0) return null;
			if (tokens[pos + count]?.type === "LPAREN") return null;
			return { consumed: count, replacement: [fusedName(tokens, pos, count)], ruleName: "variables:multi-word-name" };
		},
	};
}

/**
 * A word that is letters and quote marks: what a reader typing a possessive
 * produces, including with a mark that is not an apostrophe.
 */
const QUOTED_WORD = /^[\p{L}\p{M}'’‘′‛`´-]+$/u;

/** The marks shaped like an apostrophe that are not one: an opening quote, a prime, a reversed quote, a grave and an acute accent. */
const NOT_AN_APOSTROPHE = /[‘′‛`´]/u;

/**
 * How a word typed as part of a name fails to be a name's word, or null when
 * it is one or is not word-shaped at all.
 *
 * A name's words are letters with an apostrophe or hyphen inside or at the end
 * (`Alice's`, `the Smiths' rent`). Two near misses are refused by name rather
 * than left to the parse error the line would otherwise give (`Expected an
 * operator ... but found "food"`), which says nothing about the quote mark:
 *
 * - A mark shaped like an apostrophe that is another character: an opening
 *   quote `‘`, a prime `′`, a reversed quote `‛`, a grave or an acute accent.
 *   It is read as the name's own character elsewhere, so `Alice‘s` and
 *   `Alice's` would be two names that look the same.
 * - An apostrophe before the first letter (`’tis`). A name's word starts with a
 *   letter, and a straight `'` there is skipped as any stray mark is, so the
 *   two apostrophes would read differently.
 *
 * @param text - A token's text.
 * @returns The reason, for {@link multiWordNameRefusal}, or null.
 */
export function quoteMarkInWord(text: string): string | null {
	if (WORD.test(text) || !QUOTED_WORD.test(text)) return null;
	const mark = NOT_AN_APOSTROPHE.exec(text);
	if (mark !== null) return `"${mark[0]}" in "${text}" is a quotation mark, not an apostrophe. Write the apostrophe as ' or ’`;
	if (/^['’]/u.test(text)) return `"${text}" starts with an apostrophe, and a word in a name starts with a letter`;
	return null;
}

/** Whether a token is an operator spelled as a word (`take`, `plus`, `times`), as opposed to its symbol. */
function isOperatorWord(token: Token | undefined): boolean {
	return token !== undefined && OPERATOR_WORD_MEANING[token.type] !== undefined && WORD.test(token.text);
}

/** How one word before a definition's `=` stands in the way of a name, or null when it is a plain word. */
function reservedWord(token: Token): string | null {
	if (isNameWord(token)) return null;
	const meaning = OPERATOR_WORD_MEANING[token.type];
	if (meaning !== undefined && WORD.test(token.text)) return `"${token.text}" is a spelling of ${meaning}`;
	if (PHRASE.test(token.text) && token.type !== "IDENT" && token.type !== "UNIT") return `"${token.text}" is a phrase the engine reads`;
	return null;
}

/**
 * The refusal for a definition whose would-be name holds a word the engine
 * already reads, or `null` when the line is not one.
 *
 * Two shapes are refused, each a line of words before an `=` that could only
 * have been meant as a name:
 *
 * - An operator spelled as a word, first, before plain words: `take home = 5`,
 *   `plus rate = 5`. Read as arithmetic these stored `-home = 5` and `+rate =
 *   5` as equations; the refusal says what the word is and how to write each
 *   meaning. An operator word between names (`x plus y = 10`) is an equation
 *   as it always was.
 * - The same word last, after plain words: `monthly take = 4000`. An operator
 *   with nothing on its right is no arithmetic, so there is no equation to
 *   offer, and the line used to fail with "The line ends after take".
 * - A word with a quote mark that is not an apostrophe, or an apostrophe
 *   before its first letter (`Alice‘s food = 3`, `’tis rate = 5`); see
 *   {@link quoteMarkInWord}.
 * - A fused phrase among the words: `tax on = 5`, `hourly for = 5`. These
 *   failed with the phrase's own "expected a value" message.
 *
 * @param tokens - The line's normalised tokens.
 * @param eqIdx - The index of the line's first `=`.
 * @returns The error to throw, or `null`.
 */
export function multiWordNameRefusal(tokens: readonly Token[], eqIdx: number): EngineError | null {
	if (eqIdx < 1 || eqIdx > MAX_NAME_WORDS) return null;
	const first = tokens[0];
	let wordCount = 0;
	let quoteMark: string | null = null;
	for (let i = 0; i < eqIdx; i++) {
		const t = tokens[i];
		if (isNameWord(t) || WORD.test(t.text)) wordCount++;
		else if (PHRASE.test(t.text)) wordCount += t.text.split(" ").length;
		else if (t.type === "IDENT" && quoteMark === null && (quoteMark = quoteMarkInWord(t.text)) !== null) wordCount++;
		else return null;
	}
	if (wordCount < 2 || wordCount > MAX_NAME_WORDS) return null;
	if (quoteMark !== null) {
		const typedName = tokens.slice(0, eqIdx).map((t) => t.text).join(" ");
		return ErrorFactory.parsing({
			code: VariablesErrorCodes.NAME_HAS_QUOTE_MARK,
			message: `"${typedName}" cannot be a name: ${quoteMark}.`,
			context: { name: typedName },
		});
	}
	let reason: string | null = null;
	let equation = "";
	if (isOperatorWord(first)) {
		// Only before plain words: the rest of the left side is a name's words.
		for (let i = 1; i < eqIdx; i++) if (!isNameWord(tokens[i])) return null;
		reason = reservedWord(first);
		const rest = tokens.slice(1, eqIdx).map((t) => t.text).join(" ");
		const right = tokens.slice(eqIdx + 1).map((t) => t.text).join(" ");
		if (eqIdx === 2 && right !== "") equation = ` For the equation, write ${OPERATOR_SYMBOL[first.type]}${rest} = ${right}.`;
	} else if (isOperatorWord(tokens[eqIdx - 1])) {
		// Last, after plain words: `monthly take = 4000`. An operator with
		// nothing on its right is no arithmetic, so the line can only have
		// meant a name, and it failed with "The line ends after take".
		for (let i = 0; i < eqIdx - 1; i++) if (!isNameWord(tokens[i])) return null;
		reason = reservedWord(tokens[eqIdx - 1]);
	} else {
		for (let i = 0; i < eqIdx && reason === null; i++) {
			const t = tokens[i];
			// A fused phrase only; an operator word inside the words is an equation's.
			if (PHRASE.test(t.text) && t.type !== "IDENT" && t.type !== "UNIT") reason = reservedWord(t);
		}
	}
	if (reason === null) return null;
	const typed = tokens.slice(0, eqIdx).map((t) => t.text).join(" ");
	const joined = tokens.slice(0, eqIdx).map((t) => t.text.replace(/ /g, "_")).join("_");
	return ErrorFactory.parsing({
		code: VariablesErrorCodes.NAME_HAS_RESERVED_WORD,
		message: `"${typed}" cannot be a name: ${reason}. Choose other words, or join them as ${joined}.${equation}`,
		suggestion: joined,
		context: { name: typed },
	});
}
