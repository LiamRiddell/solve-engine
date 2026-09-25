/**
 * Reference-aware editing: where a variable is defined and read, a rename that
 * edits only those places, and `line N` references kept on the same line when
 * lines are inserted or deleted above them.
 *
 * ## Why this has to be the engine's answer
 *
 * A note mixes calculation with prose, and the two share words. In
 *
 * ```text
 * :tax = 20%
 * 100 + 100 * tax
 * tax is due in April
 * ```
 *
 * the first two `tax`es are a variable and the third is English. A find and
 * replace cannot tell them apart. The engine can, because it already decides it
 * on every evaluation: a line is code when it parses, and a word on a line of
 * code is a variable when the dependency graph reads or writes it there. This
 * module asks exactly those two questions, through
 * {@link ExpressionEngine.readExpressionTokens} (the real lexer, normaliser and
 * parser, a `label:` set aside as prose) and {@link extractReadsAndWrites} (the
 * graph's own rules, reporting positions), rather than a second tokeniser that
 * could disagree with them.
 *
 * ## What it returns
 *
 * Positions and edits, never a changed document. A host owns its text (an
 * editor's undo history, a collaborative document's operations), so every
 * change comes back as {@link TextEdit}s for the host to apply, against the
 * text it passed in. {@link applyTextEdits} applies them to a string for a host
 * that has nothing better.
 *
 * ## The boundary
 *
 * - A line is read the way the batch document pass reads it: a list marker is
 *   markup, an inline solve's backticks bound its expression, and a heading, a
 *   blockquote or a fenced line is not code at all.
 * - A `global :name` is shared with every document that reads it, so it can be
 *   found and hovered here but not renamed from one document.
 * - `prev`, `total above` and `average above` are relative by definition (they
 *   read whatever is above them now) and are never rewritten. Only an absolute
 *   `line N`, including a range's ends and goal seek's target, is shifted.
 */
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { extractReadsAndWrites, type NameUse } from "@solve-js/engine/ExpressionEngineSafety";
import type { Token } from "@solve-js/lexer/Token";
import type { DocumentUnit } from "@solve-js/packages/uom/UserUnitTable";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import type { Value } from "@solve-js/vm/Value";

/** A line break as the batch document scan recognises one: `\r\n`, `\r` or `\n`. */
const LINE_BREAK = /\r\n|\r|\n/g;

/**
 * The tokens that name a line by its number. A what-if (`line 4 with x = 5`)
 * and a sweep (`line 4 for x from 1 to 3 step 1`) fuse their `line N` into one
 * token that keeps N and the reference's own offset, so they are renumbered as
 * a plain reference is; without them an inserted line left both pointing at the
 * old line (#596).
 */
const LINE_NUMBER_TOKENS: ReadonlySet<string> = new Set(["LINE_REF", "WHAT_IF", "SWEEP"]);

/** The spelling a reference takes once its line is deleted. See the lines package's `DELETED_LINE_REF`. */
const DELETED_REFERENCE_TEXT = "line deleted";

/** A place in a document: a one-based line and a zero-based character offset within it. */
export interface DocumentPosition {
	/** One-based line number. */
	readonly line: number;
	/** Zero-based offset within the line. A position just past a name's last character still counts as on it. */
	readonly character: number;
}

/** A span of one line: a one-based line and zero-based offsets within it, `to` exclusive. */
export interface LineSpan {
	/** One-based line number. */
	readonly line: number;
	/** Zero-based offset of the first character. */
	readonly from: number;
	/** Zero-based offset just past the last character. */
	readonly to: number;
}

/** One place a variable is named in a document. */
export interface VariableReference extends LineSpan {
	/** The name as written, without a `:` sigil or a `global` prefix. */
	readonly name: string;
	/** Whether this is a `global :name`, shared with other documents, rather than this document's own. */
	readonly global: boolean;
	/**
	 * `definition` where the line writes the name (`:tax = 20%`, `tax = 20%`,
	 * `total += 5`, `f(x) = 2x`), `read` anywhere else. A goal seek's unknown
	 * (`solve line 4 for rate = 900`) is a `read`: it names the variable the
	 * seek varies.
	 */
	readonly kind: "definition" | "read";
}

/** A replacement of one span with new text, which a host applies to its document. */
export interface TextEdit extends LineSpan {
	/** The text that replaces the span. */
	readonly text: string;
}

/** What a hover over a variable shows: where its value comes from, and the value. */
export interface VariableHover {
	/** The occurrence under the pointer. */
	readonly reference: VariableReference;
	/**
	 * The definition this occurrence reads: the last one above it, or the
	 * occurrence itself where it is a definition. Null when nothing above
	 * defines the name, which the engine reports as an undefined variable.
	 */
	readonly definition: VariableReference | null;
	/** The defining line's text, or null when there is no definition. */
	readonly definitionText: string | null;
	/**
	 * The defining line's result, taken from the results the host passed. Null
	 * when no results were passed or the line has none. The service does not
	 * evaluate anything itself: a host already has these answers.
	 */
	readonly value: Value | null;
}

/**
 * A document's evaluated results, for a hover to read a value from: the result
 * of `parseDocument`/`evaluateDocument`, or a function from a one-based line
 * number to that line's value.
 */
export type LineResults = ParsingResult | ((line: number) => Value | null | undefined);

/** Why a rename was refused. */
export type RenameRefusalCode =
	| "RENAME_NOT_A_VARIABLE"
	| "RENAME_GLOBAL_NAME"
	| "RENAME_INVALID_NAME"
	| "RENAME_KEYWORD"
	| "RENAME_UNIT_NAME"
	| "RENAME_NAME_TAKEN"
	| "RENAME_CHANGES_MEANING"
	| "RENAME_NO_ENGINE";

/** The edits a rename makes, or the named reason it was refused. */
export type RenameResult =
	| { readonly ok: true; readonly edits: readonly TextEdit[] }
	| { readonly ok: false; readonly code: RenameRefusalCode; readonly message: string };

/**
 * A change to a document's lines, described in whole lines.
 *
 * - `insert`: `count` new lines now stand at `line` to `line + count - 1`; the
 *   line that was at `line` is now at `line + count`.
 * - `delete`: the lines that stood at `line` to `line + count - 1` are gone;
 *   the line that was at `line + count` is now at `line`.
 *
 * Typing a newline at the end of line 3 inserts a line at 4; at the start of
 * line 3 it inserts one at 3. A split or a merge in the middle of a line has no
 * single right answer for which half is "the same line", so the host decides by
 * describing it as one of these.
 */
export interface LineShift {
	/** Whether lines were inserted or deleted. */
	readonly kind: "insert" | "delete";
	/** The first line inserted (numbered in the new document) or deleted (numbered in the old). */
	readonly line: number;
	/** How many lines, at least 1. */
	readonly count: number;
}

/** A reference that pointed into a deleted line, which the shift rewrote as `line deleted`. */
export interface DeletedLineReference extends LineSpan {
	/** The line number it pointed at, in the document before the deletion. */
	readonly target: number;
}

/** The edits that keep `line N` references on their lines, or the named reason the change was refused. */
export type LineShiftResult =
	| {
			readonly ok: true;
			/** Every edit, in document order, none overlapping. */
			readonly edits: readonly TextEdit[];
			/** The references among `edits` that now read `line deleted`, so a host can say so. */
			readonly deleted: readonly DeletedLineReference[];
	  }
	| { readonly ok: false; readonly code: "LINE_SHIFT_OUT_OF_RANGE" | "LINE_SHIFT_NO_ENGINE"; readonly message: string };

/**
 * Apply edits to a document's text and return the new text.
 *
 * The edits are the ones this module returns: against `text` as it stood, not
 * overlapping. They are applied from the last to the first, so no edit moves
 * the text another one points at. An editor applies them as one change set
 * instead, which keeps them as one step in its undo history.
 *
 * @param text - The document the edits were computed against.
 * @param edits - The edits to apply.
 * @returns The document with every edit applied.
 */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
	if (edits.length === 0) return text;
	const lines = text.split(LINE_BREAK);
	const breaks = text.match(LINE_BREAK) ?? [];
	const ordered = [...edits].sort((a, b) => b.line - a.line || b.from - a.from);
	for (const edit of ordered) {
		const index = edit.line - 1;
		const current = lines[index];
		if (current === undefined) continue;
		lines[index] = current.slice(0, edit.from) + edit.text + current.slice(edit.to);
	}
	let out = lines[0];
	for (let i = 1; i < lines.length; i++) out += breaks[i - 1] + lines[i];
	return out;
}

/**
 * A token's part in a line's shape, which a rename compares before and after:
 * a name is a name whether it lexes as a word or a unit, and a rate denominator
 * that may name a variable (`100 / t`, #642) is the slash and the name it is
 * wherever the rename touches it, since a rename only reaches it below the
 * definition (see {@link NameSite.soft}).
 */
function shapeOf(token: Token): string {
	if (token.type === "IDENT" || token.type === "UNIT") return "NAME";
	if (token.type === "PER_UNIT" && token.mayNameVariable === true) return "SLASH NAME";
	return token.type;
}

/**
 * Whether `site`'s name is defined before it: on an earlier line, or in an
 * earlier expression on its own line.
 *
 * @param document - Every line's analysis.
 * @param index - The zero-based line `site` is on.
 * @param site - The name.
 */
function definedBefore(document: readonly LineAnalysis[], index: number, site: NameSite): boolean {
	for (let i = 0; i <= index; i++) {
		for (const s of document[i].names) {
			if (s.key === site.key && s.use === "definition" && (i < index || s.expression < site.expression)) return true;
		}
	}
	return false;
}

/** One name on one line, with the graph's reading of it. */
interface NameSite {
	from: number;
	to: number;
	/** The graph key: the bare name, or `global:name` for a global. */
	key: string;
	name: string;
	global: boolean;
	use: NameUse;
	/** Which expression on the line it belongs to, left to right (inline solves put several on a line). */
	expression: number;
	/**
	 * A rate denominator that reads this name only when it is defined above
	 * (`100 / t`, #642). Below the definition it divides by the variable; above
	 * it, or with no definition, it is the unit, so a rename leaves it alone.
	 */
	soft?: boolean;
}

/** One absolute `line N` on one line. */
interface LineRefSite {
	/** The whole reference, `line` to the last digit. */
	from: number;
	to: number;
	/** The digits alone, which is all a shift rewrites. */
	digitsFrom: number;
	digitsTo: number;
	target: number;
}

/** What one line holds that references and renames care about. */
interface LineAnalysis {
	names: NameSite[];
	/** Units a `1 <name> = <n> <unit>` line defines: their names are taken, but are not variables. */
	units: DocumentUnit[];
	/** The units the note defines above this line, which it was read with. */
	unitsAbove: readonly DocumentUnit[];
	lineRefs: LineRefSite[];
	/** `sum(line A : line B)` and `average(...)`: the two ends shift together. */
	ranges: { start: LineRefSite; end: LineRefSite }[];
	/** Each expression's token structure, which a rename must leave as it was. */
	shapes: string[];
}

/**
 * Reference queries and edits over whole documents, for one engine.
 *
 * The machinery behind {@link LanguageService}'s `findReferences`,
 * `getDefinition`, `getHover`, `rename` and `shiftLineReferences`; a host calls
 * those rather than this. Every method takes the document's full text, reads
 * it the way the engine's batch pass does, and returns positions or edits
 * without evaluating anything or changing the engine.
 */
export class DocumentReferences {
	/** @param engine - The engine whose vocabulary decides what is code: the one the document is evaluated with, or one registered with the same packages. */
	constructor(private readonly engine: ExpressionEngine) {}

	/**
	 * Every place the variable at `position` is named, definitions and reads
	 * alike, in document order. Empty when `position` is not on a variable.
	 */
	findReferences(text: string, position: DocumentPosition): VariableReference[] {
		const document = this.analyseDocument(splitLines(text));
		const at = siteAt(document, position);
		if (at === null) return [];
		const out: VariableReference[] = [];
		document.forEach((analysis, i) => {
			for (const site of analysis.names) if (site.key === at.site.key) out.push(toReference(i + 1, site));
		});
		return out;
	}

	/**
	 * The definition the variable at `position` reads: the last one above it,
	 * or the occurrence itself where it is a definition. Null when `position`
	 * is not on a variable, or nothing above defines it.
	 */
	getDefinition(text: string, position: DocumentPosition): VariableReference | null {
		const document = this.analyseDocument(splitLines(text));
		const at = siteAt(document, position);
		return at === null ? null : definitionOf(document, at.line, at.site);
	}

	/**
	 * The hover for the variable at `position`: the occurrence, its definition,
	 * the defining line's text, and that line's value from `results`. Null when
	 * `position` is not on a variable.
	 */
	getHover(text: string, position: DocumentPosition, results?: LineResults): VariableHover | null {
		const lines = splitLines(text);
		const document = this.analyseDocument(lines);
		const at = siteAt(document, position);
		if (at === null) return null;
		const definition = definitionOf(document, at.line, at.site);
		if (definition === null) {
			return { reference: toReference(at.line, at.site), definition: null, definitionText: null, value: null };
		}
		const definingSite = document[definition.line - 1].names.find((s) => s.from === definition.from)!;
		return {
			reference: toReference(at.line, at.site),
			definition,
			definitionText: lines[definition.line - 1],
			value: valueOf(results, definition.line, definingSite.expression),
		};
	}

	/**
	 * Rename the variable at `position` to `newName`, everywhere it is named and
	 * nowhere else.
	 *
	 * Refused, with a named reason, when `position` is not on a variable, the
	 * variable is a global, `newName` is not a name the engine would read as a
	 * variable (a keyword, a unit, anything that is not one identifier), the
	 * document already uses `newName`, or an edited line would read differently
	 * afterwards. The last is checked by reading each edited line again, so a
	 * rename is only returned when every line it touches keeps its structure.
	 */
	rename(text: string, position: DocumentPosition, newName: string): RenameResult {
		const lines = splitLines(text);
		const document = this.analyseDocument(lines);
		const at = siteAt(document, position);
		if (at === null) {
			return refuse(
				"RENAME_NOT_A_VARIABLE",
				`There is no variable at line ${position.line}, character ${position.character}. A word in prose, a unit, a keyword and a function's parameter are not variables.`,
			);
		}
		const { site } = at;
		if (site.global) {
			return refuse(
				"RENAME_GLOBAL_NAME",
				`"${site.name}" is a global, shared with every document that reads it. Renaming it in one document would leave the others reading a name that no longer exists.`,
			);
		}
		if (newName === site.name) return { ok: true, edits: [] };

		const invalid = this.checkName(newName);
		if (invalid !== null) return invalid;

		for (let i = 0; i < document.length; i++) {
			const analysis = document[i];
			const clash =
				analysis.names.some((s) => !s.global && s.key === newName) ||
				analysis.units.some((u) => u.nameWords.includes(newName));
			if (clash) {
				return refuse(
					"RENAME_NAME_TAKEN",
					`"${newName}" is already used on line ${i + 1}. Renaming "${site.name}" to it would make two different things one.`,
				);
			}
		}

		const edits: TextEdit[] = [];
		document.forEach((analysis, i) => {
			for (const s of analysis.names) {
				if (s.key !== site.key) continue;
				// `100 / t` names the variable only below its definition.
				if (s.soft === true && !definedBefore(document, i, s)) continue;
				edits.push({ line: i + 1, from: s.from, to: s.to, text: newName });
			}
		});

		const changed = this.firstLineReadDifferently(lines, document, edits, site.key, newName);
		if (changed !== null) {
			return refuse(
				"RENAME_CHANGES_MEANING",
				`Renaming "${site.name}" to "${newName}" would change how line ${changed} reads, so the name is left as it is.`,
			);
		}
		return { ok: true, edits };
	}

	/**
	 * The edits that keep every absolute `line N` reference on the line it
	 * meant after `change`, the way a spreadsheet keeps a cell reference on its
	 * row when a row is inserted above it.
	 *
	 * `text` is the document after the change. Its references still carry the
	 * numbers they were written with, and these edits bring them up to date:
	 *
	 * - A reference to a line that moved is renumbered to where it now stands.
	 * - A reference into a deleted line becomes `line deleted`, which answers
	 *   with a named error rather than silently reading whichever line moved up
	 *   into its place. It is also listed in `deleted`.
	 * - A range's ends move independently, as a spreadsheet range's do: a line
	 *   inserted inside a range is inside it afterwards, a range loses the lines
	 *   deleted from it, and only a range with none of its lines left becomes
	 *   `line deleted` at both ends.
	 * - The inserted lines themselves are left as written: they were written
	 *   against the document as it now stands.
	 *
	 * Refused when the change does not fit the document.
	 */
	shiftLineReferences(text: string, change: LineShift): LineShiftResult {
		const lines = splitLines(text);
		const { kind, line, count } = change;
		const fits =
			Number.isInteger(line) &&
			Number.isInteger(count) &&
			line >= 1 &&
			count >= 1 &&
			(kind === "insert" ? line + count - 1 <= lines.length : line <= lines.length + 1);
		if (!fits) {
			return {
				ok: false,
				code: "LINE_SHIFT_OUT_OF_RANGE",
				message:
					kind === "insert"
						? `Inserting ${count} line(s) at line ${line} does not fit a document of ${lines.length} line(s): the inserted lines must be in the text passed.`
						: `Deleting ${count} line(s) at line ${line} does not fit a document of ${lines.length} line(s) after the deletion.`,
			};
		}

		// Where an old line number stands now, or null when it was deleted.
		const moved = (target: number): number | null => {
			if (target < line) return target;
			if (kind === "insert") return target + count;
			return target >= line + count ? target - count : null;
		};

		const edits: TextEdit[] = [];
		const deleted: DeletedLineReference[] = [];
		const renumber = (lineNumber: number, site: LineRefSite, to: number): void => {
			if (to !== site.target) edits.push({ line: lineNumber, from: site.digitsFrom, to: site.digitsTo, text: String(to) });
		};
		const markDeleted = (lineNumber: number, site: LineRefSite): void => {
			edits.push({ line: lineNumber, from: site.from, to: site.to, text: DELETED_REFERENCE_TEXT });
			deleted.push({ line: lineNumber, from: site.from, to: site.to, target: site.target });
		};

		const document = this.analyseDocument(lines);
		for (let n = 1; n <= lines.length; n++) {
			if (kind === "insert" && n >= line && n < line + count) continue;
			const analysis = document[n - 1];
			for (const site of analysis.lineRefs) {
				const to = moved(site.target);
				if (to === null) markDeleted(n, site);
				else renumber(n, site, to);
			}
			for (const range of analysis.ranges) {
				const ascending = range.start.target <= range.end.target;
				const lo = ascending ? range.start.target : range.end.target;
				const hi = ascending ? range.end.target : range.start.target;
				// Each end keeps its own line; an end whose line was deleted moves
				// inward to the nearest line of the range that survived.
				const newLo = moved(lo) ?? line;
				const newHi = moved(hi) ?? line - 1;
				if (newLo > newHi) {
					markDeleted(n, range.start);
					markDeleted(n, range.end);
					continue;
				}
				renumber(n, range.start, ascending ? newLo : newHi);
				renumber(n, range.end, ascending ? newHi : newLo);
			}
		}

		edits.sort((a, b) => a.line - b.line || a.from - b.from);
		deleted.sort((a, b) => a.line - b.line || a.from - b.from);
		return { ok: true, edits, deleted };
	}

	/**
	 * Whether `newName` is a name the engine reads as a variable on its own:
	 * one identifier, not a keyword, not a unit, and not a word a normaliser
	 * rule reads as syntax (`line3` is a line reference).
	 */
	private checkName(newName: string): RenameResult | null {
		const invalid = refuse(
			"RENAME_INVALID_NAME",
			`"${newName}" is not a valid name. A name is a letter or underscore followed by letters, digits or underscores.`,
		);
		if (newName.length === 0 || /\s/.test(newName)) return invalid;
		let raw: Token[];
		try {
			raw = this.engine.getLexer().getHighlightTokenObjects(newName);
		} catch {
			return invalid;
		}
		if (raw.length !== 1 || raw[0].offset !== 0 || raw[0].text !== newName) return invalid;
		const token = raw[0];
		if (token.type === "UNIT") {
			return refuse(
				"RENAME_UNIT_NAME",
				`"${newName}" is a unit, so a line reading it would read the unit rather than the variable.`,
			);
		}
		if (token.type !== "IDENT") {
			return /^[A-Za-z_]/.test(newName)
				? refuse("RENAME_KEYWORD", `"${newName}" is a keyword, so it cannot name a variable.`)
				: invalid;
		}
		const normalised = this.engine.getNormalizer().normalize(raw);
		if (normalised.length !== 1 || normalised[0].type !== "IDENT") {
			return refuse("RENAME_KEYWORD", `"${newName}" is read as syntax rather than as a name, so it cannot name a variable.`);
		}
		return null;
	}

	/**
	 * The first edited line that reads differently once `edits` are applied, or
	 * null when every one keeps its structure: the same expressions, the same
	 * token shapes, and the same names at the same places, with `key` now
	 * `newName`. A normaliser rule that fuses the new name with a neighbour
	 * (`f(3)` renamed to `sum(3)` is a different call) is caught here.
	 */
	private firstLineReadDifferently(
		lines: string[],
		document: LineAnalysis[],
		edits: TextEdit[],
		key: string,
		newName: string,
	): number | null {
		const byLine = new Map<number, TextEdit[]>();
		for (const edit of edits) {
			const list = byLine.get(edit.line);
			if (list === undefined) byLine.set(edit.line, [edit]);
			else list.push(edit);
		}
		for (const [lineNumber, lineEdits] of byLine) {
			const before = document[lineNumber - 1];
			const after = this.analyseLine(applyToLine(lines[lineNumber - 1], lineEdits), before.unitsAbove);
			// Where an offset in the old line lands in the new one.
			const shift = (offset: number): number => {
				let delta = 0;
				for (const e of lineEdits) if (e.to <= offset) delta += e.text.length - (e.to - e.from);
				return offset + delta;
			};
			const same =
				before.shapes.length === after.shapes.length &&
				before.shapes.every((shape, i) => shape === after.shapes[i]) &&
				before.names.length === after.names.length &&
				before.names.every((s, i) => {
					const t = after.names[i];
					return (
						t.from === shift(s.from) &&
						t.key === (s.key === key ? newName : s.key) &&
						t.use === s.use &&
						t.expression === s.expression
					);
				}) &&
				before.lineRefs.length === after.lineRefs.length &&
				before.lineRefs.every((s, i) => s.target === after.lineRefs[i].target) &&
				before.ranges.length === after.ranges.length;
			if (!same) return lineNumber;
		}
		return null;
	}

	/**
	 * Analyse every line of a document, top to bottom, each with the units the
	 * lines above it define, the order a document pass defines them in. The
	 * engine's own unit table is only borrowed for each read (see
	 * `UserUnitTable.withUnits`), so a note's `3 sprints` reads as a quantity
	 * whether or not the engine has evaluated the note.
	 */
	private analyseDocument(lines: string[]): LineAnalysis[] {
		// Replaced rather than grown, so lines between two definitions share one
		// array and the common note, with no units, shares the empty one.
		let unitsAbove: readonly DocumentUnit[] = [];
		return lines.map((line) => {
			const analysis = this.analyseLine(line, unitsAbove);
			if (analysis.units.length > 0) unitsAbove = [...unitsAbove, ...analysis.units];
			return analysis;
		});
	}

	/**
	 * What one line holds, read the way the batch document pass reads it: a
	 * skipped line (a heading, a blockquote, a fence) holds nothing, a line
	 * with inline solves holds one expression per solve, and any other line is
	 * one expression past its list marker.
	 *
	 * @param text - The line.
	 * @param unitsAbove - The units the note defines above it.
	 */
	private analyseLine(text: string, unitsAbove: readonly DocumentUnit[]): LineAnalysis {
		const out: LineAnalysis = { names: [], units: [], unitsAbove, lineRefs: [], ranges: [], shapes: [] };
		const lexer = this.engine.getLexer();
		const classification = lexer.classifyLine(text);
		if (classification.skip) return out;
		// A line opening with `:` is a definition even when it holds backticks,
		// the same exception the batch pass makes.
		if (classification.hasInlineSolve && !text.trim().startsWith(":")) {
			lexer.findInlineSolves(text).forEach((span, i) => {
				// `s` and the opening backtick precede the expression.
				this.analyseExpression(span.expression, span.start + 2, i, out);
			});
			return out;
		}
		const contentStart = classification.contentOffset ?? 0;
		const evaluable = text.slice(contentStart);
		const expression = evaluable.trim();
		if (expression.length > 0) {
			this.analyseExpression(expression, contentStart + (evaluable.length - evaluable.trimStart().length), 0, out);
		}
		return out;
	}

	/**
	 * Add one expression's names and line references to `out`.
	 *
	 * @param expression - The expression text the engine evaluates.
	 * @param base - Where it starts on its line.
	 * @param index - Which expression on the line it is.
	 */
	private analyseExpression(expression: string, base: number, index: number, out: LineAnalysis): void {
		const read = this.engine.readExpressionTokens(expression, out.unitsAbove);
		if (read === null) return;
		const tokens = read.tokens.slice(read.start);
		out.shapes.push(`${read.start}|${tokens.map(shapeOf).join(" ")}`);

		if (read.unit !== null) {
			// `1 sprint = 2 weeks`: the words before `=` name a unit, which a
			// later line spells differently (`3 sprints`), so they are neither
			// variables nor renameable, only taken; and the lines below read
			// with it defined.
			out.units.push(read.unit);
		} else {
			extractReadsAndWrites(tokens, (i, key, use) => {
				const token = tokens[i];
				// A rate denominator that may name a variable (`100 / t`, #642)
				// is fused with its slash, so the name is the end of its span.
				const at = token.type === "PER_UNIT" && token.sourceEnd !== undefined ? token.sourceEnd - token.text.length : token.offset;
				// Only a name the reader wrote, at the place it was written. A
				// token a rule rewrote or inserted has no text of its own here.
				if (token.value !== token.text || !expression.startsWith(token.text, at)) return;
				out.names.push({
					from: base + at,
					to: base + at + token.text.length,
					key,
					name: token.value,
					global: key !== token.value,
					use,
					expression: index,
					...(token.type === "PER_UNIT" ? { soft: true } : {}),
				});
			});
		}

		for (let i = 0; i < tokens.length; i++) {
			if (!LINE_NUMBER_TOKENS.has(tokens[i].type)) continue;
			const site = lineRefSite(expression, tokens[i], base);
			const opensRange =
				tokens[i - 1]?.type === "LPAREN" &&
				(tokens[i - 2]?.type === "SUM_RANGE_CALL" || tokens[i - 2]?.type === "AVERAGE_RANGE_CALL") &&
				tokens[i + 1]?.type === "COLON" &&
				tokens[i + 2]?.type === "LINE_REF";
			if (opensRange) {
				const end = lineRefSite(expression, tokens[i + 2], base);
				if (site !== null && end !== null) out.ranges.push({ start: site, end });
				else if (site !== null) out.lineRefs.push(site);
				else if (end !== null) out.lineRefs.push(end);
				i += 2;
				continue;
			}
			if (site !== null) out.lineRefs.push(site);
		}
	}
}

/** Split a document into lines the way the batch scan does. */
function splitLines(text: string): string[] {
	return text.split(LINE_BREAK);
}

/**
 * The numbered reference a `LINE_REF` token was fused from, or null for
 * `line deleted` (which has no number to shift) and anything whose source text
 * is not the `line N` it claims to be.
 */
function lineRefSite(expression: string, token: Token, base: number): LineRefSite | null {
	const match = /^line(\s*)(\d+)/i.exec(expression.slice(token.offset));
	if (match === null || parseInt(match[2], 10) !== parseInt(token.value, 10)) return null;
	const digitsFrom = token.offset + 4 + match[1].length;
	return {
		from: base + token.offset,
		to: base + token.offset + match[0].length,
		digitsFrom: base + digitsFrom,
		digitsTo: base + digitsFrom + match[2].length,
		target: parseInt(match[2], 10),
	};
}

/** The name at `position`, or null when there is none. */
function siteAt(document: LineAnalysis[], position: DocumentPosition): { line: number; site: NameSite } | null {
	const analysis = document[position.line - 1];
	if (analysis === undefined) return null;
	const ch = position.character;
	const inside = analysis.names.find((s) => s.from <= ch && ch < s.to);
	const site = inside ?? analysis.names.find((s) => s.to === ch);
	return site === undefined ? null : { line: position.line, site };
}

/**
 * The definition the name at (`line`, `site`) reads: the site itself when it
 * defines the name, otherwise the last definition before it, where an earlier
 * expression on the same line counts and its own expression does not (the
 * right-hand side of `:x = x + 1` reads the `x` defined above).
 */
function definitionOf(document: LineAnalysis[], line: number, site: NameSite): VariableReference | null {
	if (site.use === "definition") return toReference(line, site);
	for (let n = line; n >= 1; n--) {
		const names = document[n - 1].names;
		for (let i = names.length - 1; i >= 0; i--) {
			const s = names[i];
			if (s.key !== site.key || s.use !== "definition") continue;
			if (n === line && s.expression >= site.expression) continue;
			return toReference(n, s);
		}
	}
	return null;
}

/** The public view of a name site. */
function toReference(line: number, site: NameSite): VariableReference {
	return {
		line,
		from: site.from,
		to: site.to,
		name: site.name,
		global: site.global,
		kind: site.use === "definition" ? "definition" : "read",
	};
}

/** A line's value from a host's results, or null. */
function valueOf(results: LineResults | undefined, line: number, expression: number): Value | null {
	if (results === undefined) return null;
	if (typeof results === "function") return results(line) ?? null;
	const parsed = results.lines[line - 1];
	if (parsed === undefined) return null;
	if (parsed.hasInlineSolves) return parsed.inlineSolves[expression]?.result ?? null;
	return parsed.result ?? null;
}

/** Apply one line's edits to its text, last first. */
function applyToLine(text: string, edits: readonly TextEdit[]): string {
	let out = text;
	for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
		out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
	}
	return out;
}

/** A refused rename. */
function refuse(code: RenameRefusalCode, message: string): RenameResult {
	return { ok: false, code, message };
}
