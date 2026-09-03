/**
 * The registry reports the binding power the parser really uses.
 *
 * Tier-1 operators are dispatched from BP_TABLE inline, and their parselets
 * stay registered so that diagnostics can show what matched. The postfix
 * percent parselet reported Prefix while the table used Postfix, so the
 * playground's view disagreed with the parser about the one operator whose
 * precedence people ask about most. Every Tier-1 operator that has a
 * registered infix parselet now reports the table's value, and this keeps
 * the two from drifting again.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { BUILTIN_INFIX_BP } from "@solve-js/parser/BindingPower";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { registerPackageForTesting } from "@tools/testUtils";

describe("Tier-1 operators", () => {
	test("every registered infix parselet reports the binding power the parser uses", () => {
		const registry = new ParseletRegistry();
		for (const pkg of BUILTIN_PACKAGES) registerPackageForTesting(pkg, registry);

		const disagreements: string[] = [];
		let compared = 0;
		for (const [type, bp] of Object.entries(BUILTIN_INFIX_BP)) {
			const parselet = registry.getInfix(type);
			if (!parselet) continue;
			compared++;
			if (parselet.bindingPower !== bp) {
				disagreements.push(`${type}: parselet reports ${parselet.bindingPower}, parser uses ${bp}`);
			}
		}
		expect(compared).toBeGreaterThan(0);
		expect(disagreements).toEqual([]);
	});
});
