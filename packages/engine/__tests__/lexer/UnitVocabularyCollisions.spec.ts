/**
 * Automated detection of unit spellings that collide with something else in
 * the language.
 *
 * The vocabulary is derived from the conversion tables, so a table upgrade can
 * introduce a word that some other part of the engine already owns. That
 * happened during the widening: `pm` is picometres, and admitting it made
 * `4pm` four picometres and broke every clock time in the suite. Finding it by
 * running the whole suite and reading twenty failures backwards is not a
 * process. These gates find it directly and name the word.
 *
 * Four independent gates, because the collisions come in four shapes:
 *
 * 1. STRUCTURAL, a unit that is also a declared keyword or phrase. Cheap to
 *    check, catches `in` and `dec`.
 * 2. BEHAVIOURAL, a unit that something else consumes at lex time even though
 *    it is declared nowhere. This is the one that catches `pm` and `am`, which
 *    are claimed by a normalizer rule rather than by any table.
 * 3. IDENTIFIER SHADOWING, a unit short enough to collide with the placeholder
 *    names people write. Catches `y` in `x.y` and `c`.
 * 4. ORDINARY ENGLISH, a unit spelling common enough that prose containing a
 *    number starts evaluating. Catches `are`, `turn`, `point`, `grade`.
 *
 * Every gate reports the offending words, so the fix is to add an exclusion
 * with a reason, not to go hunting.
 */

import { describe, expect, test } from "@jest/globals";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { knownUnits, excludedUnitSpellings } from "@solve-js/lexer/units";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";
import { EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { enLocale } from "@solve-js/constants/locales/en";

/** Only the units that come from the conversion table, which is what the gates govern. */
const ADMITTED_BASE_UNITS = [...knownUnits].filter((unit) => unit in UNIT_TABLE);

function tokenTypes(input: string): string[] {
  const lexer = new ExpressionLexer();
  lexer.reset(input);
  return lexer.tokenizeAll().map((token) => token.type);
}

describe("gate 1: no unit is also a declared keyword or phrase", () => {
  /**
   * Collisions that are known and accepted, with the reason.
   *
   * `min` is both the `min()` builtin and the minute. It predates all of this
   * and works, because the lexer resolves it by context: UNIT after a number,
   * FUNC before a parenthesis. Listed rather than silently filtered so the
   * next person to see it knows it was considered, and paired with the test
   * below so the context-sensitivity cannot quietly regress.
   */
  const ACCEPTED_KEYWORD_COLLISIONS = new Set(["min"]);

  test("locale keywords", () => {
    const keywords = new Set(Object.keys(enLocale.keywordMap));
    const collisions = ADMITTED_BASE_UNITS.filter(
      (unit) => keywords.has(unit) && !ACCEPTED_KEYWORD_COLLISIONS.has(unit)
    );
    expect(collisions).toEqual([]);
  });

  test("the accepted collisions really do still work", () => {
    expect(tokenTypes("5 min")).toEqual(["NUMBER", "UNIT"]);
    expect(tokenTypes("min(1, 2)")).toEqual(["FUNC", "LPAREN", "NUMBER", "COMMA", "NUMBER", "RPAREN"]);
  });

  test("single-word package phrases", () => {
    // A multi-word phrase cannot collide with a unit token, but a package is
    // free to register a one-word phrase, and that would win over the unit.
    const phraseWords = new Set<string>();
    for (const enginePackage of BUILTIN_PACKAGES) {
      for (const phrase of Object.keys(enginePackage.phrases ?? {})) {
        if (!phrase.includes(" ")) phraseWords.add(phrase);
      }
    }
    const collisions = ADMITTED_BASE_UNITS.filter((unit) => phraseWords.has(unit));
    expect(collisions).toEqual([]);
  });
});

describe("gate 2: every admitted unit actually lexes as a unit", () => {
  test("in a bare numeric context", () => {
    // The gate that would have caught `pm` on its own. A unit some other rule
    // consumes at lex time never reaches the UNIT branch, so the pair
    // NUMBER + UNIT is the whole assertion.
    const stolen: string[] = [];
    for (const unit of ADMITTED_BASE_UNITS) {
      const types = tokenTypes(`1 ${unit}`);
      if (types[0] !== "NUMBER" || types[1] !== "UNIT" || types.length !== 2) {
        stolen.push(`${unit} lexed as [${types.join(", ")}]`);
      }
    }
    expect(stolen).toEqual([]);
  });

  test("with no space, which is how people write them", () => {
    // `4pm` is the shape that broke. A unit glued to its number must still be
    // NUMBER + UNIT and nothing else.
    //
    // Units beginning with `n` are exempt: `4n` is BigInt literal syntax, so
    // `4nm` is the BigInt 4 followed by `m`, and that is the number lexer
    // doing its job rather than a unit collision. Writing `4 nm` with a space
    // works, which the previous test covers for every unit.
    const stolen: string[] = [];
    const exempt: string[] = [];
    for (const unit of ADMITTED_BASE_UNITS) {
      if (/^n/.test(unit)) {
        exempt.push(unit);
        continue;
      }
      const types = tokenTypes(`4${unit}`);
      if (types[0] !== "NUMBER" || types[1] !== "UNIT" || types.length !== 2) {
        stolen.push(`4${unit} lexed as [${types.join(", ")}]`);
      }
    }
    expect(stolen).toEqual([]);
    // Sanity: the exemption is a handful of nano- units, not most of the table.
    expect(exempt.length).toBeLessThan(ADMITTED_BASE_UNITS.length / 10);
  });

  test("the BigInt exemption is real, not a cover for a unit collision", () => {
    expect(tokenTypes("4nm")).toEqual(["BIGINT", "UNIT"]);
    expect(tokenTypes("4 nm")).toEqual(["NUMBER", "UNIT"]);
  });

  test("the gate is not vacuous: a known-stolen spelling is detected", () => {
    // `pm` is excluded, so it is not in ADMITTED_BASE_UNITS. Prove the gate
    // above would have caught it if it were.
    expect(excludedUnitSpellings.has("pm")).toBe(true);
    expect("pm" in UNIT_TABLE).toBe(true);
    const types = tokenTypes("4pm");
    expect(types).not.toEqual(["NUMBER", "UNIT"]);
  });
});

describe("gate 3: units do not shadow placeholder identifiers", () => {
  /**
   * The letters and short names that turn up as variables, in this repo's own
   * tests and in real documents. A unit claiming one of these makes `x.y`
   * parse as a unit expression.
   */
  const PLACEHOLDER_NAMES = [
    "x", "y", "z", "n", "i", "j", "k", "v", "w", "u", "p", "q", "r",
    "a", "c", "e", "f", "foo", "bar", "baz", "tmp", "val",
  ];

  test("no placeholder name is a unit", () => {
    // `bar` is the exception, and a deliberate one: it is a pressure unit that
    // predates this gate and is far more likely to be meant as pressure than
    // as a variable, which would be written `:bar` anyway.
    const allowed = new Set(["bar"]);
    const collisions = PLACEHOLDER_NAMES.filter(
      (name) => knownUnits.has(name) && !allowed.has(name)
    );
    expect(collisions).toEqual([]);
  });

  test("expressions built from placeholder names still lex as identifiers", () => {
    expect(tokenTypes("x.y")).toEqual(["IDENT", "DOT", "IDENT"]);
    expect(tokenTypes("x == y")).toEqual(["IDENT", "EQUALITY", "IDENT"]);
  });
});

describe("gate 4: units are not ordinary English words", () => {
  /**
   * Common English words that also appear in the conversion tables.
   *
   * Not a general dictionary: the words here were found by scanning the table
   * for lowercase alphabetic spellings and reviewing them. The list is the
   * memory of that review, so a table upgrade that adds another common word
   * fails this gate rather than shipping.
   */
  const COMMON_ENGLISH_IN_THE_TABLE = [
    "are", "ares", "turn", "turns", "grade", "grades", "point", "points",
    "moment", "moments", "shake", "shakes", "a", "dec", "pm",
  ];

  test("none of the reviewed common words is admitted", () => {
    const admitted = COMMON_ENGLISH_IN_THE_TABLE.filter((word) => knownUnits.has(word));
    expect(admitted).toEqual([]);
  });

  test("each of them is a real table entry, so the list is not stale", () => {
    // If a table upgrade removes one of these spellings, the exclusion is dead
    // weight and should go too.
    const missing = COMMON_ENGLISH_IN_THE_TABLE.filter((word) => !(word in UNIT_TABLE));
    expect(missing).toEqual([]);
  });

  test("prose containing a number does not become arithmetic", () => {
    // The failure mode the gate exists for.
    for (const prose of ["there are 3 options", "5 point plan", "grade 5 exam"]) {
      const types = tokenTypes(prose);
      expect(types).not.toContain("UNIT");
    }
  });
});

describe("the exclusion list stays honest", () => {
  test("every exclusion is a real spelling in one of the tables", () => {
    const dead = [...excludedUnitSpellings.keys()].filter(
      (spelling) => !(spelling in UNIT_TABLE) && !(spelling in EXTENDED_UNITS)
    );
    expect(dead).toEqual([]);
  });

  test("every exclusion carries a reason", () => {
    for (const [spelling, reason] of excludedUnitSpellings) {
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(20);
      expect(knownUnits.has(spelling)).toBe(false);
    }
  });
});
