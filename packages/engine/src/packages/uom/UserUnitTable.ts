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
  define(nameWords: readonly string[], ratioText: string, baseUnit: string): void {
    const key = pluralInsensitiveKey(nameWords);
    this.byKey.set(key, {
      displayName: nameWords.join(" "),
      ratioText,
      baseUnit,
    });
    if (nameWords.length > this.longestName) this.longestName = nameWords.length;
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
  clear(): void {
    this.byKey.clear();
    this.longestName = 0;
  }
}
