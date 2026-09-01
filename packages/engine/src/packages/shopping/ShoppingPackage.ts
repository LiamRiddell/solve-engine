import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { InfixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { Value, ValueType, stringValue, errorValue } from "@solve-js/vm/Value";
import { canConvert, convertUnit } from "@solve-js/uom/UomConverter";

/**
 * `A vs B`: which is cheaper, and by how much. The two sides are compared as
 * lower-is-cheaper (a price, or a per-unit rate like `£3 / 500g`), so it answers
 * the everyday "which is the better value" question the shelf edge does not.
 *
 * Left is already on the stack; the right side is parsed at the operator's own
 * (low) binding power, so each side is a whole amount: `£3 / 500g vs £4 / 750g`
 * compares the two rates, not `500g vs £4`.
 */
function vsInfixParselet(pluginName: string): InfixParselet {
	return {
		category: "Shopping",
		bindingPower: BindingPower.Conditional,
		parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
			parser.parseExpression(BindingPower.Conditional, builder);
			builder.emitPluginCall(pluginName, 2);
		},
	};
}

/** Compare two amounts of the same kind, lower being cheaper, as a plain-language verdict. */
function compareValue(args: Value[]): Value {
	const a = args[0];
	const b = args[1];
	let na = a.toNumber();
	let nb = b.toNumber();

	// A unit on either side means both must carry one and line up (same unit, or
	// convertible), so a price is never compared against a weight.
	if (a.type === ValueType.Uom || b.type === ValueType.Uom) {
		if (a.type !== ValueType.Uom || b.type !== ValueType.Uom || a.unit === undefined || b.unit === undefined) {
			return errorValue("VS_INCOMPARABLE", "vs: compare two amounts of the same kind");
		}
		if (a.unit !== b.unit) {
			if (!canConvert(b.unit, a.unit)) {
				return errorValue("VS_INCOMPARABLE", `vs: ${a.unit} and ${b.unit} are not the same kind of thing`);
			}
			nb = convertUnit(nb, b.unit, a.unit);
		}
	}

	if (Math.abs(na - nb) <= Math.max(Math.abs(na), Math.abs(nb)) * 1e-9) {
		return stringValue("the same");
	}
	const firstIsCheaper = na < nb;
	const cheaper = Math.min(na, nb);
	const dearer = Math.max(na, nb);
	const percentLess = Math.round(((dearer - cheaper) / dearer) * 100);
	return stringValue(`the ${firstIsCheaper ? "first" : "second"} is cheaper, ${percentLess}% less`);
}

/**
 * Comparison shopping (issue #275): `A vs B` says which is cheaper and by how
 * much, comparing lower-is-cheaper. The discount and unit-price maths a shopper
 * wants is already ordinary arithmetic, `£80 - 20% - 10%` stacks discounts and
 * `£3 / 500g` is a per-gram price, so this package adds the one piece that was
 * missing: putting two of those side by side. On by default and removable.
 */
export const SHOPPING_PACKAGE: IEnginePackage = {
	name: "solve-shopping",
	lexerVocabulary: {
		keywords: { vs: "VS_COMPARE", versus: "VS_COMPARE" },
	},
	infixParselets: {
		VS_COMPARE: vsInfixParselet("shoppingCompare"),
	},
	pluginFunctions: {
		shoppingCompare: compareValue,
	},
	tokenCategories: {
		VS_COMPARE: "operator",
	},
};
