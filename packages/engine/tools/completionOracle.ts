/**
 * The completion vocabulary as one engine built it whole, kept as an oracle.
 *
 * Until the built-in units were shared across engines, `LanguageService`
 * gathered every static candidate into one list per engine: the packages'
 * items, the keywords with a highlight category, the call words, the phrases
 * and then every built-in unit, one entry per category and lowercased label,
 * the first route winning. The service no longer holds that list (its units
 * live once per process, in `language/builtinUnitCompletions.ts`), so the
 * specs that prove the results unchanged rebuild it here, from the engine's
 * public pieces, exactly as it was built.
 */
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { CompletionItem } from "@solve-js/language/LanguageService";
import { knownUnits } from "@solve-js/lexer/units";
import { getMeasure } from "@solve-js/uom/UomConverter";

/**
 * Every static completion candidate for `engine`, in the order the service
 * gathered them before the units were shared, deduplicated as it did.
 *
 * @param engine - The engine the language service reads.
 */
export function referenceStaticCandidates(engine: ExpressionEngine): CompletionItem[] {
	const items: CompletionItem[] = [];
	const seen = new Set<string>();
	const add = (item: CompletionItem): void => {
		const key = `${item.category}\u0000${item.label.toLowerCase()}`;
		if (seen.has(key)) return;
		seen.add(key);
		items.push(item);
	};
	for (const item of engine.getPackageCompletionItems()) add(item);
	for (const [word, tokenType] of Object.entries(engine.getLexer().getKeywords())) {
		const category = engine.getTokenCategory(tokenType);
		if (!category) continue;
		add({ label: word, category });
	}
	for (const word of engine.getCallWords()) {
		add({ label: word, category: "function", detail: "function call" });
	}
	for (const [phrase, tokenType] of Object.entries(engine.getNormalizer().getPhrases())) {
		add({ label: phrase, category: engine.getTokenCategory(tokenType) ?? "keyword", detail: "phrase" });
	}
	for (const unit of knownUnits) {
		add({ label: unit, category: "unit", detail: getMeasure(unit) });
	}
	return items;
}

/**
 * `getCompletions` as it was before the static buckets were kept sorted:
 * gather the document's names, the static matches in candidate order and the
 * phrases matched across words, then sort all of them on every call by tier
 * and label and keep the first 50.
 *
 * @param engine - The engine the language service reads.
 * @param variables - The document's variable names, as the service's source gives them.
 * @param lineText - The line being typed.
 * @param cursorOffset - Where the cursor is on it.
 */
export function referenceCompletions(engine: ExpressionEngine, variables: Iterable<string>, lineText: string, cursorOffset: number): CompletionItem[] {
	const prefixMatch = /[A-Za-z0-9_]+$/.exec(lineText.slice(0, cursorOffset));
	if (!prefixMatch) return [];
	const prefix = prefixMatch[0].toLowerCase();
	const matches: CompletionItem[] = [];
	for (const name of variables) {
		if (name.toLowerCase().startsWith(prefix)) matches.push({ label: name, category: "variable" });
	}
	for (const name of engine.userUnitNames()) {
		if (name.toLowerCase().startsWith(prefix)) matches.push({ label: name, category: "unit", detail: "defined in this document" });
	}
	const candidates = referenceStaticCandidates(engine);
	for (const item of candidates) {
		if (item.label.toLowerCase().startsWith(prefix)) matches.push(item);
	}
	const words = /(?:[A-Za-z0-9_]+ +){0,5}[A-Za-z0-9_]+$/.exec(lineText.slice(0, cursorOffset));
	if (words !== null && words[0].length > prefixMatch[0].length) {
		const typed = words[0];
		let start = 0;
		for (let n = 0; n < 6 && start < typed.length - prefixMatch[0].length; n++) {
			const tail = typed.slice(start).toLowerCase().replace(/ +/g, " ");
			for (const item of candidates) {
				const lower = item.label.toLowerCase();
				if (lower.includes(" ") && lower.startsWith(tail)) matches.push({ ...item, replaceLength: typed.length - start });
			}
			const nextSpace = typed.indexOf(" ", start);
			if (nextSpace < 0) break;
			start = nextSpace;
			while (typed[start] === " ") start++;
		}
	}
	const tier = (category: string): number =>
		category === "variable" ? 0 : category === "unit" ? 2 : ["function", "keyword", "operator", "comparison", "bitwise", "datetime", "vector"].includes(category) ? 1 : 3;
	matches.sort((a, b) => tier(a.category) - tier(b.category) || a.label.localeCompare(b.label));
	return matches.slice(0, 50);
}
