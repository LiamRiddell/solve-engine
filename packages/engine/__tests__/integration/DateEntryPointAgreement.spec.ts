/**
 * The date shapes, through every entry point a host can reach them by, plus
 * the boundary a worker result crosses.
 *
 * The engine has four ways in, and they do not agree by accident:
 * `evaluateExpression` and `evaluateLine` compile one expression with no
 * document behind it, `parseDocument` is the batch pass, and `evaluateDocument`
 * is the incremental one. On top of those a worker projects a `Value` onto a
 * clone-safe DTO before it crosses `postMessage`, and anything the projection
 * leaves out is gone by the time the host reads it.
 *
 * The grain and zone sidecars are exactly the kind of thing that drifts between
 * them: they are set in the VM and in one parselet, and every path afterwards
 * either carries them or quietly does not. A per-path test would pass while a
 * host reading results from a worker got a Datetime with nothing recorded on
 * it, which reads as "no zone was named" rather than as "the zone was lost".
 *
 * So the matrix below runs one shape per row through all four entry points and
 * asserts the same grain, the same zone and the same instant, and then asserts
 * the DTO carries both fields across.
 */
import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { serializeParsingResult, serializeValue } from "@solve-js/worker/serialize";
import { ValueType, type DatetimeGrain, type Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** One row of the matrix: a spelling, and what every path has to make of it. */
interface Shape {
	readonly expression: string;
	readonly grain: DatetimeGrain;
	readonly zone?: string;
	/** The instant, where it is a fixed one; omitted for a shape anchored to the host's zone or clock. */
	readonly instant?: number;
}

const SHAPES: readonly Shape[] = [
	{ expression: "2026-04-03", grain: "date" },
	{ expression: "3 April 2026", grain: "date" },
	{ expression: "03/04/2026", grain: "date" },
	{ expression: "2026-04-03 + 1 day", grain: "date" },
	{ expression: "2026-04-03T09:30", grain: "datetime" },
	{ expression: "2026-04-03T10:30:00Z", grain: "instant", zone: "UTCOFFSET:0", instant: Date.parse("2026-04-03T10:30:00Z") },
	{ expression: "2026-04-03T10:30:00+09:00", grain: "instant", zone: "UTCOFFSET:540", instant: Date.parse("2026-04-03T01:30:00Z") },
	{ expression: "2026-04-03 in Tokyo", grain: "instant", zone: "Asia/Tokyo", instant: Date.parse("2026-04-02T15:00:00Z") },
	{ expression: "2026-04-03T09:00 in Tokyo", grain: "instant", zone: "Asia/Tokyo", instant: Date.parse("2026-04-03T00:00:00Z") },
];

/** The single-expression path a host with no document calls. */
function throughEvaluateExpression(expression: string): Value {
	return newTrackedEngine().evaluateExpression(expression);
}

/** The single-line path, which carries a line number for the dependency graph. */
function throughEvaluateLine(expression: string): Value {
	return newTrackedEngine().evaluateLine(1, expression);
}

/** The batch document pass. */
function throughParseDocument(expression: string): Value {
	const parsed = newTrackedEngine().parseDocument(expression, { inputType: "markdown" });
	return parsed.lines[0].result as Value;
}

/** The incremental document pass, which adds the re-run primitive. */
function throughEvaluateDocument(expression: string): Value {
	const engine: ExpressionEngine = newTrackedEngine();
	return evaluateDocument(engine, expression, { inputType: "markdown" }).lines[0].result as Value;
}

const PATHS: ReadonlyArray<readonly [string, (expression: string) => Value]> = [
	["evaluateExpression", throughEvaluateExpression],
	["evaluateLine", throughEvaluateLine],
	["parseDocument", throughParseDocument],
	["evaluateDocument", throughEvaluateDocument],
];

describe("every entry point records the same thing", () => {
	for (const [pathName, run] of PATHS) {
		describe(pathName, () => {
			test.each(SHAPES.map((shape) => [shape.expression, shape] as const))("%s", (_expression, shape) => {
				const value = run(shape.expression);
				expect(value.type).toBe(ValueType.Datetime);
				expect(value.grain).toBe(shape.grain);
				expect(value.zone).toBe(shape.zone);
				if (shape.instant !== undefined) expect(value.toNumber()).toBe(shape.instant);
			});
		});
	}

	test.each(SHAPES.map((shape) => [shape.expression] as const))("the four paths agree on %s, instant included", (expression) => {
		const values = PATHS.map(([, run]) => run(expression));
		const first = values[0];
		for (const value of values.slice(1)) {
			expect(value.toNumber()).toBe(first.toNumber());
			expect(value.grain).toBe(first.grain);
			expect(value.zone).toBe(first.zone);
		}
	});
});

describe("the worker boundary carries both fields", () => {
	test.each(SHAPES.map((shape) => [shape.expression, shape] as const))("%s crosses as itself", (_expression, shape) => {
		const dto = serializeValue(throughEvaluateLine(shape.expression));
		expect(dto.type).toBe(ValueType.Datetime);
		expect(dto.grain).toBe(shape.grain);
		expect(dto.zone).toBe(shape.zone);
		// The DTO's contract is that it survives `structuredClone` and `JSON`
		// alike, which is what a `postMessage` and a host-side cache each do.
		expect(JSON.parse(JSON.stringify(dto))).toEqual(structuredClone(dto));
	});

	test("a whole document's DTO carries them line by line", () => {
		const engine: ExpressionEngine = newTrackedEngine();
		const text = SHAPES.map((shape) => shape.expression).join("\n");
		const dto = serializeParsingResult(engine.parseDocument(text, { inputType: "markdown" }));
		SHAPES.forEach((shape, index) => {
			expect(dto.lines[index].result?.grain).toBe(shape.grain);
			expect(dto.lines[index].result?.zone).toBe(shape.zone);
		});
	});

	test("a refusal crosses as a refusal, not as a date with nothing recorded", () => {
		const dto = serializeValue(throughEvaluateLine("2026-04-03 in Atlantis"));
		expect(dto.type).toBe(ValueType.Error);
		expect("grain" in dto).toBe(false);
		expect("zone" in dto).toBe(false);
	});
});
