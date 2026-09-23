import { describe, expect, test, afterEach } from "@jest/globals";
import {
	BUILTIN_PACKAGES,
	VARIABLES_PACKAGE,
	GLOBAL_VARIABLES_PACKAGE,
} from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import { ValueType } from "@solve-js/vm/Value";

/**
 * `global :name` and `:name` are different levels of functionality: one stays
 * inside the document being evaluated, the other reaches outside it. They ship
 * as separate packages so a host can refuse the second without losing the
 * first.
 *
 * While both lived in one package, the documented way to drop a feature
 * (`BUILTIN_PACKAGES.filter((p) => p !== VARIABLES_PACKAGE)`) took ordinary
 * variables down with the document-spanning ones, and there was no supported
 * way to refuse only the latter. These tests pin the separation, because a
 * later tidy-up that merged the two packages back together would silently
 * remove a host's ability to make that choice.
 */

/** Evaluates a document and returns one line's result, as a readable tag. */
function resultOf(lines: string[], packages: typeof BUILTIN_PACKAGES, lineNumber: number): string {
	const engine = new ExpressionEngine({ packages });
	const doc = evaluateDocument(engine, lines.join("\n"));
	const value = doc.lines[lineNumber - 1]?.result;
	if (!value) return "none";
	return value.type === ValueType.Error ? "Error" : String(value.value);
}

describe("global variables are separable from ordinary variables", () => {
	afterEach(() => {
		sharedGlobalVariableStore.clear();
	});

	test("both are registered by default", () => {
		expect(BUILTIN_PACKAGES).toContain(VARIABLES_PACKAGE);
		expect(BUILTIN_PACKAGES).toContain(GLOBAL_VARIABLES_PACKAGE);
	});

	test("dropping the globals package keeps ordinary variables working", () => {
		const withoutGlobals = BUILTIN_PACKAGES.filter((p) => p !== GLOBAL_VARIABLES_PACKAGE);

		// The point of the split: locals survive.
		expect(resultOf([":subtotal = 41", ":subtotal + 1"], withoutGlobals, 2)).toBe("42");
		// And the document-spanning form is refused rather than silently
		// evaluating to something else. Contained to its own line.
		expect(resultOf(["global :x = 5", ":ok = 1"], withoutGlobals, 1)).toBe("Error");
		expect(resultOf(["global :x = 5", ":ok = 1"], withoutGlobals, 2)).toBe("1");
	});

	test("dropping the ordinary variables package leaves globals working", () => {
		// The reverse direction, which proves the globals package stands alone
		// rather than leaning on its former housemates: its parselet consumes
		// the colon and the name itself.
		const withoutLocals = BUILTIN_PACKAGES.filter((p) => p !== VARIABLES_PACKAGE);

		expect(resultOf(["global :standalone = 7"], withoutLocals, 1)).toBe("7");
		expect(resultOf(["global :standalone"], withoutLocals, 1)).toBe("7");
	});

	test("dropping the globals package removes the syntax, not the stored values", () => {
		// Worth pinning because it is surprising, and because the workspace in
		// docs-internal/plans/CROSS_SCOPE_CELLS.md is what fixes it: the store
		// is realm-wide and outlives any one engine, so refusing the package
		// makes existing values unaddressable rather than absent.
		const writer = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		writer.evaluateExpression("global :leaked = 99");
		expect(sharedGlobalVariableStore.get("leaked")!.toNumber()).toBe(99);

		const withoutGlobals = BUILTIN_PACKAGES.filter((p) => p !== GLOBAL_VARIABLES_PACKAGE);
		expect(resultOf(["global :leaked"], withoutGlobals, 1)).toBe("Error");
		expect(sharedGlobalVariableStore.get("leaked")!.toNumber()).toBe(99);
	});

	test("neither package registers the other's parselets", () => {
		// A structural assertion rather than a behavioural one, so a merge of
		// the two descriptors fails here with a clear reason even if some
		// behavioural test happens to still pass.
		expect(Object.keys(VARIABLES_PACKAGE.prefixParselets ?? {}).sort()).toEqual(["COLON", "IDENT", "UNIT"]);
		expect(Object.keys(GLOBAL_VARIABLES_PACKAGE.prefixParselets ?? {})).toEqual(["GLOBAL"]);
		// The resolver exists only to serve `global :name`, so it travels with it.
		expect(VARIABLES_PACKAGE.asyncResolvers ?? []).toHaveLength(0);
		expect(GLOBAL_VARIABLES_PACKAGE.asyncResolvers ?? []).toHaveLength(1);
	});
});
