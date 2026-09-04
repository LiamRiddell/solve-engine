/**
 * An operator declares which way it groups, and the registry reports it.
 *
 * Associativity used to live in how each parselet happened to call
 * parseExpression (a private "one below" in BinaryOpParselet), so the
 * registry could only report every operator as left-associative, `^`
 * included, and a package author wanting a right-associative operator had to
 * know the trick. `rightAssociative` on InfixParselet is now the declaration,
 * `parseRightOperand` turns it into the binding power, and getAllInfix
 * reports it.
 */

import { describe, expect, test } from "@jest/globals";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import type { InfixParselet } from "@solve-js/parser/Parselet";
import { parseRightOperand } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import { BindingPower } from "@solve-js/parser/BindingPower";
import type { Token } from "@solve-js/lexer/Token";
import { newTrackedEngine } from "@tools/trackedEngine";

/** A subtraction spelt `~>`, grouping from the right when told to. */
class ArrowMinus implements InfixParselet {
	readonly category = "Test";
	readonly bindingPower = BindingPower.Sum;
	constructor(readonly rightAssociative: boolean) {}
	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		parseRightOperand(this, parser, builder);
		builder.emitOpcode(OpCode.SUB);
	}
}

describe("the registry's report", () => {
	test("says right for the exponent and left for the rest", () => {
		const engine = newTrackedEngine();
		const infix = engine.getParseletRegistry().infix;
		const caret = infix.find((i) => i.tokenType === "CARET")!;
		const star = infix.find((i) => i.tokenType === "STAR")!;
		expect(caret.associativity).toBe("right");
		expect(caret.rightBindingPower).toBe(caret.leftBindingPower - 1);
		expect(star.associativity).toBe("left");
		expect(star.rightBindingPower).toBe(star.leftBindingPower + 1);
	});
});

describe("a package operator", () => {
	test("groups from the right when it says so, and from the left otherwise", () => {
		const right = newTrackedEngine();
		right.registerPackage({
			name: "test-arrow-right",
			lexerVocabulary: { operators: { "~>": "ARROW" } },
			infixParselets: { ARROW: new ArrowMinus(true) },
		});
		// 10 ~> (3 ~> 2) = 10 - 1
		expect(right.evaluateExpression("10 ~> 3 ~> 2").toNumber()).toBe(9);

		const left = newTrackedEngine();
		left.registerPackage({
			name: "test-arrow-left",
			lexerVocabulary: { operators: { "~>": "ARROW" } },
			infixParselets: { ARROW: new ArrowMinus(false) },
		});
		// (10 ~> 3) ~> 2 = 7 - 2
		expect(left.evaluateExpression("10 ~> 3 ~> 2").toNumber()).toBe(5);
	});
});
