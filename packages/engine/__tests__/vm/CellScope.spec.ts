import { describe, expect, test } from "@jest/globals";
import { mintScope } from "@solve-js/vm/CellScope";
import { createEngineContext } from "@solve-js/engine/EngineContext";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";

describe("mintScope", () => {
	test("hands out a distinct scope on every call", () => {
		const a = mintScope();
		const b = mintScope();
		const c = mintScope();
		expect(a).not.toBe(b);
		expect(b).not.toBe(c);
		expect(a).not.toBe(c);
	});
});

describe("the per-engine anonymous scope", () => {
	test("createEngineContext mints one scope, and a second context gets a different one", () => {
		const first = createEngineContext();
		const second = createEngineContext();
		expect(first.scope).toBeDefined();
		expect(second.scope).toBeDefined();
		expect(first.scope).not.toBe(second.scope);
	});

	test("an engine carries a scope, stable for its life and distinct from another engine's", () => {
		const a = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const b = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		try {
			const aScope = a.getContext().scope;
			expect(aScope).toBeDefined();
			// Nothing an engine does changes the scope it owns.
			a.evaluateExpression("1 + 1");
			expect(a.getContext().scope).toBe(aScope);
			// Two engines are two owners.
			expect(b.getContext().scope).not.toBe(aScope);
		} finally {
			a.clear();
			b.clear();
		}
	});
});
