import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { UserUnitTable } from "@solve-js/packages/uom/UserUnitTable";
import type { UnitAliasTable } from "@solve-js/packages/uom/UnitAliasTable";

/**
 * The token that names the quantity before it for display (#762): its value is
 * the name the reader wrote, its text the number of the unit one of that name
 * is, written as a plain JavaScript number. The unit-label parselet turns it
 * into the builtin that sets `Value.unitLabel`.
 *
 * @param name - The name as written (`Meile`, `sprints`).
 * @param per - How many of the unit one of `name` is.
 * @param after - The token it follows, whose position it takes.
 */
export function unitLabelToken(name: string, per: number, after: Token): Token {
  const end = after.sourceEnd ?? after.offset + after.text.length;
  return new LexerToken("UNIT_LABEL", tokenTypeId("UNIT_LABEL"), name, String(per), end, 0, after.line, after.col);
}

/**
 * A UNIT token for `unit` standing where the reader wrote `words`, so an editor
 * painting the normalised line highlights the words as the unit they mean.
 */
function unitTokenFor(unit: string, words: readonly Token[]): Token {
  const first = words[0];
  const last = words[words.length - 1];
  const token = new LexerToken("UNIT", tokenTypeId("UNIT"), unit, unit, first.offset, 0, first.line, first.col);
  token.sourceEnd = (last.sourceEnd ?? last.offset + last.text.length);
  return token;
}

/** Whether `token` opens a conversion target (`in`, `to`, `into`). */
function isConversionWord(token: Token | undefined): boolean {
  return token !== undefined && (token.type === "IN" || token.type === "TO");
}

/**
 * Expands a document-defined unit back to its definition so the built-in unit
 * machinery handles it: `6 sprints` becomes `6 * 2 weeks` once `1 sprint = 2
 * weeks` is in scope. The multiplication is what carries the dimension, so
 * `6 sprints in days` converts and `6 sprints in kg` reports incompatible units.
 *
 * Bound to the engine's own {@link UserUnitTable}, which is why it is wired in
 * ExpressionEngine rather than shipped in the shared UOM package descriptor: the
 * table is per-document state, and a package descriptor is shared across every
 * engine in the process. Reading the table is side-effect-free, so this stays a
 * pure normalizer rule (the registration side of the feature happens in the
 * engine's own definition-line handling, not here).
 *
 * Deliberately narrow, so a made-up unit name cannot shadow ordinary prose:
 *
 * - It fires only after a value (a NUMBER, or a closing paren), the way a unit
 *   always attaches to a quantity. A bare `sprint` on its own is left as an
 *   identifier, so a word that happens to match a definition is not rewritten
 *   mid-sentence.
 * - It declines when the name is immediately followed by `=`, which is the
 *   left side of a (re)definition, not a use.
 *
 * Runs above implicit multiply, so a matched name is expanded whole here rather
 * than first split into `value * name` with the name stranded as a variable.
 *
 * A name is also a conversion target (#762): `84 days in sprints` converts into
 * the definition's base unit and is shown counted in the name, `= 6 sprints`,
 * through a unit label (see {@link unitLabelToken}). A definition whose ratio is
 * 1 (`1 Tage = 1 day`) is a rename, and a quantity written in it is shown under
 * the name too, `= 3 Tage`; any other ratio expands as before, so `6 sprints`
 * is `= 12 weeks`.
 *
 * @param table - The engine's document units.
 * @param priority - Where the rule sits among the others.
 * @param readRatio - Reads a definition's ratio text as a number, in the
 *   engine's locale (`2,5` under `de` is two and a half).
 */
export function userUnitExpansionRule(table: UserUnitTable, priority = 82, readRatio: (text: string) => number = Number): NormalizerRule {
  return {
    name: "uom:user-unit",
    priority,
    // Derived from this rule's own opening guards; see RuleSlot on why an
    // over-broad slot is safe and an over-narrow one is not.
    shape: [{ types: ["NUMBER", "RPAREN", "IN", "TO"] }, { types: ["IDENT"] }],
    match(tokens: Token[], pos: number): NormalizerMatch | null {
      // Nothing is defined on most lines, so bail before any scanning.
      if (table.isEmpty) return null;

      const value = tokens[pos];
      if (isConversionWord(value)) return userUnitTarget(table, tokens, pos, readRatio);
      // A user unit attaches to a preceding value, exactly like a built-in one.
      if (value.type !== "NUMBER" && value.type !== "RPAREN") return null;

      // Gather the run of identifiers that could spell a multi-word name,
      // capped at the longest name actually registered.
      const words: string[] = [];
      const maxWords = table.maxWordCount;
      for (let i = pos + 1; i < tokens.length && words.length < maxWords; i++) {
        if (tokens[i].type !== "IDENT") break;
        words.push(tokens[i].value);
      }
      if (words.length === 0) return null;

      const matched = table.match(words);
      if (matched === null) return null;

      // `1 sprint = ...` is a definition's left side, not a use of `sprint`.
      const after = tokens[pos + 1 + matched.wordCount];
      if (after?.type === "EQUALS") return null;

      const { ratioText, baseUnit } = matched.definition;
      // A rename is a quantity in the base unit shown under the typed name.
      if (readRatio(ratioText) === 1) {
        const written = tokens.slice(pos + 1, pos + 1 + matched.wordCount);
        const unitToken = unitTokenFor(baseUnit, written);
        return {
          consumed: 1 + matched.wordCount,
          replacement: [value, unitToken, unitLabelToken(written.map((t) => t.value).join(" "), 1, unitToken)],
          ruleName: "uom:user-unit",
        };
      }
      const star = new LexerToken("STAR", tokenTypeId("STAR"), "*", "*", value.offset, 0, value.line, value.col);
      const ratio = new LexerToken("NUMBER", tokenTypeId("NUMBER"), ratioText, ratioText, value.offset, 0, value.line, value.col);
      const unit = new LexerToken("UNIT", tokenTypeId("UNIT"), baseUnit, baseUnit, value.offset, 0, value.line, value.col);

      return {
        consumed: 1 + matched.wordCount,
        replacement: [value, star, ratio, unit],
        ruleName: "uom:user-unit",
      };
    },
  };
}

/**
 * `in <name>` or `to <name>` for a document-defined unit: the conversion into
 * the definition's base unit, labelled with the name as written. Only after
 * something to convert, so a line that opens with `in` is left alone.
 */
function userUnitTarget(table: UserUnitTable, tokens: Token[], pos: number, readRatio: (text: string) => number): NormalizerMatch | null {
  if (pos === 0) return null;
  const words: string[] = [];
  for (let i = pos + 1; i < tokens.length && words.length < table.maxWordCount; i++) {
    if (tokens[i].type !== "IDENT") break;
    words.push(tokens[i].value);
  }
  if (words.length === 0) return null;
  const matched = table.match(words);
  if (matched === null) return null;
  const per = readRatio(matched.definition.ratioText);
  // A ratio no count could be shown in (zero, a negative, not a number) is
  // left for the target to refuse as the word it is.
  if (!Number.isFinite(per) || per <= 0) return null;
  const written = tokens.slice(pos + 1, pos + 1 + matched.wordCount);
  const unitToken = unitTokenFor(matched.definition.baseUnit, written);
  return {
    consumed: 1 + matched.wordCount,
    replacement: [tokens[pos], unitToken, unitLabelToken(written.map((t) => t.value).join(" "), per, unitToken)],
    ruleName: "uom:user-unit",
  };
}

/**
 * Reads a package's unit aliases (`IEnginePackage.unitAliases`, #762): a word
 * a package declared for a unit the engine already has, `Meile` for the mile.
 *
 * The same two places a document's unit is read, and no others: after a value
 * (`2 Meile`) and as the target of `in`, `into` or `to` (`5 km in Meile`). A
 * bare `Meile` in prose is left as the word it is. Either way the quantity is in
 * the aliased unit, so it converts and adds as that unit does, and it is shown
 * under the word the reader wrote (`= 3.11 Meile`), through a unit label.
 *
 * Below the document's own units, so a word the document defines means what
 * the document says, and above implicit multiply, so `2 Meile` is not read as
 * two times a variable.
 *
 * @param table - The engine's aliases, filled by `registerPackage`.
 * @param priority - Where the rule sits among the others.
 */
export function unitAliasRule(table: UnitAliasTable, priority = 81): NormalizerRule {
  return {
    name: "uom:unit-alias",
    priority,
    shape: [{ types: ["NUMBER", "RPAREN", "IN", "TO"] }, { types: ["IDENT"] }],
    match(tokens: Token[], pos: number): NormalizerMatch | null {
      if (table.isEmpty) return null;
      const first = tokens[pos];
      const word = tokens[pos + 1];
      if (word === undefined || word.type !== "IDENT") return null;
      const conversion = isConversionWord(first);
      if (!conversion && first.type !== "NUMBER" && first.type !== "RPAREN") return null;
      if (conversion && pos === 0) return null;
      const unit = table.unitFor(word.value);
      if (unit === undefined) return null;
      // `2 Meile = ...` is not a use of the alias.
      if (!conversion && tokens[pos + 2]?.type === "EQUALS") return null;
      const unitToken = unitTokenFor(unit, [word]);
      return {
        consumed: 2,
        replacement: [first, unitToken, unitLabelToken(word.value, 1, unitToken)],
        ruleName: "uom:unit-alias",
      };
    },
  };
}
