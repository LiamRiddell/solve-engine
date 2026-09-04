/**
 * `isCurrency()` is remembered per spelling.
 *
 * The VM asks it on every unit-bearing instruction, and each ask used to
 * upper-case the code twice and probe two tables. The answer for a spelling
 * never changes (the ISO 4217 set and the crypto ticker table are fixed for the
 * life of the process), so it is now remembered, and any spelling that is not
 * three or four characters long is refused before either table is consulted.
 *
 * What this pins: the remembered answer is the same answer, in every case
 * form; the length guard refuses nothing a table would have accepted; and the
 * memory is bounded, so the public `./vm` surface cannot grow it without limit
 * by converting into a stream of never-repeated unit names.
 */

import { describe, expect, test } from "@jest/globals";
import { CurrencyExchangeService } from "@solve-js/uom/CurrencyExchange";
import { ISO_4217_CODES } from "@solve-js/uom/Iso4217";

describe("isCurrency is remembered per spelling", () => {
	test("a repeated ask answers the same as the first", () => {
		const fx = new CurrencyExchangeService();
		for (const code of ["USD", "usd", "Usd", "BTC", "doge", "kg", "km/h", "XXX"]) {
			const first = fx.isCurrency(code);
			expect(fx.isCurrency(code)).toBe(first);
			expect(fx.isCurrency(code)).toBe(first);
		}
	});

	test("every active ISO 4217 code is recognised in each case form", () => {
		const fx = new CurrencyExchangeService();
		for (const code of ISO_4217_CODES) {
			expect(fx.isCurrency(code)).toBe(true);
			expect(fx.isCurrency(code.toLowerCase())).toBe(true);
		}
	});

	test("the crypto tickers are recognised, in any case", () => {
		const fx = new CurrencyExchangeService();
		for (const code of ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "DOT"]) {
			expect(fx.isCurrency(code)).toBe(true);
			expect(fx.isCurrency(code.toLowerCase())).toBe(true);
		}
	});

	test("a spelling outside three or four characters is not money, and never was", () => {
		// The length guard is a shortcut, not a new rule: none of these was in
		// either table before it existed.
		const fx = new CurrencyExchangeService();
		for (const code of ["m", "kg", "", "dollars", "euros", "hours", "km/h", "USDT1"]) {
			expect(fx.isCurrency(code)).toBe(false);
		}
	});

	test("the excluded X-series codes stay excluded through the cache", () => {
		const fx = new CurrencyExchangeService();
		for (const code of ["XAU", "XAG", "XDR", "XTS", "XXX"]) {
			expect(fx.isCurrency(code)).toBe(false);
			expect(fx.isCurrency(code)).toBe(false);
		}
	});

	test("the memory is bounded: ten thousand distinct spellings do not grow it without limit", () => {
		const fx = new CurrencyExchangeService();
		for (let i = 0; i < 10_000; i++) {
			// Four-character spellings, so each one reaches the cache rather than
			// the length guard.
			fx.isCurrency(`Z${i.toString(36).padStart(3, "0")}`.slice(0, 4));
		}
		// The map is private; read it through the instance rather than widening
		// the class's surface for a test.
		const answers = (fx as unknown as { currencyAnswers: Map<string, boolean> }).currencyAnswers;
		expect(answers.size).toBeLessThanOrEqual(4096);
		// And it still answers correctly afterwards.
		expect(fx.isCurrency("GBP")).toBe(true);
		expect(fx.isCurrency("kg")).toBe(false);
	});
});
