/**
 * The two places this parser records what an operator means, checked against
 * each other.
 *
 * `PrecedenceParser` dispatches an infix token one of two ways. If
 * `BP_TABLE[typeId]` is non-zero it takes the Tier 1 fast path, reading the
 * binding power from that table and emitting the opcode inline. Otherwise it
 * asks the parselet registry and uses `parselet.bindingPower`. The tables are
 * built from separate sources: `BUILTIN_INFIX_BP` in `parser/BindingPower.ts`
 * for the first, each package's own registration list for the second.
 *
 * Every operator with an entry in both is therefore declared twice, and only
 * the Tier 1 number is ever read. There is history here: `%` was changed in
 * the parselet and not in the fast path, the parselet became dead code, and
 * the whole suite stayed green while `200 + 10%` answered 200.10. Those two
 * copies now agree on the opcode.
 *
 * The shifts and the bitwise trio used to be the other half of this: they were
 * declared at one set of levels in `BUILTIN_INFIX_BP` and a different set in
 * `ArithmeticPackage`, and `>>>` was missing from the fast path entirely, so it
 * really did run at a different precedence from `>>`. All six now name the same
 * `BindingPower` levels in both places and all six are in the fast-path table,
 * which is what the sweep below checks. `%` is the one operator left declaring
 * two different precedences.
 *
 * Reading the packages directly rather than an engine's assembled registry is
 * on purpose. `ExpressionEngine.getParseletRegistry()` used to report every
 * infix binding power as 0, because it read `leftBindingPower`, a field the
 * `InfixParselet` interface does not have, so it could not be used to check
 * anything. It reads `bindingPower` now (and reports the right power as one
 * higher, the standard encoding for a left-associative operator), which the
 * last block of this file pins. Reading the packages is still what the sweeps
 * above do, because the registry cannot show the Tier 1 table at all.
 */

import { describe, expect, test } from "@jest/globals";
import { ARITHMETIC_PACKAGE } from "@solve-js/packages/arithmetic/ArithmeticPackage";
import { PERCENTAGE_PACKAGE } from "@solve-js/packages/percentage/PercentagePackage";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { newTrackedEngine } from "@tools/trackedEngine";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";

/** Every infix registration from the packages that own the built-in operators. */
function builtinInfixRegistrations(): Array<{ tokenType: string; bindingPower: number }> {
	const packages: IEnginePackage[] = [ARITHMETIC_PACKAGE, PERCENTAGE_PACKAGE];
	const found: Array<{ tokenType: string; bindingPower: number }> = [];
	for (const pkg of packages) {
		for (const entry of pkg.infixParselets ?? []) {
			found.push({ tokenType: entry.tokenType, bindingPower: entry.parselet.bindingPower });
		}
	}
	return found;
}

/** The fast path's binding power for a token type, or 0 when it has no entry. */
function tierOnePower(tokenType: string): number {
	return PrecedenceParser.BP_TABLE[tokenTypeId(tokenType)] ?? 0;
}

/**
 * Operators the two tables currently disagree about, excluded from the green
 * sweep below and asserted correctly in the `test.failing` after it so the
 * sweep keeps its teeth over the operators that do agree.
 *
 * `%` is a postfix operator declared as a prefix one in its parselet, which is
 * a different kind of mistake from the precedence split the shifts and the
 * bitwise trio used to have, and is left for whoever fixes `%` itself.
 */
const KNOWN_DISAGREEMENTS = new Set(["PERCENT"]);

describe("an operator declared in both tiers is declared the same way in both", () => {
	test("the operators that agree, swept", () => {
		const mismatched: string[] = [];
		for (const { tokenType, bindingPower } of builtinInfixRegistrations()) {
			if (KNOWN_DISAGREEMENTS.has(tokenType)) continue;
			const fastPath = tierOnePower(tokenType);
			if (fastPath === 0) continue; // Tier 2 only, nothing to compare against.
			if (fastPath !== bindingPower) {
				mismatched.push(`${tokenType}: fast path ${fastPath}, parselet ${bindingPower}`);
			}
		}
		expect(mismatched).toEqual([]);
	});

	test("the sweep is actually looking at something", () => {
		// A guard on the guard. If a refactor renamed the token types or moved
		// the registrations elsewhere, every loop above would iterate zero
		// times and pass. `+ - * / ^` must always be found in both tables, and
		// so must the six operators whose split this file was written about.
		const compared = builtinInfixRegistrations().filter((r) => tierOnePower(r.tokenType) > 0);
		const names = new Set(compared.map((r) => r.tokenType));
		for (const required of [
			"PLUS", "MINUS", "STAR", "SLASH", "CARET",
			"LSHIFT", "RSHIFT", "URSHIFT", "BIT_AND", "BIT_OR", "BIT_XOR",
		]) {
			expect(names.has(required)).toBe(true);
		}
	});

	test.failing("including the percent sign", () => {
		// The truthful expectation, failing today. One operator is left
		// carrying two different precedences:
		//
		//   PERCENT  fast path 70 (Postfix), parselet 60 (Prefix)
		//
		// PERCENT is the operator that already caused this exact bug once, and
		// it is still declared at two different levels; only the emitted
		// opcodes were brought back into line, not the precedences.
		//
		// The fast path wins every time, so the parselet number is dead and
		// nothing observable is wrong on its own account. It is worth fixing
		// anyway, because a dead declaration that reads as authoritative is
		// exactly what let `%` go wrong the first time.
		const mismatched: string[] = [];
		for (const { tokenType, bindingPower } of builtinInfixRegistrations()) {
			const fastPath = tierOnePower(tokenType);
			if (fastPath === 0) continue;
			if (fastPath !== bindingPower) {
				mismatched.push(`${tokenType}: fast path ${fastPath}, parselet ${bindingPower}`);
			}
		}
		expect(mismatched).toEqual([]);
	});
});

describe("the shifts group the same way as each other", () => {
	const num = (source: string) => {
		const engine = newTrackedEngine();
		return engine.evaluateExpression(source)[0].toNumber();
	};

	test("on their own the two right shifts agree, as they must for a positive operand", () => {
		// `>>` and `>>>` differ only in how they treat the sign bit, so on a
		// non-negative left operand they are the same operator. Establishing
		// that here is what makes the grouping test below meaningful.
		expect(num("16 >> 3")).toBe(2);
		expect(num("16 >>> 3")).toBe(2);
		expect(num("8 >> 1")).toBe(4);
		expect(num("8 >>> 1")).toBe(4);
	});

	test("and they still differ on a negative operand, which is the point of having both", () => {
		expect(num("-16 >> 2")).toBe(-4);
		expect(num("-16 >>> 2")).toBe(1073741820);
	});

	test("so they group with & and | the same way as each other too", () => {
		// This was the observable cost of the two-table split above, and it is
		// the reason the split was worth fixing rather than documenting.
		//
		// `>>` was in BP_TABLE and `>>>` was not, so `>>>` fell through to its
		// parselet a level looser and `&` bound tighter than it did. The same
		// expression with the same operands answered 0 or 8 depending only on
		// which of two spellings of right shift was typed:
		//
		//   16 >> 3 & 1   grouped as (16 >> 3) & 1   = 0
		//   16 >>> 3 & 1  grouped as 16 >>> (3 & 1)  = 8
		//
		// All three shifts now share `BindingPower.Shift` in both tables, so
		// the first grouping is what both spellings get, and it is the one
		// JavaScript gives. The absolute values are pinned in
		// hardening/ArithmeticPrecedence.spec.ts; what this file guards is
		// that the two spellings cannot drift apart again.
		expect(num("16 >>> 3 & 1")).toBe(num("16 >> 3 & 1"));
		expect(num("16 >>> 3 | 1")).toBe(num("16 >> 3 | 1"));
		expect(num("8 >>> 1 & 3")).toBe(num("8 >> 1 & 3"));
	});
});

describe("the registry introspection a host reads to draw an operator table", () => {
	test("it reports every parselet it holds", () => {
		const engine = newTrackedEngine();
		const registry = engine.getParseletRegistry();
		expect(registry.infix.length).toBeGreaterThan(20);
		expect(registry.prefix.length).toBeGreaterThan(20);
		expect(registry.infix.map((i) => i.tokenType)).toContain("PLUS");
	});

	test("with the binding power each of them actually has", () => {
		// `ParseletRegistry.getAllInfix()` used to read `leftBindingPower` and
		// `rightBindingPower` off each parselet. The `InfixParselet` interface
		// declares neither: the field is `bindingPower`, and that is what every
		// parselet in the codebase sets. Both reads were therefore `undefined`
		// and both fell through to the `?? 0` default, so the public
		// `getParseletRegistry()` reported a binding power of 0 for all ~60
		// infix operators. `getAllPrefix()` had the same defect in reverse: it
		// read `bindingPower`, which `PrefixParselet` does not declare.
		//
		// Zero is not a neutral wrong answer here. It is the value that means
		// "not an operator, stop the expression", so a host drawing a
		// precedence table from this API was told `*` and `+` bind equally and
		// that neither binds at all.
		//
		// The left power is `bindingPower` and the right is one higher, which
		// is the encoding a left-associative operator has and the same `bp + 1`
		// the parser itself uses for the right operand. A parselet that is
		// right-associative can still say so by declaring `rightBindingPower`.
		const engine = newTrackedEngine();
		const registry = engine.getParseletRegistry();
		const plus = registry.infix.find((i) => i.tokenType === "PLUS");
		const star = registry.infix.find((i) => i.tokenType === "STAR");
		expect(plus?.leftBindingPower).toBeGreaterThan(0);
		expect(star?.leftBindingPower).toBeGreaterThan(plus!.leftBindingPower);
	});

	test("and the left/right split says which way an operator associates", () => {
		// The half of the report a host needs in order to draw the table
		// correctly rather than merely in the right order. Pinned separately
		// from the ordering above so a change to the convention has to be
		// deliberate.
		const engine = newTrackedEngine();
		const registry = engine.getParseletRegistry();
		for (const tokenType of ["PLUS", "MINUS", "STAR", "SLASH"]) {
			const entry = registry.infix.find((i) => i.tokenType === tokenType);
			expect(entry).toBeDefined();
			expect(entry!.rightBindingPower).toBe(entry!.leftBindingPower + 1);
		}
	});

	test("a prefix parselet does not report a power of zero either", () => {
		// Zero means "not an operator" on this side too, and every prefix
		// parselet reported it. They have no per-parselet power to report, so
		// the level they all bind at is what comes back.
		const engine = newTrackedEngine();
		const registry = engine.getParseletRegistry();
		const zeroed = registry.prefix.filter((p) => p.bindingPower === 0);
		expect(zeroed).toEqual([]);
	});
});
