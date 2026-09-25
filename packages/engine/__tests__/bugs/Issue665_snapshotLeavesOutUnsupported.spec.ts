import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { serializeValue, SnapshotErrorCodes } from "@solve-js/engine/EngineSnapshot";
import { BUILTIN_PACKAGES } from "@solve-js/packages";
import { ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #665: embedding.md and the `toJSON` doc comment said a variable holding
 * a symbolic value makes `toJSON()` throw. It never did: `serializeValue` refuses
 * the value and `toJSON` catches the refusal and leaves the variable out, and the
 * same happens to a colour, a bill split, a chart and an IP subnet. The docs now
 * say so; this pins the behaviour they describe, so the two cannot drift apart
 * again. After `fromJSON` the name is undefined until the host re-evaluates the
 * document.
 */

function snapshotOf(document: string): { variables: string[]; lines: string[]; restored: ExpressionEngine } {
	const engine = newTrackedEngine();
	engine.parseDocument(document, { inputType: "markdown" });
	const snapshot = JSON.parse(JSON.stringify(engine.toJSON()));
	const restored = ExpressionEngine.fromJSON(snapshot, { packages: BUILTIN_PACKAGES });
	return {
		variables: Object.keys(snapshot.variables).sort(),
		lines: snapshot.lineCache.map((entry: { expression: string }) => entry.expression),
		restored,
	};
}

const code = (run: () => unknown): string | undefined => {
	try {
		run();
		return undefined;
	} catch (error) {
		return (error as { code?: string }).code;
	}
};

describe("toJSON leaves out a value the format cannot hold, and does not throw", () => {
	test.each([
		["a symbolic value", ":y = 2x + 3 =>"],
		["a colour", ":y = #ff0000"],
		["a colour from rgb()", ":y = rgb(255, 0, 0)"],
		["an IP subnet", ":y = 192.168.1.0/24"],
		["a bill split", ":y = split $180 between 4"],
		["a chart", ":y = [1, 2, 3] as sparkline"],
	])("%s", (_kind, definition) => {
		const { variables, lines, restored } = snapshotOf(`${definition}\n:z = 5`);
		expect(variables).toEqual(["z"]);
		expect(lines).toEqual([":z = 5"]);
		expect(code(() => restored.evaluateExpression("y"))).toBe("UNDEFINED_VARIABLE");
		expect(restored.evaluateExpression("z").toNumber()).toBe(5);
	});

	test("re-evaluating the document on the restored engine brings the name back", () => {
		const { restored } = snapshotOf(":y = #ff0000\n:z = 5");
		restored.parseDocument(":y = #ff0000\n:z = 5", { inputType: "markdown" });
		expect(restored.evaluateExpression("y").type).toBe(ValueType.Colour);
	});

	test("serializeValue itself refuses the value, which is what toJSON catches", () => {
		const colour = newTrackedEngine().evaluateExpression("#ff0000");
		expect(code(() => serializeValue(colour, "variable \"y\""))).toBe(SnapshotErrorCodes.SNAPSHOT_UNSUPPORTED_VALUE);
	});
});
