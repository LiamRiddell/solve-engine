/**
 * Currency the way people write it and the way the engine writes it back
 * (#693, #707): a symbol after the amount (`100 €`), a dollar with its country
 * before it (`A$100`), and the rand as the engine writes it (`R12.00`).
 *
 * The letter symbols written after an amount (`12 kr`, `12 zł`) and the
 * lower-case codes (`100 usd`) need no rule: they are unit spellings, resolved
 * by the alias table (see `uom/CurrencyAliases.ts`).
 */

import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

/** The token types a currency symbol lexes as, before an amount. */
const SYMBOL_TYPES: readonly string[] = ["DOLLAR", "POUND", "EURO", "YEN", "RUBLE", "WON", "CURRENCY_SYMBOL"];
const SYMBOL_TYPE_SET: ReadonlySet<string> = new Set(SYMBOL_TYPES);

const UNIT_ID = tokenTypeId("UNIT");
const NUMBER_ID = tokenTypeId("NUMBER");
const CURRENCY_SYMBOL_ID = tokenTypeId("CURRENCY_SYMBOL");

/** Where a token's source ends. */
function endOf(token: Token): number {
	return token.sourceEnd ?? token.offset + (token.text ?? "").length;
}

/**
 * `100 €`, `1,000 ₹`, `12₫`: a currency symbol after an amount is the same
 * money as the symbol before it. The symbol becomes the amount's unit, which
 * the unit literal resolves through the alias table, so `100 €` is `€100` and
 * `100 € in USD` converts as `€100 in USD` does.
 *
 * A symbol with another amount after it belongs to that amount (`100 $200` is
 * left as written), so it is not taken.
 *
 * @param priority - Where the rule sits among the normalizer's rules.
 */
export function suffixCurrencySymbolRule(priority = 60): NormalizerRule {
	return {
		name: "currency:suffix-symbol",
		priority,
		shape: [{ types: ["NUMBER"] }, { types: SYMBOL_TYPES }],
		match(tokens, pos): NormalizerMatch | null {
			const amount = tokens[pos];
			const symbol = tokens[pos + 1];
			if (amount.type !== "NUMBER" || symbol === undefined || !SYMBOL_TYPE_SET.has(symbol.type)) return null;
			if (tokens[pos + 2]?.type === "NUMBER") return null;
			const unit = new LexerToken("UNIT", UNIT_ID, symbol.value, symbol.text, symbol.offset, 0, symbol.line, symbol.col, endOf(symbol));
			return { consumed: 2, replacement: [amount, unit], ruleName: "currency:suffix-symbol" };
		},
	};
}

/**
 * The letters written touching a `$` to say whose dollar it is. Each resolves
 * through the alias table (`A$` is the Australian dollar).
 */
const DOLLAR_PREFIXES: ReadonlySet<string> = new Set(["A", "C", "US", "HK", "NZ", "S", "MX", "R"]);

/**
 * `A$100`, `C$100`, `US$100`, `HK$100`, `NZ$100`, `S$100`, `MX$100`, `R$100`:
 * a dollar named by its country, fused into one currency symbol.
 *
 * Only written touching, and only before an amount. The letters are other
 * things on their own: `A` is the ampere (`5 A`), `C` the coulomb, `R` and `S`
 * ordinary names, so `A $100` with a space is left as written.
 *
 * @param priority - Where the rule sits among the normalizer's rules.
 */
export function prefixedDollarRule(priority = 60): NormalizerRule {
	return {
		name: "currency:prefixed-dollar",
		priority,
		shape: [{ types: ["IDENT", "UNIT"] }, { types: ["DOLLAR"] }],
		match(tokens, pos): NormalizerMatch | null {
			const letters = tokens[pos];
			const dollar = tokens[pos + 1];
			if (letters.type !== "IDENT" && letters.type !== "UNIT") return null;
			if (!DOLLAR_PREFIXES.has(letters.text) || dollar?.type !== "DOLLAR") return null;
			if (endOf(letters) !== dollar.offset) return null;
			if (tokens[pos + 2]?.type !== "NUMBER") return null;
			const spelled = `${letters.text}$`;
			const symbol = new LexerToken("CURRENCY_SYMBOL", CURRENCY_SYMBOL_ID, spelled, spelled, letters.offset, 0, letters.line, letters.col, endOf(dollar));
			return { consumed: 2, replacement: [symbol], ruleName: "currency:prefixed-dollar" };
		},
	};
}

/** `R12`, `R1`: the rand sign and the whole part of an amount, lexed as one name. */
const RAND_HEAD = /^R(\d+)$/;
/** The fraction the engine writes after it: `.00`. */
const FRACTION = /^\.\d+$/;
/** The rest of a grouped amount after its first comma: `234.56`, `234,567.00`. */
const GROUPED_TAIL = /^\d{3}(?:,\d{3})*\.\d+$/;

/**
 * `R12.00`, `R1,234.56`: the rand, as the engine writes it.
 *
 * The rand's sign is a letter, and `R` is a name people use (the gas constant,
 * a resistance, a radius), so `12 R` stays a multiplication by whatever `R` is.
 * Read here is only the shape the engine writes, the sign touching an amount
 * with its fraction: that is never a name, because the lexer splits it into a
 * name and a stray `.00`, which answered nothing. `R12` without a fraction
 * could be a name (a resistor `R12`), so it is left alone.
 *
 * @param priority - Where the rule sits among the normalizer's rules.
 */
export function randAmountRule(priority = 60): NormalizerRule {
	return {
		name: "currency:rand-amount",
		priority,
		shape: [{ types: ["IDENT"] }, { types: ["NUMBER", "COMMA"] }],
		match(tokens, pos): NormalizerMatch | null {
			const head = tokens[pos];
			if (head.type !== "IDENT") return null;
			const whole = RAND_HEAD.exec(head.text);
			if (whole === null) return null;

			let amountText: string;
			let consumed: number;
			const next = tokens[pos + 1];
			if (next?.type === "NUMBER" && FRACTION.test(next.text) && endOf(head) === next.offset) {
				amountText = whole[1] + next.text;
				consumed = 2;
			} else {
				const tail = tokens[pos + 2];
				if (whole[1].length > 3 || next?.type !== "COMMA" || tail?.type !== "NUMBER") return null;
				if (endOf(head) !== next.offset || endOf(next) !== tail.offset || !GROUPED_TAIL.test(tail.text)) return null;
				amountText = `${whole[1]},${tail.text}`;
				consumed = 3;
			}

			const last = tokens[pos + consumed - 1];
			const symbol = new LexerToken("CURRENCY_SYMBOL", CURRENCY_SYMBOL_ID, "ZAR", "R", head.offset, 0, head.line, head.col, head.offset + 1);
			const amount = new LexerToken("NUMBER", NUMBER_ID, amountText, amountText, head.offset + 1, 0, head.line, head.col + 1, endOf(last));
			return { consumed, replacement: [symbol, amount], ruleName: "currency:rand-amount" };
		},
	};
}
