import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { createQueryResolver } from "@solve-js/resolvers/QueryResolver";
import { errorValue, uomValue, type Value } from "@solve-js/vm/Value";
import { CryptoCallParselet } from "./parselets/CryptoParselet";
import type { CryptoPackageConfig } from "./types";

const PACKAGE_NAME = "solve-crypto";
const CRYPTO_FN = "crypto";

/**
 * Live crypto prices, `crypto("BTC")`, returning the current price of one coin
 * as a currency value.
 *
 * Because the price comes back as ordinary money, the rest of the language does
 * the conversion for free: `0.5 * crypto("BTC")` is the value of half a coin,
 * and `crypto("ETH") in GBP` converts through the currency package. So the
 * "0.5 BTC in USD" a reader wants is `0.5 * crypto("BTC")`, in whatever currency
 * the provider quotes (US dollars by default).
 *
 * **A factory, not a constant, and not in `BUILTIN_PACKAGES`**, for the same
 * reason as stocks: there is no free, keyless crypto price API to bundle, so the
 * host supplies `fetchPrice` (backed by whichever provider and key they have)
 * via {@link createCryptoPackage}. Without it, a crypto expression resolves to a
 * clearly-worded `CRYPTO_NOT_CONFIGURED` error, never a faked price. A host that
 * wants it calls `createCryptoPackage({ fetchPrice })` and adds the result to
 * its engine's `packages` array.
 */
export function createCryptoPackage(config: CryptoPackageConfig = {}): IEnginePackage {
	function notConfigured(): Value {
		return errorValue(
			"CRYPTO_NOT_CONFIGURED",
			"Crypto price provider not configured. Supply fetchPrice via createCryptoPackage({ fetchPrice }); see the CryptoPackage doc comment.",
		);
	}

	const { resolver, pluginFunction } = createQueryResolver({
		namespace: "crypto",
		pluginFunctionIndex: pluginFunctionIndexFor(`${PACKAGE_NAME}:${CRYPTO_FN}`),
		staleTimeMs: config.staleTimeMs ?? 60_000,
		refetchIntervalMs: config.refetchIntervalMs,
		fetchQuery: async (coin: string, signal: AbortSignal): Promise<Value> => {
			if (!config.fetchPrice) return notConfigured();
			const quote = await config.fetchPrice(coin, signal);
			return uomValue(quote.price, quote.currency ?? "USD");
		},
	});

	return {
		name: PACKAGE_NAME,
		lexerVocabulary: {
			// Claimed as a bare keyword, acceptable only because this package is
			// opt-in; `crypto(...)` itself never collides thanks to the LPAREN.
			keywords: { crypto: "CRYPTO_FN" },
		},
		prefixParselets: {
			CRYPTO_FN: new CryptoCallParselet(CRYPTO_FN),
		},
		pluginFunctions: {
			[CRYPTO_FN]: pluginFunction,
		},
		asyncResolvers: [resolver],
		tokenCategories: {
			CRYPTO_FN: "function",
		},
	};
}
