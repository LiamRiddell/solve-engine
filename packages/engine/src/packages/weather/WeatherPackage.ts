import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { createQueryResolver } from "@solve-js/resolvers/QueryResolver";
import { stringValue, uomValue, type Value } from "@solve-js/vm/Value";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { weatherQueryParselet } from "./parselets/WeatherQueryParselet";
import { fetchCityWeather, WeatherErrorCodes } from "./OpenMeteoClient";

/**
 * This package's descriptor name. The engine derives each plugin function's
 * `CALL_PLUGIN` registry index from `${package name}:${function name}` at
 * registration (see `pluginFunctionIndexFor` / `ExpressionEngine.registerPackage`),
 * so the same string has to serve both the `name` field and the index
 * derivation below, or the async resolver would watch a different index than
 * the parselets emit.
 */
const WEATHER_PACKAGE_NAME = "solve-weather";

/**
 * The single package-local plugin-function name every weather form emits. All
 * 5 forms fold their kind into the pushed query string (see the module doc
 * below), so one name, one handler, and one registry index serve them all.
 */
const WEATHER_FN_NAME = "weather";

/**
 * Live weather data, `weather in <city>`, `temperature in <city>`
 * `feels like in <city>`, `high in <city>`, `low in <city>`.
 *
 * Provider: **Open-Meteo** (https://open-meteo.com), free, keyless, no
 * signup, a real production-grade forecast API (used by this exact
 * geocoding + forecast shape, confirmed against the live API rather than
 * guessed field names. See `OpenMeteoClient.ts`). This is the reason
 * Weather ships as a default `BUILTIN_PACKAGES` member while the sibling
 * `stocks`/`knowledge` packages do not: those domains have no equivalent
 * free/keyless provider, so they're opt-in-only and require a host to
 * plug in a fetch function (see `packages/stocks/StocksPackage.ts` /
 * `packages/knowledge/KnowledgePackage.ts`). A host who doesn't want
 * Weather's default network calls can simply filter `WEATHER_PACKAGE` out
 * of the `packages` array passed to `ExpressionEngine`.
 *
 * All 5 forms share ONE `CALL_PLUGIN` index and ONE `createQueryResolver`
 * instance/namespace, the "kind" (current/temperature/feelslike/high/low)
 * is folded into the cached query STRING (`"<kind>:<city>"`, see
 * `parselets/WeatherQueryParselet.ts`), not encoded as a separate plugin
 * function. This keeps the async-resolver plumbing to exactly the shape
 * `createQueryResolver` was built for (one query string in, one `Value`
 * out) while still letting "weather in london" and "temperature in
 * london" cache independently (each is its own query string, so a
 * TanStack Query cache hit for one doesn't answer the other), the actual
 * underlying HTTP round-trip is separately coalesced/short-cached across
 * kinds in `OpenMeteoClient.ts`'s `fetchCityWeather()` (see its module
 * doc), so typing several weather queries for the same city doesn't
 * multiply real network calls by 5.
 *
 * `staleTimeMs` is set to 10 minutes: SoulverCore's own docs describe
 * weather values "automatically updating during the day" rather than
 * being pinned to when the note was written. Open-Meteo's underlying
 * forecast model itself refreshes roughly hourly, so anything from a few
 * minutes to an hour is defensible; 10 minutes is picked as a middle
 * ground that feels "live" in an interactive notepad without re-querying
 * Open-Meteo on every keystroke re-evaluation.
 */
const WEATHER_FN_IDX = pluginFunctionIndexFor(`${WEATHER_PACKAGE_NAME}:${WEATHER_FN_NAME}`);

const { resolver: weatherResolver, pluginFunction: weatherPluginFunction } = createQueryResolver({
	namespace: "weather",
	pluginFunctionIndex: WEATHER_FN_IDX,
	staleTimeMs: 10 * 60 * 1000, // 10 minutes — see module doc above
	fetchQuery: async (query: string, signal: AbortSignal): Promise<Value> => {
		const sep = query.indexOf(":");
		const kind = sep === -1 ? query : query.slice(0, sep);
		const city = sep === -1 ? "" : query.slice(sep + 1);

		const data = await fetchCityWeather(city, signal);

		switch (kind) {
			case "current":
				return stringValue(`${Math.round(data.temperature)}°C, ${data.description}`);
			case "temperature":
				return uomValue(data.temperature, "C");
			case "feelslike":
				return uomValue(data.apparentTemperature, "C");
			case "high":
				return uomValue(data.high, "C");
			case "low":
				return uomValue(data.low, "C");
			default:
				// Unreachable via this package's own parselets (kind is always
				// one of the 5 above), an honest error rather than a guessed
				// value if some other bytecode ever pushes a malformed query.
				throw ErrorFactory.internal(
					WeatherErrorCodes.UNKNOWN_QUERY_KIND,
					`Unknown weather query kind "${kind}"`,
					{ kind },
				);
		}
	},
});

/**
 * Weather lookups through Open-Meteo, a keyless public endpoint.
 *
 * The one built-in package that reaches the network. It needs no configuration,
 * which is why it can be a default where stocks and knowledge cannot, but a
 * host wanting no outbound traffic should assemble its own package list rather
 * than using {@link BUILTIN_PACKAGES}.
 */
export const WEATHER_PACKAGE: IEnginePackage = {
	name: WEATHER_PACKAGE_NAME,

	phrases: {
		"weather in": "WEATHER_IN",
		"temperature in": "TEMPERATURE_IN",
		"feels like in": "FEELS_LIKE_IN",
		"high in": "HIGH_IN",
		"low in": "LOW_IN",
	},

	prefixParselets: {
		WEATHER_IN: weatherQueryParselet("current", WEATHER_FN_NAME),
		TEMPERATURE_IN: weatherQueryParselet("temperature", WEATHER_FN_NAME),
		FEELS_LIKE_IN: weatherQueryParselet("feelslike", WEATHER_FN_NAME),
		HIGH_IN: weatherQueryParselet("high", WEATHER_FN_NAME),
		LOW_IN: weatherQueryParselet("low", WEATHER_FN_NAME),
	},

	pluginFunctions: {
		[WEATHER_FN_NAME]: weatherPluginFunction,
	},

	asyncResolvers: [weatherResolver],
};
