/**
 * Every active ISO 4217 currency code is recognised.
 *
 * `$100 in UAH` returned an unconverted hundred dollars. Not an error, not a
 * conversion: the original amount, as though the rate were 1. The cause was a
 * hand-written allowlist of forty-six codes in `CurrencyExchange.isCurrency()`,
 * so any of the other ~130 active codes silently did nothing.
 *
 * That is the worst failure mode this engine has. An unsupported code should
 * say so; returning the input unchanged reads as a successful conversion.
 *
 * These tests answer "is this a currency" from the standard. Whether a *rate*
 * is available is a separate question, answered by the exchange provider at
 * resolution time, and deliberately not asserted here.
 */

import { describe, expect, test } from "@jest/globals";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { ISO_4217_CODES, isIso4217 } from "@solve-js/uom/Iso4217";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

describe("the ISO 4217 active set", () => {
	test("every code in the table is recognised as a currency", () => {
		const unrecognised = [...ISO_4217_CODES].filter((code) => !sharedCurrencyExchange.isCurrency(code));
		expect(unrecognised).toEqual([]);
	});

	test("the table is the size the standard is, give or take revisions", () => {
		// A committed count, so a code being dropped by an edit shows up as a
		// failing test rather than as a currency that quietly stops working.
		expect(ISO_4217_CODES.size).toBe(166);
	});

	test("the currencies that regressed are in it", () => {
		// UAH is the one that was reported. The rest are a spread across the
		// alphabet that the old forty-six-code list also missed.
		for (const code of ["UAH", "RON", "BGN", "ISK", "TWD", "GEL", "AZN", "UZS", "KZT", "RSD"]) {
			expect(sharedCurrencyExchange.isCurrency(code)).toBe(true);
		}
	});

	test("case does not matter", () => {
		expect(sharedCurrencyExchange.isCurrency("uah")).toBe(true);
		expect(sharedCurrencyExchange.isCurrency("UaH")).toBe(true);
	});
});

describe("what is deliberately not a currency", () => {
	test("XXX, the code meaning 'no currency', never resolves", () => {
		expect(isIso4217("XXX")).toBe(false);
		expect(sharedCurrencyExchange.isCurrency("XXX")).toBe(false);
	});

	test("XTS, reserved for testing, does not either", () => {
		expect(sharedCurrencyExchange.isCurrency("XTS")).toBe(false);
	});

	test("the precious metals are not currencies", () => {
		// XAU/XAG/XPT/XPD are ISO 4217 codes but they are commodities, and
		// treating them as currencies would invite a rate lookup that means
		// something quite different.
		for (const code of ["XAU", "XAG", "XPT", "XPD"]) {
			expect(sharedCurrencyExchange.isCurrency(code)).toBe(false);
		}
	});

	test("XDR, the IMF's unit of account, is not one either", () => {
		expect(sharedCurrencyExchange.isCurrency("XDR")).toBe(false);
	});

	test("withdrawn codes stay withdrawn", () => {
		for (const code of ["DEM", "FRF", "ITL", "ESP", "IEP"]) {
			expect(sharedCurrencyExchange.isCurrency(code)).toBe(false);
		}
	});

	test("something that is not a code at all", () => {
		expect(sharedCurrencyExchange.isCurrency("ZZZ")).toBe(false);
		expect(sharedCurrencyExchange.isCurrency("BANANA")).toBe(false);
		expect(sharedCurrencyExchange.isCurrency("")).toBe(false);
	});
});

describe("cryptocurrencies, which are not ISO 4217", () => {
	test("are recognised, but not by the ISO table", () => {
		for (const code of ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "DOT"]) {
			expect(sharedCurrencyExchange.isCurrency(code)).toBe(true);
			expect(isIso4217(code)).toBe(false);
		}
	});
});

describe("the table itself", () => {
	test("every entry is three uppercase letters", () => {
		const malformed = [...ISO_4217_CODES].filter((code) => !/^[A-Z]{3}$/.test(code));
		expect(malformed).toEqual([]);
	});
});

describe("through the engine", () => {
	/** The evaluated Value for one line. */
	function evaluate(source: string) {
		const engine = newTrackedEngine("en");
		const [value] = engine.evaluateExpression(source);
		return value;
	}

	test("`$100 in UAH` reaches the currency resolver, as `in GBP` always did", () => {
		// The reported bug. It returned a Uom of 100 USD: the input, unconverted.
		// Pending means a rate lookup was actually started.
		const value = evaluate("$100 in UAH");
		expect(value.type).toBe(ValueType.Pending);
		expect(String(value.value)).toContain("USD:UAH");
	});

	test("and it takes the same path as a code that always worked", () => {
		expect(evaluate("$100 in UAH").type).toBe(evaluate("$100 in GBP").type);
	});

	test("an unknown code is refused rather than handed back unconverted", () => {
		// This used to assert the opposite, that `$100 in ZZZ` returned an
		// unconverted hundred dollars, which reads as a successful conversion at
		// a rate of 1. Widening the code table removed the common case but not
		// the failure mode; the failure mode is gone now too, because the last
		// `else` of UOM_CONVERT_TO/_IN in vm/VM.ts reports INCOMPATIBLE_UNITS
		// instead of pushing its input back.
		const value = evaluate("$100 in ZZZ");
		expect(value.type).toBe(ValueType.Error);
	});
});
