import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { TokenCategory } from "@solve-js/language/TokenCategory";
import { getTokenCategory } from "@solve-js/language/TokenCategoryMap";
import type { Token } from "@solve-js/lexer/Token";
import { knownUnits } from "@solve-js/lexer/units";
import { getMeasure } from "@solve-js/uom/UomConverter";
import {
	DocumentReferences,
	type DocumentPosition,
	type LineResults,
	type LineShift,
	type LineShiftResult,
	type RenameResult,
	type VariableHover,
	type VariableReference,
} from "@solve-js/language/DocumentReferences";

/** A single classified span within a line, the entire output contract of the language service. */
export interface SemanticToken {
	from: number;
	to: number;
	category: TokenCategory;
}

/** A single completion candidate, the entire output contract of `getCompletions()`. */
export interface CompletionItem {
	label: string;
	/** Reuses the highlighting taxonomy, one adapter can serve both features. */
	category: TokenCategory;
	/** e.g. a unit's measure ("length"), or the category name for keywords/functions. */
	detail?: string;
}

/**
 * A completion candidate with its lowercased label precomputed.
 *
 * Internal to the prefix index; callers only ever see the {@link CompletionItem}.
 */
interface IndexedCompletionCandidate {
	item: CompletionItem;
	lowerLabel: string;
}

/** Completion results are capped, a document-wide candidate pool has no reason to return more than this. */
const MAX_COMPLETIONS = 50;

/** Tier ordering for completion results: user-authored variables first, then grammar, then units. */
const CATEGORY_TIER: Partial<Record<TokenCategory, number>> = {
	variable: 0,
	function: 1,
	keyword: 1,
	operator: 1,
	comparison: 1,
	bitwise: 1,
	datetime: 1,
	vector: 1,
	unit: 2,
};

/** Bounded cache size. See the eviction-policy note on `LanguageService.cache`. */
const MAX_CACHED_LINES = 2000;

/**
 * Whether `token` is the colon of a clock time (`12:30`): a colon written hard
 * between two numbers, which is part of the number rather than a variable's
 * sigil (#576).
 *
 * @param lexed - The line's highlight tokens, in order.
 * @param token - One of them.
 */
function isClockColon(
	lexed: readonly { type: string; offset: number; length: number }[],
	token: { type: string; offset: number; length: number },
): boolean {
	if (token.type !== "COLON") return false;
	const i = lexed.indexOf(token);
	const before = lexed[i - 1];
	const after = lexed[i + 1];
	return (
		before?.type === "NUMBER" && before.offset + before.length === token.offset &&
		after?.type === "NUMBER" && token.offset + token.length === after.offset
	);
}

/**
 * The offset of a running total's name (`total` in `total += 5`), or -1 when
 * the line is not one.
 *
 * The name is always a variable, whatever the lexer made of it on its own: the
 * engine reads `b += 5` as adding to a variable called `b` (see
 * `ExpressionEngine.tryCompoundAssignment`), where the lexer, which sees one
 * word at a time, reads a lone `b` as the unit bit.
 *
 * @param lexed - The line's highlight tokens, in order.
 */
function runningTotalNameOffset(lexed: readonly { type: string; offset: number }[]): number {
	const name = lexed[0];
	const operator = lexed[1];
	if (name === undefined || operator === undefined) return -1;
	if (name.type !== "IDENT" && name.type !== "UNIT") return -1;
	if (operator.type !== "PLUS_EQUALS" && operator.type !== "MINUS_EQUALS") return -1;
	return name.offset;
}

interface CacheEntry {
	text: string;
	tokens: SemanticToken[];
	// When set, `tokens` is a single bare-identifier token whose validity
	// depends on document-wide DAG state (see the bare-word gate in
	// getSemanticTokens), not just this line's own text, so it can't be
	// cached as a plain pass/fail result the way every other line can. The
	// lex+parse work that produced `tokens` is still cached normally; only
	// the DAG membership check is re-run on every lookup (cache hit or
	// miss alike), since it's cheap (a Set lookup) and the alternative
	// caching the gated result, would go stale the moment some OTHER
	// line's edit changes what variables exist, with nothing to trigger a
	// re-check of this untouched line.
	bareWordCandidate?: string;
}

/** Options for the editor-facing language service: completions and highlighting. */
export interface LanguageServiceOptions {
	/**
	 * Overrides how the service discovers "variable names known in this
	 * document", used to legitimize a lone bare identifier line (see
	 * `getSemanticTokens`'s single-token gate) and variable-name
	 * completions (`getCompletions`). Defaults to reading
	 * `engine.getDag().getSnapshot()`, which works for any consumer
	 * sharing one `ExpressionEngine` between evaluation and the language
	 * service (the real Obsidian editor).
	 *
	 * Required for consumers whose language service is backed by a
	 * *different*, non-evaluating engine than the one that actually runs
	 * the document (the playground's dedicated lexing-only engine, whose
	 * own DAG is always empty), pass a function reading the real
	 * evaluation engine's DAG snapshot instead.
	 */
	variableNameSource?: () => Iterable<string>;

	/**
	 * Run the normalizer on the highlighting path, so phrase-fused tokens are
	 * classified as the thing the parser will actually see.
	 *
	 * Off by default, and the default is a judgement rather than an oversight.
	 * Highlighting runs per keystroke, normalization is real work, and a host
	 * that is happy with lexer-level categories should not start paying for
	 * fusion because a new version shipped. Turn it on and `12/09/2026` is one
	 * `datetime` span instead of five number and operator spans; leave it off
	 * and nothing about this class changes.
	 *
	 * See `benchmarks/languageServiceBenchmarks.spec.ts` for what it costs.
	 */
	normalizeForHighlighting?: boolean;
}

/**
 * Editor-agnostic "language server" for solve expressions: turns a line of
 * text into semantic token ranges, using the exact same lexer real
 * evaluation uses (so it only ever classifies what the engine's grammar
 * actually recognizes, never a separate/duplicated tokenizer). No
 * knowledge of CSS, CodeMirror, VS Code, or any other rendering concept
 * lives here. See `language/adapters/` for that.
 *
 * Classification happens at the LEXER stage, before the normalizer runs
 * (normalization, phrase fusion, implicit multiply, and package-specific
 * rules, happens later, only on the real evaluation path). A package's
 * lexer-level custom token types (e.g. a custom keyword) are recognized
 * here exactly as evaluation would see them. A package's *normalizer*-fused
 * synthetic tokens (e.g. OSRS's GAME_ITEM, built by fusing several
 * consecutive IDENT tokens against an item-name trie) are NOT. This
 * service still shows the pre-fusion IDENT tokens individually for those.
 * `IEnginePackage.tokenCategories` entries for normalizer-only token types
 * are still valid, correct registrations (queryable via getTokenCategory)
 *, they just won't currently be reachable through this lexer-only
 * classification path. Folding normalization in would require running it
 * per keystroke on the highlighting path too, which needs its own careful
 * design (span recomputation for fused multi-token ranges, in particular)
 * rather than a quick addition here.
 *
 * Lexing alone is NOT sufficient to decide "recognized", though: a run of
 * plain-English words ("My name is ron") lexes into a sequence of
 * individually-valid IDENT tokens with no grammar tying them together
 * every word "recognized" at the token level, but the line as a whole is
 * not something the engine would ever accept as an expression. Surfacing
 * per-token colors for that case looks like the editor mistook prose for
 * code. So a line's tokens are only surfaced once the line as a whole
 * parses successfully (via `ExpressionEngine.tryCompileExpression`, the same
 * parse pipeline, and the same bytecode cache, real evaluation uses; no
 * separate/duplicated grammar check). That check is read-only: a line is
 * compiled, never run, so highlighting cannot change what the document
 * holds. A single bare word ("hello", a valid
 * variable reference) or a keyword-only line ("pi") still parses and still
 * highlights, only genuinely ungrammatical text is suppressed, unless it's
 * a known variable elsewhere in the document (see `variableNameSource`).
 *
 * `getCompletions()` is the other half of this "language server": unlike
 * `getSemanticTokens()`, it's explicitly for *incomplete*, mid-typing text
 *, it deliberately does NOT gate on parse validity (a half-typed
 * expression almost never parses), using simple prefix matching instead.
 *
 * Must be constructed with an already-configured `ExpressionEngine` (one
 * with all currently-relevant packages registered) rather than a bare
 * lexer, reusing an existing engine is both the fast path (no throwaway
 * lexer construction) and the *correct* one: a highlighting-only lexer
 * built independently of the evaluation engine would silently fail to
 * recognize plugin-contributed tokens (e.g. a package's custom keywords)
 * unless it happened to have the identical packages registered.
 */
export class LanguageService {
	private engine: ExpressionEngine | null;
	private variableNameSource: () => Iterable<string>;
	private readonly normalizeForHighlighting: boolean;

	// Bounded cache keyed by line number ALONE, not `${lineNumber}:${lineText}`
	// as an earlier version of this class did. A line's previous text state is
	// never useful once it changes, so keying on text too was pure waste:
	// every keystroke on a line minted a brand-new, never-reclaimed cache
	// entry (an effective per-keystroke memory leak over a long editing
	// session). Keying on line number alone makes "same line, new text" a
	// cheap overwrite instead.
	//
	// Eviction is oldest-inserted (Map iteration order) when at capacity
	// mirroring the same bounded-cache pattern ExpressionEngine's own
	// bytecodeCache already uses elsewhere in this codebase. Deliberately
	// NOT an LFU (least-frequently-used) policy: LFU would keep resisting
	// eviction of old, once-popular lines while punishing a line that just
	// scrolled into view (frequency 1), the opposite of what a "currently
	// visible" cache should prioritize.
	private cache = new Map<number, CacheEntry>();

	// Keyword/unit/package-contributed completion candidates don't depend
	// on any particular line, built lazily on first getCompletions() call
	// and reused after that, since a package registration is the only thing
	// that could ever change this list mid-session (see invalidateCache()).
	// Variable-name candidates are NOT part of this, they're read fresh on
	// every call from variableNameSource(), since those genuinely change on
	// every edit.
	private staticCompletionCandidates: CompletionItem[] | null = null;

	// The same candidates, bucketed by their lowercased first character with the
	// lowercased label precomputed. getCompletions() runs on every keystroke and
	// only ever wants candidates sharing the prefix's first character, so
	// scanning the whole list and lowercasing each label per call was doing two
	// avoidable things: touching entries that could not possibly match, and
	// allocating a string per candidate per keystroke. That was affordable when
	// the vocabulary was a few hundred entries. Deriving the unit list from the
	// conversion tables took it past a thousand, and the warm completion
	// benchmarks regressed roughly 2.9x until this was added.
	private staticCompletionIndex: Map<string, IndexedCompletionCandidate[]> | null = null;

	// Built on the first reference query, so a host that only highlights and
	// completes never constructs it.
	private documentReferences: DocumentReferences | null = null;

	constructor(engine?: ExpressionEngine | null, options?: LanguageServiceOptions) {
		this.engine = engine ?? null;
		this.variableNameSource = options?.variableNameSource ?? (() => this.defaultVariableNames());
		this.normalizeForHighlighting = options?.normalizeForHighlighting ?? false;
	}

	private defaultVariableNames(): Iterable<string> {
		if (!this.engine) return [];
		const snapshot = this.engine.getDag().getSnapshot();
		const names = new Set<string>(Object.keys(snapshot.consumers));
		for (const written of Object.values(snapshot.writes)) {
			for (const name of written) names.add(name);
		}
		return names;
	}

	/**
	 * Lex a line, normalize it, and place every resulting token back in the
	 * source text.
	 *
	 * ## Why placing them back is the hard part
	 *
	 * Normalization produces three kinds of token and only one of them can be
	 * highlighted the obvious way.
	 *
	 * A token the normalizer left alone still describes its own text, so its
	 * span is `offset` to `offset + text.length`, exactly as before.
	 *
	 * A FUSED token does not. `10 frames` becomes a FRAME_COUNT whose value is
	 * `10`, and a timecode becomes a token whose value is a comma-separated
	 * tuple appearing nowhere on the line. Those carry `sourceEnd`, set by
	 * `createFusedToken`, which is the only place that knows where the fusion
	 * ended.
	 *
	 * An INSERTED token has no text at all. Implicit multiplication puts a STAR
	 * at the following token's offset, so `5(3)` gains a `*` sitting exactly
	 * where the `(` is. Painting it would colour a character the reader never
	 * typed as an operator, and would overlap the token that really is there.
	 * These are dropped, detected by the one test that needs no cooperation
	 * from any rule: a token with no recorded fusion span must match the text
	 * at its own offset, and an inserted one does not.
	 *
	 * @param lineText - The raw line.
	 * @param from - Where the line's content starts, from `Lexer.highlightContentStart`.
	 * @returns Spans in the same shape `Lexer.getHighlightTokens` returns.
	 */
	private classifyNormalized(
		lineText: string,
		from: number,
	): { type: string; value: string; offset: number; col: number; length: number; category: TokenCategory | undefined }[] {
		const raw = this.engine!.getLexer().getHighlightTokenObjects(lineText, from);
		if (raw.length === 0) return [];

		// Offsets are measured on the line as written, past any marker too, so
		// the text each token is checked against is the whole line.
		const source = lineText;

		let normalized: Token[];
		try {
			normalized = this.engine!.getNormalizer().normalize(raw);
		} catch {
			// Normalization is an enhancement here, not a requirement. A rule
			// that throws on a half-typed line should cost the reader phrase
			// colouring, not all colouring.
			normalized = raw;
		}

		const out: {
			type: string;
			value: string;
			offset: number;
			col: number;
			length: number;
			category: TokenCategory | undefined;
		}[] = [];

		for (const token of normalized) {
			let end: number;
			if (token.sourceEnd !== undefined) {
				end = token.sourceEnd;
			} else if (source.startsWith(token.text, token.offset)) {
				// `text`, not `value`. They are the same string for almost every
				// token, and differ for a string literal, whose value is the
				// payload while its text is the quoted source slice. Matching on
				// value dropped every string literal from the painted line,
				// since `gbp` does not appear at the offset where `"gbp"` does.
				end = token.offset + token.text.length;
			} else {
				continue;
			}

			out.push({
				type: token.type,
				value: token.value,
				offset: token.offset,
				col: token.col,
				length: end - token.offset,
				category: getTokenCategory(token.type),
			});
		}

		return out;
	}

	/**
	 * Classify every recognized token on one line.
	 *
	 * @param lineText - The raw line text (may be a markdown-structural line
	 *   the engine's classifier skips, that's handled by the underlying
	 *   lexer, which returns no tokens for those).
	 * @param lineNumber - 1-based line number, used purely as a cache key.
	 */
	getSemanticTokens(lineText: string, lineNumber: number): SemanticToken[] {
		const cached = this.cache.get(lineNumber);
		if (cached && cached.text === lineText) {
			if (cached.bareWordCandidate !== undefined) {
				return this.isKnownVariable(cached.bareWordCandidate) ? cached.tokens : [];
			}
			return cached.tokens;
		}

		if (!this.engine) {
			// No engine available (e.g. a consumer that hasn't wired one up yet)
			//, no highlighting, not an error.
			return [];
		}

		const lexer = this.engine.getLexer();
		const classification = lexer.classifyLine(lineText);
		// Past a blockquote's `> ` and a list marker, the same place the
		// evaluator starts a list item. Every span is still measured on the
		// line as written (#567).
		const contentStart = lexer.highlightContentStart(lineText, classification);
		const lexed = this.normalizeForHighlighting
			? this.classifyNormalized(lineText, contentStart)
			: lexer.getHighlightTokens(lineText, contentStart);
		if (lexed.length === 0) {
			this.putCache(lineNumber, lineText, []);
			return [];
		}

		const tokens: SemanticToken[] = [];

		if (classification.hasInlineSolve) {
			// A line can mix markdown prose with one or more embedded
			// `s`...`` expressions. Only the text actually inside a
			// well-formed marker is a recognized expression, surrounding
			// prose lexes into individually-valid tokens too (see the class
			// doc comment) but is never something the engine would parse,
			// so it's excluded token-by-token via span membership rather
			// than gating the whole line pass/fail.
			const validSpans = lexer
				.findInlineSolves(lineText)
				.filter(span => this.parsesAsExpression(span.expression))
				.map(span => ({ from: span.start, to: span.end }));
			for (const token of lexed) {
				if (!token.category) continue;
				const from = token.offset;
				const to = token.offset + token.length;
				if (!validSpans.some(s => from >= s.from && to <= s.to)) continue;
				tokens.push({ from, to, category: token.category });
			}
		} else {
			// The parse check reads what was tokenized: the line past its
			// markers, which for a list item is the text the evaluator runs.
			const text = contentStart > 0 ? lineText.slice(contentStart) : lineText;
			if (this.parsesAsExpression(text)) {
				const runningTotalName = runningTotalNameOffset(lexed);
				const codeStart = contentStart + this.labelLength(text);
				for (const token of lexed) {
					if (!token.category) continue;
					// A label (`Total: 1 + 2`) is prose the parser set aside, not a
					// variable the line reads, so its words and colon stay
					// uncoloured (#576).
					if (token.offset < codeStart) continue;
					// The colon of a clock time (`12:30`) is part of the number,
					// not a variable's sigil.
					if (isClockColon(lexed, token)) {
						tokens.push({ from: token.offset, to: token.offset + token.length, category: "number" });
						continue;
					}
					const category = token.offset === runningTotalName ? "variable" : token.category;
					tokens.push({ from: token.offset, to: token.offset + token.length, category });
				}
			}
		}

		// A lone bare word ("hello") is exactly as ambiguous as a run of
		// prose ("My name is dave"), it happens to parse as a
		// single-identifier variable-reference expression, but that's true
		// of literally any English word, so on its own it isn't "recognized"
		// in any meaningful sense. Sigil-marked variables (":x", "$x") are
		// unaffected, those lex to TWO tokens (sigil + ident), never
		// hitting this single-token check. Keywords ("pi") are unaffected
		// too, their category is "keyword", not "variable". Only surface
		// it once it's an actual known variable elsewhere in the document
		// checked live (see the `bareWordCandidate` cache field), not baked
		// into the cached result, since another line's edit can make this
		// check flip without this line's own text ever changing.
		if (tokens.length === 1 && tokens[0].category === "variable") {
			const name = lineText.slice(tokens[0].from, tokens[0].to);
			this.putCache(lineNumber, lineText, tokens, name);
			return this.isKnownVariable(name) ? tokens : [];
		}

		this.putCache(lineNumber, lineText, tokens);
		return tokens;
	}

	/**
	 * How many characters of `text` are a label the parser sets aside
	 * (`Total: ` in `Total: 1 + 2`), or 0 when it has none. Asked only of a
	 * line with a colon past its first character, since only such a line can
	 * carry one, so an ordinary line costs nothing more to highlight.
	 */
	private labelLength(text: string): number {
		if (!this.engine || text.indexOf(":", 1) < 0) return 0;
		const read = this.engine.readExpressionTokens(text);
		if (read === null || read.start === 0) return 0;
		return read.tokens[read.start]?.offset ?? 0;
	}

	/**
	 * Completion candidates for the identifier prefix immediately before
	 * `cursorOffset` on `lineText`. Deliberately simple prefix matching, not
	 * parser-driven "what's grammatically valid here" prediction, a
	 * half-typed expression almost never parses, so gating on parse
	 * validity (the way `getSemanticTokens` does) would suppress
	 * completions almost always. This is the safest, fastest option that
	 * still delivers real value.
	 *
	 * Candidates come from three sources: keywords (which already include
	 * function names. See `ExpressionLexer.getKeywords()`'s doc comment)
	 * and units, both static per engine configuration and cached lazily;
	 * package-contributed items (`IEnginePackage.completionItems`), same
	 * cache; and variable names, read fresh from `variableNameSource()` on
	 * every call since those change on every edit.
	 */
	getCompletions(lineText: string, cursorOffset: number): CompletionItem[] {
		const prefixMatch = /[A-Za-z0-9_]+$/.exec(lineText.slice(0, cursorOffset));
		if (!prefixMatch) return [];
		const prefix = prefixMatch[0].toLowerCase();

		if (!this.engine) return [];

		const matches: CompletionItem[] = [];

		// Variables are read fresh every call and there are few of them, so they
		// stay a linear scan.
		for (const name of this.variableNameSource()) {
			if (name.toLowerCase().startsWith(prefix)) {
				matches.push({ label: name, category: "variable" });
			}
		}

		// Static candidates only ever match if they share the prefix's first
		// character, so consult that bucket alone.
		const bucket = this.getStaticCompletionIndex().get(prefix[0]);
		if (bucket) {
			for (const candidate of bucket) {
				if (candidate.lowerLabel.startsWith(prefix)) matches.push(candidate.item);
			}
		}

		matches.sort((a, b) => {
			const tierDiff = (CATEGORY_TIER[a.category] ?? 3) - (CATEGORY_TIER[b.category] ?? 3);
			if (tierDiff !== 0) return tierDiff;
			return a.label.localeCompare(b.label);
		});

		return matches.slice(0, MAX_COMPLETIONS);
	}

	/** Lazily builds and caches the keyword/unit/package-item candidate list. See `staticCompletionCandidates`. */
	private getStaticCompletionCandidates(): CompletionItem[] {
		if (this.staticCompletionCandidates) return this.staticCompletionCandidates;

		const items: CompletionItem[] = [];
		for (const [word, tokenType] of Object.entries(this.engine!.getLexer().getKeywords())) {
			const category = getTokenCategory(tokenType);
			if (!category) continue;
			items.push({ label: word, category });
		}
		for (const unit of knownUnits) {
			items.push({ label: unit, category: "unit", detail: getMeasure(unit) });
		}
		items.push(...this.engine!.getPackageCompletionItems());

		this.staticCompletionCandidates = items;
		return items;
	}

	/**
	 * The static candidates bucketed by lowercased first character, built once
	 * from {@link getStaticCompletionCandidates} and invalidated alongside it.
	 */
	private getStaticCompletionIndex(): Map<string, IndexedCompletionCandidate[]> {
		if (this.staticCompletionIndex) return this.staticCompletionIndex;

		const index = new Map<string, IndexedCompletionCandidate[]>();
		for (const item of this.getStaticCompletionCandidates()) {
			const lowerLabel = item.label.toLowerCase();
			const firstCharacter = lowerLabel[0];
			// A label cannot match any prefix if it is empty, and the prefix
			// regex guarantees at least one character on the query side.
			if (firstCharacter === undefined) continue;
			let bucket = index.get(firstCharacter);
			if (bucket === undefined) {
				bucket = [];
				index.set(firstCharacter, bucket);
			}
			bucket.push({ item, lowerLabel });
		}

		this.staticCompletionIndex = index;
		return index;
	}

	// ── Reference-aware editing ─────────────────────────────────────────────
	// Whole-document queries. Each takes the document's full text, reads it the
	// way the engine's batch pass does (a line is code only when it parses), and
	// returns positions or edits without evaluating anything. See
	// DocumentReferences.ts for the reading and its boundary.

	/**
	 * Every place the variable at `position` is named, its definitions and its
	 * reads, in document order. A word in prose is never included, since only
	 * a line that parses holds variables. Empty when `position` is not on one.
	 *
	 * @param text - The whole document.
	 * @param position - A one-based line and a zero-based character on it.
	 */
	findReferences(text: string, position: DocumentPosition): VariableReference[] {
		return this.references()?.findReferences(text, position) ?? [];
	}

	/**
	 * Go to definition: the definition the variable at `position` reads, which
	 * is the last one above it (or the occurrence itself, where it defines the
	 * name). Null when `position` is not on a variable or nothing above defines
	 * it, which is when the engine reports the name as undefined.
	 *
	 * @param text - The whole document.
	 * @param position - A one-based line and a zero-based character on it.
	 */
	getDefinition(text: string, position: DocumentPosition): VariableReference | null {
		return this.references()?.getDefinition(text, position) ?? null;
	}

	/**
	 * What to show when the pointer rests on a variable: the occurrence, the
	 * definition it reads with that line's text, and the value, read from the
	 * results the host already has. Nothing is evaluated here. Null when
	 * `position` is not on a variable.
	 *
	 * @param text - The whole document.
	 * @param position - A one-based line and a zero-based character on it.
	 * @param results - The document's results (`parseDocument`'s return value,
	 *   or a function from a line number to its value), for the hover's value.
	 */
	getHover(text: string, position: DocumentPosition, results?: LineResults): VariableHover | null {
		return this.references()?.getHover(text, position, results) ?? null;
	}

	/**
	 * Rename the variable at `position`, editing only the places it is named.
	 * Returns the edits, or a named refusal: not a variable, a global, a
	 * `newName` that is a keyword, a unit or not a name, a `newName` the
	 * document already uses, or a rename that would change how a line reads.
	 *
	 * @param text - The whole document.
	 * @param position - A one-based line and a zero-based character on it.
	 * @param newName - The name to give the variable, without a `:` sigil.
	 */
	rename(text: string, position: DocumentPosition, newName: string): RenameResult {
		const references = this.references();
		if (references === null) {
			return { ok: false, code: "RENAME_NO_ENGINE", message: "No engine is attached to this language service, so no line can be read as code." };
		}
		return references.rename(text, position, newName);
	}

	/**
	 * The edits that keep absolute `line N` references on the lines they meant
	 * after lines are inserted or deleted, as a spreadsheet keeps a reference
	 * on its row. A reference into a deleted line becomes `line deleted`, which
	 * answers with a named error, and is listed in the result.
	 *
	 * @param text - The whole document, after the change.
	 * @param change - Which lines were inserted or deleted.
	 */
	shiftLineReferences(text: string, change: LineShift): LineShiftResult {
		const references = this.references();
		if (references === null) {
			return { ok: false, code: "LINE_SHIFT_NO_ENGINE", message: "No engine is attached to this language service, so no line can be read as code." };
		}
		return references.shiftLineReferences(text, change);
	}

	/** The reference machinery for this service's engine, built on first use; null without an engine. */
	private references(): DocumentReferences | null {
		if (this.engine === null) return null;
		if (this.documentReferences === null) this.documentReferences = new DocumentReferences(this.engine);
		return this.documentReferences;
	}

	private isKnownVariable(name: string): boolean {
		for (const known of this.variableNameSource()) {
			if (known === name) return true;
		}
		return false;
	}

	/**
	 * Whether the engine's parser actually accepts a piece of text as a
	 * well-formed expression, not merely whether it lexes into individually
	 * recognized token types. See the class doc comment's prose example.
	 * `tryCompileExpression` is compile-only (lex → normalize → parse →
	 * cache bytecode, no VM execution, no network/async side effects) and
	 * reuses the engine's existing bytecode cache, so text that's already
	 * been evaluated (or previously highlight-checked) is a cache hit here
	 * too.
	 *
	 * Compile-only includes the lines that do their work while compiling: a
	 * running total, a bare assignment, an equation, a unit definition. They
	 * are checked, not run, so highlighting never changes a value the
	 * document holds. Before #559 they ran, and each highlight of
	 * `total += 5` added another 5 to the total.
	 *
	 * Deliberately calls the non-throwing `tryCompileExpression` rather than
	 * try/catching `compileExpression`. This runs on every visible line on
	 * every keystroke, and the common case for a real markdown document is
	 * lines that DON'T parse (prose), not lines that do. Throwing there would
	 * mean constructing a EngineError (with V8 stack-trace capture) for the
	 * common case instead of the rare one.
	 */
	private parsesAsExpression(text: string): boolean {
		return this.engine!.tryCompileExpression(text);
	}

	private putCache(lineNumber: number, text: string, tokens: SemanticToken[], bareWordCandidate?: string): void {
		if (!this.cache.has(lineNumber) && this.cache.size >= MAX_CACHED_LINES) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey !== undefined) this.cache.delete(oldestKey);
		}
		this.cache.set(lineNumber, { text, tokens, bareWordCandidate });
	}

	/**
	 * Evict specific lines (e.g. the lines actually touched by a CodeMirror
	 * change set) instead of the whole cache, the surgical counterpart to
	 * {@link invalidateCache}, letting a single-line edit stay cheap even in
	 * a large document: every other cached line is untouched and still hits
	 * on the next call.
	 */
	invalidateLines(lineNumbers: Iterable<number>): void {
		for (const lineNumber of lineNumbers) {
			this.cache.delete(lineNumber);
		}
	}

	/**
	 * Full cache clear. Reserved for cases with no meaningful "which lines
	 * changed" (e.g. the document was swapped wholesale, or a package was
	 * registered/unregistered mid-session, changing what categories exist).
	 * Prefer {@link invalidateLines} for ordinary edits. Also rebuilds the
	 * lazily-cached keyword/unit/package-item completion candidates on next
	 * use, the only thing that can change that list mid-session.
	 */
	invalidateCache(): void {
		this.cache.clear();
		this.staticCompletionCandidates = null;
		this.staticCompletionIndex = null;
	}
}
