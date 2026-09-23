import { PrefixParselet, InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/** The plugin function an exact row lookup calls. */
export const TABLE_ROW_LOOKUP_FN = "TABLE_ROW_LOOKUP";
/** The plugin function a band lookup calls. */
export const TABLE_BAND_LOOKUP_FN = "TABLE_BAND_LOOKUP";
/** The plugin function a progressive total calls. */
export const TABLE_THROUGH_BANDS_FN = "TABLE_THROUGH_BANDS";

/** Words that only address the table: `the`, `table`, `above`. */
const ADDRESS_WORDS = new Set(["the", "table", "above"]);
/** Words that say the table is read as bands. */
const BAND_WORDS = new Set(["bands", "band"]);
/** Everything a lookup's address may say, band words included. */
const LOOKUP_ADDRESS_WORDS = new Set([...ADDRESS_WORDS, ...BAND_WORDS]);

/** Whether a token is a plain word from `words`, compared case-insensitively. */
function isWordIn(token: Token | undefined, words: ReadonlySet<string>): boolean {
  return token?.type === "IDENT" && words.has(token.value.toLowerCase());
}

/**
 * Consume the address after a lookup's key or a progressive total: any of `in`,
 * `the`, `table`, `bands`, `above`, in the orders they are naturally written.
 * Returns whether a band word was among them.
 *
 * Two guards keep the address from swallowing what follows it:
 * - `in` is taken only when an address word follows, so `column "price" for
 *   "tea" in EUR` still converts the looked-up price.
 * - After a number, the normaliser has already inserted an implicit `*` before
 *   a following word (`3 above` lexes as `3 * above`). That `*` is recognised by
 *   sitting at the same offset as the word after it, which a typed `*` never
 *   does, and is taken as part of the address rather than as a multiplication.
 *
 * @param parser - The parser, positioned just after the key or the trigger.
 * @param bandsAllowed - Whether `bands` may appear (it switches a lookup to a
 * band lookup; after `through bands` it has already been said).
 */
function consumeAddress(parser: Parser, bandsAllowed: boolean): boolean {
  const words = bandsAllowed ? LOOKUP_ADDRESS_WORDS : ADDRESS_WORDS;
  let bands = false;
  while (true) {
    const t = parser.peek();
    if (!t) break;
    const next = parser.peekAt(1);
    if (t.type === "IN") {
      if (!isWordIn(next, words)) break;
      parser.consume();
      continue;
    }
    if (t.type === "STAR" && next !== undefined && next.offset === t.offset && isWordIn(next, words)) {
      parser.consume();
      continue;
    }
    if (isWordIn(t, words)) {
      if (BAND_WORDS.has(t.value.toLowerCase())) bands = true;
      parser.consume();
      continue;
    }
    break;
  }
  return bands;
}

/** Whether a token is the word `for`, which lexes as the finance `FOR_DURATION` keyword in English. */
function isFor(token: Token | undefined): boolean {
  if (!token) return false;
  return token.type === "FOR_DURATION" || (token.type === "IDENT" && token.value.toLowerCase() === "for");
}

/**
 * `column "cost" for "food"` and `column "rate" for 45,000 in bands above`.
 *
 * The normaliser fuses `column` into this trigger only when a quoted name
 * follows it (see `TableLookupNormalizerRule.ts`), so a variable called `column`
 * is untouched. The grammar is:
 *
 *   column STRING for <key> [ in ] [ the ] [ table | bands ] [ above ]
 *
 * The key is one value: a quoted label, a number, an amount of money, a
 * variable, a line reference, or anything in brackets. It is parsed tighter
 * than `*` and `+`, so `column "cost" for "food" * 2` doubles the looked-up
 * cost rather than looking up `"food" * 2`, and a computed key is written in
 * brackets. `bands` in the address is what makes the lookup a band lookup; with
 * no `bands`, it is an exact match on the row's label.
 */
export class TableLookupParselet implements PrefixParselet {
  readonly category = "Tables";

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    const nameToken = parser.peek();
    if (!nameToken || nameToken.type !== "STRING") {
      throw ErrorFactory.parsing(
        "TABLE_COLUMN_NAME_EXPECTED",
        `Expected a quoted column name after "column" but got ${nameToken ? `"${nameToken.value}"` : "end of input"}`,
      );
    }
    parser.consume();
    const columnName = nameToken.value;

    if (!isFor(parser.peek())) {
      throw ErrorFactory.parsing(
        "TABLE_LOOKUP_FOR_EXPECTED",
        `Expected "for" and a row after column "${columnName}", as in column "${columnName}" for "food"`,
      );
    }
    parser.consume();

    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(columnName);
    // One value, not an expression: `*` and `+` after it belong to the result.
    parser.parseExpression(BindingPower.Product, builder);

    const bands = consumeAddress(parser, true);
    builder.emitPluginCall(bands ? TABLE_BAND_LOOKUP_FN : TABLE_ROW_LOOKUP_FN, 2);
  }
}

/**
 * `<amount> through bands above`, the progressive total across a band table.
 *
 * The amount is the left side, already parsed. The binding power sits below
 * `Sum`, as the payroll `after tax` form's does, so the whole preceding
 * expression is the amount: `40,000 + 5,000 through bands` places 45,000. The
 * address words after it are optional and read the same nearest table.
 */
export class ThroughBandsParselet implements InfixParselet {
  readonly category = "Tables";
  readonly bindingPower = BindingPower.Conditional;

  parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
    consumeAddress(parser, false);
    builder.emitPluginCall(TABLE_THROUGH_BANDS_FN, 1);
  }
}
