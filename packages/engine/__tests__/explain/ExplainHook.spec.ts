/**
 * Issue #522: each package describes its own step when a line is explained.
 *
 * What was wrong: `explainLine` knew arithmetic, percentages and date readings
 * through a fixed operator table, and returned no steps at all for the three
 * things a reader most often wants to check: a conversion (`5 km in miles`), a
 * function call (`sqrt(16) + 2`) and a finance phrase (`present value of
 * $1,000 after 5 years at 5%`).
 *
 * What is pinned here: the three probes derive, with the engine's own numbers
 * (every factor is computed by the function the builtin itself uses, never a
 * second calculation); the `explain` hook's contract for a package author (a
 * plugin function is offered only to its own package, the last step must carry
 * the call's result or the answer is discarded, a throwing hook declines, the
 * most recently registered package answers a builtin first); a derivation is
 * never partial (a chain of calls that skips an operation gets no steps); and
 * the hook is never called by ordinary evaluation.
 */

import { afterEach, describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { defineFunction } from "@solve-js/api/defineFunction";
import type { ExplainCall } from "@solve-js/explain/Explanation";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { numberValue, stringValue, type Value } from "@solve-js/vm/Value";
import { convertUnit } from "@solve-js/uom/UomConverter";
import { growthFactor, loanDiscountFactor } from "@solve-js/vm/FinanceFormulas";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { formatExplainNumber } from "@solve-js/explain/ExplainFormat";

/** The step descriptions of a line's derivation. */
function descriptions(line: string, packages?: IEnginePackage[]): string[] {
	return newTrackedEngine(packages ? { packages } : {}).explainLine(line).steps.map((s) => s.description);
}

describe("the three probes from the issue now derive", () => {
	test("a conversion reads as the factor and the multiplication by it", () => {
		const engine = newTrackedEngine();
		const explanation = engine.explainLine("5 km in miles");
		expect(explanation.steps.map((s) => s.description)).toEqual(["1 km is 0.621371 miles", "5 times 0.621371"]);
		// The factor is the engine's own conversion of one kilometre.
		expect(explanation.steps[0].value.toNumber()).toBe(convertUnit(1, "km", "miles"));
		expect(explanation.steps[0].value.unit).toBe("miles");
		// The last step is the answer itself, the value the line produced.
		expect(explanation.steps[1].value).toBe(explanation.result);
		expect(explanation.result.toNumber()).toBe(engine.evaluateExpression("5 km in miles").toNumber());
	});

	test("a function call is described, then carried into the arithmetic around it", () => {
		const explanation = newTrackedEngine().explainLine("sqrt(16) + 2");
		expect(explanation.steps.map((s) => [s.description, s.value.toNumber()])).toEqual([
			["the square root of 16", 4],
			["4 plus 2", 6],
		]);
		expect(explanation.result.toNumber()).toBe(6);
	});

	test("a finance phrase reads as its growth factor and the division by it", () => {
		const engine = newTrackedEngine();
		const explanation = engine.explainLine("present value of $1,000 after 5 years at 5%");
		expect(explanation.steps.map((s) => s.description)).toEqual([
			"5% a year for 5 years: (1 plus 5%) to the power of 5 is 1.27628",
			"$1,000.00 divided by 1.27628",
		]);
		// The factor is the one the builtin divides by, from the same function.
		expect(explanation.steps[0].value.toNumber()).toBe(growthFactor(0.05, 5));
		expect(explanation.steps[1].value).toBe(explanation.result);
		expect(explanation.result.unit).toBe("USD");
		expect(explanation.result.toNumber()).toBe(engine.evaluateExpression("present value of $1,000 after 5 years at 5%").toNumber());
	});
});

describe("conversions", () => {
	test("a temperature is an offset and a rate per degree, not a factor", () => {
		expect(descriptions("100 °C in °F")).toEqual(["0 °C is 32 °F, and each 1 °C adds 1.8 °F", "32 plus 100 times 1.8"]);
	});

	test("a rate converts by its own factor", () => {
		expect(descriptions("60 km/h in mph")).toEqual(["1 km/h is 0.621371 mph", "60 times 0.621371"]);
	});

	test("the source unit reads in the singular after 1, and a short unit is never cut down", () => {
		expect(descriptions("1 mile in km")[0]).toBe("1 mile is 1.60934 km");
		// `ms` ends in s, but `m` is metres: the singular is checked as a unit.
		expect(descriptions("500 ms in s")[0]).toBe("1 ms is 0.001 s");
	});

	test("a currency conversion reads the primed rate the conversion used", () => {
		sharedCurrencyExchange.primeRates("EUR", { USD: 1.08 });
		try {
			const explanation = newTrackedEngine().explainLine("100 EUR in USD");
			const steps = explanation.steps.map((s) => s.description);
			expect(steps.slice(0, 2)).toEqual(["1 EUR is 1.08 USD", "100 times 1.08"]);
			// The rate's source closes the derivation (#512); its time is when
			// the host primed it, so only its shape is pinned.
			expect(steps.slice(2)).toEqual([expect.stringMatching(/^EUR\/USD from host \(supplied by the host\), fetched \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/)]);
			expect(explanation.result.toNumber()).toBeCloseTo(108, 10);
		} finally {
			sharedCurrencyExchange.clearRates();
		}
	});
});

describe("function calls", () => {
	test("an argument is shown as written, not rounded to the display", () => {
		expect(descriptions("round(3.14159, 2)")).toEqual(["3.14159 rounded to 2 decimal places"]);
	});

	test("a nested call derives inside out", () => {
		expect(descriptions("max(sqrt(16), 3)")).toEqual(["the square root of 16", "the largest of 4 and 3"]);
	});

	test("the arithmetic inside an argument comes before the call", () => {
		expect(descriptions("sqrt(9 + 7) * 2")).toEqual(["9 plus 7", "the square root of 16", "4 times 2"]);
	});

	test("a minus in front of a call or a group is a step of its own", () => {
		const call = newTrackedEngine().explainLine("-sqrt(16)");
		expect(call.steps.map((s) => [s.description, s.value.toNumber()])).toEqual([
			["the square root of 16", 4],
			["the negative of 4", -4],
		]);
		const group = newTrackedEngine().explainLine("-(2 + 3)");
		expect(group.steps.map((s) => [s.description, s.value.toNumber()])).toEqual([
			["2 plus 3", 5],
			["the negative of 5", -5],
		]);
	});

	test("the guide's example: an argument's arithmetic, the call, then the sign", () => {
		// docs/src/content/docs/guide/explaining-lines.md
		expect(descriptions("-sqrt(9 + 7)")).toEqual(["9 plus 7", "the square root of 16", "the negative of 4"]);
		const comparison = newTrackedEngine().explainLine("(2 + 3) > 4");
		expect(comparison.steps).toEqual([]);
		expect(comparison.result.toNumber()).toBe(1);
	});

	test("a call on a matrix or a formula is left undescribed, so the line has no steps", () => {
		expect(descriptions("det([1, 2; 3, 4])")).toEqual([]);
		expect(descriptions("transpose([1, 2; 3, 4])")).toEqual([]);
	});

	test("a function with no wording of its own is described by its call", () => {
		expect(descriptions("gcd(12, 18) + 1")[0]).toBe("the greatest common divisor of 12 and 18");
		expect(descriptions("permutation(5, 2)")).toEqual(["permutation(5, 2)"]);
	});
});

describe("finance", () => {
	test("a monthly repayment shows the monthly rate, the discount and the payment", () => {
		const explanation = newTrackedEngine().explainLine("monthly repayment on $100,000 over 25 years at 4%");
		expect(explanation.steps.map((s) => s.description)).toEqual([
			"4% a year is 0.333333% a month over 300 monthly payments: (1 plus 0.333333%) to the power of -300 is 0.368492",
			"$100,000.00 times 0.333333%, divided by 1 minus 0.368492",
		]);
		expect(explanation.steps[0].value.toNumber()).toBe(loanDiscountFactor(0.04 / 12, 300));
		expect(explanation.steps[1].value).toBe(explanation.result);
	});

	test("an annual interest figure is worked through the total", () => {
		const steps = newTrackedEngine().explainLine("annual interest on $100,000 over 25 years at 4%").steps;
		expect(steps.map((s) => s.description).slice(2)).toEqual([
			"$527.84 times 300 payments, less the $100,000.00 borrowed",
			"$58,351.05 divided by 25 years",
		]);
	});

	test("the phrase and the function-call spelling of one builtin explain alike", () => {
		expect(descriptions("compoundInterest(1000, 5%, 3)")).toEqual([
			"5% a year for 3 years: (1 plus 5%) to the power of 3 is 1.15763",
			"1,000 times 1.15763",
		]);
		expect(descriptions("compound interest on $1,000 over 3 years at 5%")).toEqual([
			"5% a year for 3 years: (1 plus 5%) to the power of 3 is 1.15763",
			"$1,000.00 times 1.15763",
		]);
	});

	test("compounding more than once a year", () => {
		expect(descriptions("$1,000 for 3 years at 7% compounding monthly")).toEqual([
			"7% a year added 12 times a year for 3 years: (1 plus 7% / 12) to the power of 36 is 1.23293",
			"$1,000.00 times 1.23293",
		]);
	});

	test("sales tax, each way", () => {
		expect(descriptions("tax on $300 at 15%")).toEqual(["$300.00 times 15%"]);
		expect(descriptions("tax off $345 at 15%")).toEqual(["$345.00 divided by (1 plus 15%)"]);
		expect(descriptions("tax in $345 at 15%")).toEqual(["$345.00 less $345.00 divided by (1 plus 15%)"]);
	});

	test("return on an investment", () => {
		expect(descriptions("$500 invested $1,500 returned")).toEqual(["$1,500.00 minus $500.00, divided by $500.00"]);
		expect(descriptions("annual return on $500 invested $1,500 returned after 3 years")).toEqual([
			"$1,500.00 divided by $500.00, to the power of 1/3, minus 1",
		]);
	});

	test.each([
		"present value of $1,000 after 5 years at 5%",
		"monthly repayment on $100,000 over 25 years at 4%",
		"total repayment on $100,000 over 25 years at 4%",
		"daily interest on $10,000 over 6 years at 6%",
		"$1,000 after 3 years at 7%",
		"interest on $1,000 over 3 years at 7%",
		"tax on $10.10 at 15%",
		"5 km in miles",
		"round(5 km in miles, 1)",
	])("`%s`: the last step is the answer the line gives", (line) => {
		const engine = newTrackedEngine();
		const explanation = engine.explainLine(line);
		expect(explanation.steps.length).toBeGreaterThan(0);
		expect(explanation.steps[explanation.steps.length - 1].value.toNumber()).toBe(engine.evaluateExpression(line).toNumber());
	});
});

describe("a derivation is never partial", () => {
	test("a chain of calls with an operation between them gets no steps", () => {
		// The sum between the conversion and the rounding is not a call, so the
		// calls alone would skip it. The answer is still reported.
		const explanation = newTrackedEngine().explainLine("round(5 km in miles + 1 mile, 1)");
		expect(explanation.steps).toEqual([]);
		expect(explanation.result.toNumber()).toBeCloseTo(4.1, 10);
	});

	test("a conversion of a conversion is one chain", () => {
		// The second conversion is handed the first one's result itself, so the
		// chain accounts for the whole answer.
		expect(descriptions("5 km in miles in m")).toEqual([
			"1 km is 0.621371 miles",
			"5 times 0.621371",
			"1 mile is 1,609.34 m",
			"3.10686 times 1,609.34",
		]);
	});

	test("a chain whose calls feed each other derives in full", () => {
		expect(descriptions("round(5 km in miles, 1)")).toEqual([
			"1 km is 0.621371 miles",
			"5 times 0.621371",
			"3.11 miles rounded to 1 decimal place",
		]);
	});

	test("a call inside arithmetic the tree cannot hold gets no steps", () => {
		expect(descriptions("(5 km in miles) * 2")).toEqual([]);
	});

	test("a line whose call no package describes gets no steps, not the arithmetic around it", () => {
		const withoutFunctionHook = BUILTIN_PACKAGES.map((pkg) => (pkg.name === "solve-function" ? { ...pkg, explain: undefined } : pkg));
		expect(descriptions("sqrt(16) + 2", withoutFunctionHook)).toEqual([]);
	});
});

describe("the explain hook contract", () => {
	/** A package with one plugin function, `double(x)`, reached through a `double(` call word. */
	function doublePackage(explain: IEnginePackage["explain"], name = "test-double"): IEnginePackage {
		return {
			name,
			callFusions: { double: "DOUBLE_CALL" },
			prefixParselets: {
				DOUBLE_CALL: {
					category: "Test",
					parse(parser, _token, builder) {
						parser.consume("LPAREN");
						parser.parseExpression(0, builder);
						parser.consume("RPAREN");
						builder.emitPluginCall("double", 1);
					},
				},
			},
			pluginFunctions: { double: (args: Value[]) => numberValue(args[0].toNumber() * 2) },
			explain,
		};
	}

	test("a package describes its own plugin function", () => {
		const pkg = doublePackage((call, { format }) =>
			call.kind === "plugin" && call.name === "double" ? [{ description: `${format(call.args[0])} doubled`, value: call.result }] : undefined,
		);
		const explanation = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, pkg] }).explainLine("double(21) + 1");
		expect(explanation.steps.map((s) => [s.description, s.value.toNumber()])).toEqual([
			["21 doubled", 42],
			["42 plus 1", 43],
		]);
	});

	test("the worked example in the package guide: a defineFunction package with a hook added", () => {
		// docs/src/content/docs/packages/explaining-steps.md
		const vat = defineFunction({
			name: "vat",
			args: [{ name: "amount", type: "number" }],
			returns: "number",
			call: (amount) => amount * 1.2,
		});
		const withSteps: IEnginePackage = {
			...vat,
			explain: (call, { format }) =>
				call.kind === "plugin" && call.name === "vat"
					? [{ description: `${format(call.args[0])} plus 20% VAT`, value: call.result }]
					: undefined,
		};
		const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, withSteps] });
		expect(engine.explainLine("vat(100) + 5").steps.map((s) => [s.description, s.value.toNumber()])).toEqual([
			["100 plus 20% VAT", 120],
			["120 plus 5", 125],
		]);
		// Without the hook, the call has no description, so the line has no steps.
		const plain = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, vat] });
		expect(plain.explainLine("vat(100) + 5").steps).toEqual([]);
	});

	test("a plugin function is offered only to the package that registered it", () => {
		const seen: ExplainCall[] = [];
		const bystander: IEnginePackage = {
			name: "test-bystander",
			explain: (call) => {
				seen.push(call);
				return call.kind === "plugin" ? [{ description: "not mine", value: call.result }] : undefined;
			},
		};
		const owner = doublePackage(() => undefined);
		const explanation = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, owner, bystander] }).explainLine("double(21)");
		expect(seen.filter((c) => c.kind === "plugin")).toEqual([]);
		expect(explanation.steps).toEqual([]);
	});

	test("an answer whose last step is not the call's own result is discarded", () => {
		const pkg = doublePackage((call) =>
			call.kind === "plugin" ? [{ description: "a recomputed answer", value: numberValue(call.result.toNumber()) }] : undefined,
		);
		expect(descriptions("double(21)", [...BUILTIN_PACKAGES, pkg])).toEqual([]);
	});

	test("a hook that throws has declined, and the line still explains its answer", () => {
		const pkg = doublePackage(() => {
			throw new Error("hook bug");
		});
		const explanation = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, pkg] }).explainLine("double(21)");
		expect(explanation.steps).toEqual([]);
		expect(explanation.result.toNumber()).toBe(42);
	});

	test("a builtin is offered to the most recently registered package first", () => {
		const override: IEnginePackage = {
			name: "test-override",
			explain: (call) => (call.kind === "builtin" && call.name === "sqrt" ? [{ description: "a root, my way", value: call.result }] : undefined),
		};
		expect(descriptions("sqrt(16)", [...BUILTIN_PACKAGES, override])).toEqual(["a root, my way"]);
	});

	test("an as converter is described by the package that registered it", () => {
		const pkg: IEnginePackage = {
			name: "test-shout",
			asConverters: { shout: (v: Value) => stringValue(String(v.value).toUpperCase()) },
			explain: (call, { format }) =>
				call.kind === "converter" && call.name === "shout" ? [{ description: `${format(call.args[0])} in capitals`, value: call.result }] : undefined,
		};
		expect(descriptions('"hi" as shout', [...BUILTIN_PACKAGES, pkg])).toEqual(["hi in capitals"]);
	});

	test("a builtin's name is its function name, and the arguments are the values it was given", () => {
		const calls: ExplainCall[] = [];
		const spy: IEnginePackage = { name: "test-spy", explain: (call) => (calls.push(call), undefined) };
		newTrackedEngine({ packages: [...BUILTIN_PACKAGES, spy] }).explainLine("present value of $1,000 after 5 years at 5%");
		const call = calls.find((c) => c.kind === "builtin");
		expect(call?.name).toBe("presentValue");
		expect(call?.args.map((a) => a.toNumber())).toEqual([1000, 0.05, 5]);
	});
});

describe("explaining costs ordinary evaluation nothing", () => {
	test("no hook runs while a line or a document evaluates", () => {
		let calls = 0;
		const counter: IEnginePackage = {
			name: "test-counter",
			explain: () => {
				calls++;
				return undefined;
			},
		};
		const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, counter] });
		engine.evaluateExpression("sqrt(16) + 5 km in m");
		engine.evaluateLine(1, "present value of $1,000 after 5 years at 5%");
		engine.parseDocument("5 km in miles\nround(3.14159, 2)\nline 1 * 2");
		expect(calls).toBe(0);
		engine.explainLine("sqrt(16)");
		expect(calls).toBeGreaterThan(0);
	});
});

describe("the number format a hook is handed", () => {
	test.each([
		[0.6213711922373339, "0.621371"],
		[1609.344, "1,609.34"],
		[100000, "100,000"],
		[1234567, "1,234,567"],
		[-0, "0"],
	])("%d reads as %s", (n, text) => {
		expect(formatExplainNumber(n)).toBe(text);
	});
});

afterEach(() => sharedCurrencyExchange.clearRates());
