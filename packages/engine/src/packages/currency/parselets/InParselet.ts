import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { resolveCurrencyAlias } from "@solve-js/uom/CurrencyAliases";
import { tryConsumeCurrencyOnDate, HISTORICAL_CURRENCY_FN } from "@solve-js/uom/HistoricalCurrency";

/**
 * InParselet, handles the standalone `IN` keyword as a postfix conversion.
 *
 * Enables expressions like `125 USD in GBP`, `(a + b) in minutes`, or
 * `price in EUR` where the left side can be any expression (not just a
 * bare UNIT token).
 *
 * When `IN` directly follows a UNIT token (e.g., `25 USD in GBP`), the
 * UomLiteralParselet handles the conversion inline using UOM_CONVERT_TO.
 * This parselet only fires when `IN` follows non-UNIT expressions (e.g.,
 * variables, subexpressions, parenthesized values).
 *
 * Binding power 35 (between Sum=30 and Product=40):
 * - `100 + 25 in GBP` → `100 + (25 in GBP)`  (in binds tighter than +)
 * - `25 in GBP * 2` → `(25 in GBP) * 2`      (in binds looser than *)
 */
export class InParselet implements InfixParselet {
	readonly category = "UoM";
	readonly bindingPower = 35;

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		const targetToken = parser.peek();
		// `<ip> in <cidr>`: a subnet-membership test, not a unit conversion. The
		// right side is a fused IP/CIDR literal, which only exists when the IP
		// package is loaded (and so registered the handler this calls). The left
		// address is already on the stack.
		if (targetToken?.type === "IP_CIDR") {
			parser.parseExpression(BindingPower.Prefix, builder);
			builder.emitPluginCall("ipInCidr", 2);
			return;
		}
		// Accept UNIT, currency symbols, a bare IDENT, a fused multi-word zone
		// name, or IN (for cases like "3 ft in in" where the target unit is
		// tokenized as a keyword).
		if (targetToken && (
			targetToken.type === "UNIT" ||
			targetToken.type === "DOLLAR" ||
			targetToken.type === "POUND" ||
			targetToken.type === "EURO" ||
			targetToken.type === "YEN" ||
			targetToken.type === "RUBLE" ||
			targetToken.type === "WON" ||
			targetToken.type === "CURRENCY_SYMBOL" ||
			targetToken.type === "IDENT" ||
			// A multi-word zone (`in New York`) the time package fuses into one
			// token. Without this the name was advertised and unreachable: the
			// line threw a parse error instead of answering or refusing.
			targetToken.type === "CITY_NAME" ||
			targetToken.type === "IN"
		)) {
			parser.consume();
			const targetUnit = resolveCurrencyAlias(targetToken.value) ?? targetToken.value;

			// `<money> in <currency> on <date>` where the left side is an
			// expression (`$100`, a variable, a subexpression) rather than a bare
			// UNIT literal. The source currency is unknown until the VM produces
			// the left value, so only the target is checked here; the historical
			// plugin reads the source currency off that Uom at runtime. See
			// uom/HistoricalCurrency.ts. Anything that is not `on <date>` between
			// currencies consumes nothing and falls through to the live path.
			const isoDate = tryConsumeCurrencyOnDate(parser, targetUnit);
			if (isoDate !== null) {
				// The left expression is already a Uom on the stack; hand
				// [amount, target, date] to the historical plugin.
				builder.emitOpcode(OpCode.PUSH_STRING);
				builder.emitString(targetUnit);
				builder.emitOpcode(OpCode.PUSH_STRING);
				builder.emitString(isoDate);
				builder.emitPluginCall(HISTORICAL_CURRENCY_FN, 3);
				return;
			}

			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(targetUnit);
			builder.emitOpcode(OpCode.UOM_CONVERT_IN);
		}
		// If the next token isn't a valid target unit, silently skip.
		// The left expression remains on the stack unchanged.
	}
}
