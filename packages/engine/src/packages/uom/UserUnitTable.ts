/**
 * Document-scoped user-defined units.
 *
 * A line like `1 sprint = 2 weeks` defines `sprint` as a dimensioned alias for
 * two weeks. Later lines resolve `6 sprints in days` by expanding the name back
 * to its definition, `6 * 2 weeks`, so every downstream feature (arithmetic,
 * `in`/`to` conversion, best-unit) reuses the built-in unit machinery unchanged.
 * Because the base is always a real built-in unit, a defined unit carries that
 * unit's dimension: `6 sprints in days` converts, and `6 sprints in kg` reports
 * incompatible units exactly as `weeks in kg` does.
 *
 * Scope is the document, not the process: the table lives on the engine and is
 * cleared at the start of each `parseDocument` pass, so definitions never leak
 * between documents and a renamed unit does not linger. This mirrors how a
 * user-defined function is scoped to the VM that parsed it.
 *
 * Names are matched case-sensitively (the whole unit system is, `C` is Celsius
 * and `c` is a cup) with a naive trailing-`s` plural, so `sprint` and `sprints`
 * resolve to the same definition and `story point` and `story points` likewise.
 */

/** A resolved user-unit definition: `<ratio> <baseUnit>` per one of the unit. */
export interface UserUnitDefinition {
  /** The name as first written, for the `<name> defined` confirmation. */
  readonly displayName: string;
  /**
   * The multiplier, kept as the exact source text the lexer produced rather
   * than a parsed number, so re-emitting it into the token stream stays
   * locale-correct (a comma-decimal locale lexes `2,5`, and that is what must
   * be re-emitted).
   */
  readonly ratioText: string;
  /** The built-in unit the ratio is expressed in (e.g. `weeks`, `hours`). */
  readonly baseUnit: string;
  /**
   * The persistent id of the line that defined it, or -1 where there was none.
   *
   * A definition belongs to a line, and the line can be deleted or edited into
   * something else. Without knowing which line said it, the unit outlived the
   * document: `1 sprint = 2 weeks` deleted, and `3 sprints in weeks` went on
   * answering `6 weeks` for the rest of the session.
   *
   * The id and not the position, because positions move. Deleting a line above
   * the definition renumbers it, and a removal keyed on where it used to sit
   * then matches nothing: the unit survived a delete that had shifted it, which
   * is exactly the case the first version of this missed.
   */
  readonly definedByLineId: number;
}

/**
 * De-pluralized, space-joined lookup key for a unit name given as words.
 *
 * Only the final word loses a trailing `s`, so `story points` keys the same as
 * `story point`. Applied identically at definition and lookup, so a name whose
 * singular already ends in `s` still matches itself.
 */
function pluralInsensitiveKey(words: readonly string[]): string {
  const last = words[words.length - 1];
  const singular = last.length > 1 && last.endsWith("s") ? last.slice(0, -1) : last;
  return [...words.slice(0, -1), singular].join(" ");
}

/** A registered name matched against a run of identifier tokens. */
export interface UserUnitMatch {
  /** The definition to expand to. */
  readonly definition: UserUnitDefinition;
  /** How many identifier words the name consumed (`story point` is 2). */
  readonly wordCount: number;
}

/** Per-engine, document-scoped store of user-defined units. */
export class UserUnitTable {
  private readonly byKey = new Map<string, UserUnitDefinition>();
  private longestName = 0;

  /** Whether any unit has been defined, a cheap guard for the hot path. */
  get isEmpty(): boolean {
    return this.byKey.size === 0;
  }

  /** The most words any registered name spans, bounding the lookup scan. */
  get maxWordCount(): number {
    return this.longestName;
  }

  /**
   * Register (or replace) a unit named by `nameWords`, defined as `ratioText`
   * of `baseUnit`. Re-defining a name overwrites the earlier definition, so a
   * corrected line wins over the one above it.
   */
  define(nameWords: readonly string[], ratioText: string, baseUnit: string, definedByLineId = -1): boolean {
    const key = pluralInsensitiveKey(nameWords);
    const previous = this.byKey.get(key);
    const changed = previous === undefined || previous.ratioText !== ratioText || previous.baseUnit !== baseUnit;
    this.byKey.set(key, {
      displayName: nameWords.join(" "),
      ratioText,
      baseUnit,
      definedByLineId,
    });
    if (nameWords.length > this.longestName) this.longestName = nameWords.length;
    return changed;
  }

  /**
   * Longest registered name that a run of identifier `words` begins with, or
   * `null` if none. `words` is the consecutive identifiers following a value,
   * so `story points each` matches the 2-word `story point` and leaves `each`.
   */
  match(words: readonly string[]): UserUnitMatch | null {
    const upper = Math.min(words.length, this.longestName);
    for (let length = upper; length >= 1; length--) {
      const definition = this.byKey.get(pluralInsensitiveKey(words.slice(0, length)));
      if (definition !== undefined) return { definition, wordCount: length };
    }
    return null;
  }

  /** Drop every definition, called when a fresh document pass begins. */
  /**
   * Drop every definition made by `lineNumber`.
   *
   * Called before a line is compiled again, so a line that has stopped being a
   * definition stops defining: if it still says the same thing, compiling it
   * puts the unit straight back.
   *
   * `longestName` is left where it is. It only bounds a lookup scan, so a value
   * that is too large costs a slightly wider scan and never a wrong answer,
   * where recomputing it would cost a walk of the table on every recompile.
   *
   * @param lineId - The persistent id of the line whose definitions go.
   * @returns Whether anything was removed.
   */
  undefineFrom(lineId: number): boolean {
    if (lineId < 0) return false;
    let removed = false;
    for (const [key, definition] of this.byKey) {
      if (definition.definedByLineId !== lineId) continue;
      this.byKey.delete(key);
      removed = true;
    }
    return removed;
  }

  /** Every registered name, for telling whether a pass removed one. */
  get names(): string[] {
    return [...this.byKey.keys()];
  }

  clear(): void {
    this.byKey.clear();
    this.longestName = 0;
  }
}
