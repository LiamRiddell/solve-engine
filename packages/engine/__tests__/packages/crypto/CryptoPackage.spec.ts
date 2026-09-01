/**
 * createCryptoPackage integration tests (issue #278). Like the stocks tests,
 * these never hit a network: they exercise the resolver directly with a mock
 * fetch, and assert the opt-in shape and the honest not-configured error.
 */

import { describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/query-core";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { ValueType } from "@solve-js/vm/Value";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createCryptoPackage } from "@solve-js/packages/crypto";

const CRYPTO_FN_IDX = pluginFunctionIndexFor("solve-crypto:crypto");

function buildQueryBytecode(query: string, fnIdx: number) {
	const builder = new BytecodeBuilder();
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(query);
	builder.emitOpcode(OpCode.CALL_PLUGIN);
	builder.emitByte(fnIdx);
	builder.emitByte(1);
	builder.emitOpcode(OpCode.HALT);
	return builder.build();
}

describe("createCryptoPackage — shape", () => {
	test("is opt-in: not in BUILTIN_PACKAGES, and registers the crypto parselet", () => {
		const pkg = createCryptoPackage();
		expect(BUILTIN_PACKAGES.some((p) => p.name === "solve-crypto")).toBe(false);
		expect(Object.keys(pkg.prefixParselets!)).toContain("CRYPTO_FN");
		expect(pkg.asyncResolvers).toHaveLength(1);
	});
});

describe("createCryptoPackage — resolution", () => {
	test("without a provider it resolves to an honest error, never a fake price", async () => {
		const pkg = createCryptoPackage();
		const qc = new QueryClient();
		const resolver = pkg.asyncResolvers![0];
		const bytecode = buildQueryBytecode("BTC", CRYPTO_FN_IDX);
		const result = resolver.preflight!([], bytecode, "test-pkg", new AbortController().signal, qc);
		const resolved = await result!.resolver;
		expect(resolved.type).toBe(ValueType.Error);
		expect(resolved.value).toBe("CRYPTO_NOT_CONFIGURED");
		expect(String(resolved.unit)).toMatch(/fetchPrice/);
		qc.clear();
	});

	test("with a provider the price becomes a currency value in the quoted currency", async () => {
		const fetchPrice = jest.fn(async (coin: string) => {
			expect(coin).toBe("BTC");
			return { price: 64123.5, currency: "USD" };
		});
		const pkg = createCryptoPackage({ fetchPrice });
		const qc = new QueryClient();
		const resolver = pkg.asyncResolvers![0];
		const bytecode = buildQueryBytecode("BTC", CRYPTO_FN_IDX);
		const result = resolver.preflight!([], bytecode, "test-pkg", new AbortController().signal, qc);
		const resolved = await result!.resolver;
		expect(fetchPrice).toHaveBeenCalledTimes(1);
		expect(resolved.type).toBe(ValueType.Uom);
		expect(resolved.value).toBeCloseTo(64123.5);
		expect(resolved.unit).toBe("USD");
		qc.clear();
	});

	test("a provider without a currency defaults to USD", async () => {
		const pkg = createCryptoPackage({ fetchPrice: async () => ({ price: 100 }) });
		const qc = new QueryClient();
		const resolver = pkg.asyncResolvers![0];
		const result = resolver.preflight!([], buildQueryBytecode("ETH", CRYPTO_FN_IDX), "test-pkg", new AbortController().signal, qc);
		const resolved = await result!.resolver;
		expect(resolved.unit).toBe("USD");
		qc.clear();
	});
});
