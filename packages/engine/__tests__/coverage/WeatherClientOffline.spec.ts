/**
 * The Open-Meteo client's failure paths, driven by a stub rather than the
 * network.
 *
 * `packages/weather/WeatherPackage.spec.ts` covers the happy path by calling
 * the real API, which is the right way to prove the integration works, and it
 * has the reachability probes and transient-5xx allowances that a live
 * dependency needs. What it cannot do is make Open-Meteo return a 404, an
 * empty result set or a body missing its `daily` block on demand, so all four
 * of `OpenMeteoClient.ts`'s error branches were unreached: it was the weakest
 * of the twenty-four built-in packages at 64% of branches and 70% of
 * functions.
 *
 * Those branches are the ones a user actually meets. A typo in a city name
 * takes the CITY_NOT_FOUND path on the first try, and the difference between
 * "no location found for Lonodn" and a raw TypeError out of a JSON walk is
 * the whole user-facing behaviour of the feature when it goes wrong.
 *
 * Everything here is offline and deterministic: `fetch` is replaced for the
 * duration of each test, and every city name is unique so the client's own
 * sixty-second coalescing cache cannot carry a result between tests.
 */

import { afterEach, describe, expect, test } from "@jest/globals";
import { fetchCityWeather } from "@solve-js/packages/weather";
import { WeatherErrorCodes } from "@solve-js/packages/weather/OpenMeteoClient";
import { EngineError, ErrorCategory } from "@solve-js/errors/EngineError";

type StubResponse = { ok: boolean; status: number; body: unknown };

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

/**
 * Answer the geocoding call with `geo` and the forecast call with `forecast`,
 * recording every URL asked for so a test can assert how many round-trips
 * were really made.
 */
function stubFetch(geo: StubResponse, forecast?: StubResponse): { urls: string[] } {
	const urls: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		urls.push(url);
		const answer = url.includes("geocoding-api") ? geo : (forecast ?? geo);
		return {
			ok: answer.ok,
			status: answer.status,
			json: async () => answer.body,
		} as Response;
	}) as typeof fetch;
	return { urls };
}

const OK_GEO: StubResponse = {
	ok: true,
	status: 200,
	body: { results: [{ latitude: 51.5, longitude: -0.13, name: "Springfield" }] },
};

const OK_FORECAST: StubResponse = {
	ok: true,
	status: 200,
	body: {
		current: { weather_code: 3, temperature_2m: 11.4, apparent_temperature: 9.2 },
		daily: { temperature_2m_max: [13.5], temperature_2m_min: [6.1] },
	},
};

/** A signal that never fires, standing in for an evaluation nobody cancelled. */
function liveSignal(): AbortSignal {
	return new AbortController().signal;
}

describe("the happy path, assembled from the two responses", () => {
	test("takes the place name from geocoding rather than echoing the input", () => {
		/*
		 * The point of geocoding a name is that the user's spelling and the
		 * canonical place name differ. Echoing the input back would make
		 * "weather in nyc" report a place called "nyc", and would hide the
		 * case where the API matched somewhere else entirely.
		 */
		stubFetch(OK_GEO, OK_FORECAST);
		return expect(fetchCityWeather("offlineville-a", liveSignal())).resolves.toMatchObject({
			resolvedName: "Springfield",
		});
	});

	test("carries the numbers through unchanged and derives the description from the code", async () => {
		/*
		 * Temperatures stay Celsius at this layer, so nothing here should be
		 * converted; the display unit is decided later. WMO code 3 is
		 * "overcast", which is the mapping the description column exists to
		 * apply rather than passing the bare number up to the formatter.
		 */
		stubFetch(OK_GEO, OK_FORECAST);
		const weather = await fetchCityWeather("offlineville-b", liveSignal());

		expect(weather.weatherCode).toBe(3);
		expect(weather.description).toBe("overcast");
		expect(weather.temperature).toBe(11.4);
		expect(weather.apparentTemperature).toBe(9.2);
		expect(weather.high).toBe(13.5);
		expect(weather.low).toBe(6.1);
	});

	test("geocodes first, then forecasts, and does both exactly once", async () => {
		// The forecast call needs coordinates the geocoding call produces, so
		// the order is a requirement rather than an accident.
		const { urls } = stubFetch(OK_GEO, OK_FORECAST);
		await fetchCityWeather("offlineville-c", liveSignal());

		expect(urls).toHaveLength(2);
		expect(urls[0]).toContain("geocoding-api");
		expect(urls[1]).toContain("api.open-meteo.com/v1/forecast");
	});

	test("an unrecognised WMO code degrades to naming the code, not to undefined", async () => {
		/*
		 * WMO adds codes, and a description of `undefined` would render as
		 * the word "undefined" in the middle of a sentence. Naming the number
		 * at least tells the reader something they can look up.
		 */
		stubFetch(OK_GEO, {
			ok: true,
			status: 200,
			body: {
				current: { weather_code: 4242, temperature_2m: 1, apparent_temperature: 1 },
				daily: { temperature_2m_max: [2], temperature_2m_min: [0] },
			},
		});
		const weather = await fetchCityWeather("offlineville-d", liveSignal());
		expect(weather.description).toBe("weather code 4242");
	});
});

describe("failures from the geocoding call", () => {
	test("a non-OK status is an EXTERNAL error naming the city and the status", async () => {
		/*
		 * EXTERNAL rather than INTERNAL matters: it is the category that says
		 * "the other end failed", so a host can distinguish a third-party
		 * outage from a bug in the engine, and it is what stops this being
		 * reported as an engine defect.
		 */
		stubFetch({ ok: false, status: 503, body: null });

		await expect(fetchCityWeather("offlineville-e", liveSignal())).rejects.toThrow(EngineError);

		const error = await fetchCityWeather("offlineville-e2", liveSignal()).catch((e) => e as EngineError);
		expect(error.code).toBe(WeatherErrorCodes.GEOCODING_API_ERROR);
		expect(error.category).toBe(ErrorCategory.EXTERNAL);
		expect(error.message).toContain("503");
		expect(error.message).toContain("offlineville-e2");
	});

	test("a 200 with no matches is CITY_NOT_FOUND, a validation error rather than an outage", async () => {
		/*
		 * This is the typo case, and it is by far the most common failure a
		 * user will see. It is deliberately a different code and a different
		 * category from the 5xx above, because the two call for opposite
		 * responses: fix your spelling, or wait.
		 */
		stubFetch({ ok: true, status: 200, body: { results: [] } });

		const error = await fetchCityWeather("offlineville-f", liveSignal()).catch((e) => e as EngineError);
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe(WeatherErrorCodes.CITY_NOT_FOUND);
		expect(error.category).toBe(ErrorCategory.VALIDATION);
		expect(error.message).toContain("offlineville-f");
	});

	test("a 200 with no results key at all is also CITY_NOT_FOUND, not a TypeError", async () => {
		/*
		 * The optional-chained walk through `json?.results?.[0]` is what
		 * makes this a named error rather than "Cannot read properties of
		 * undefined". A raw TypeError here would surface to the host as an
		 * INTERNAL engine bug for a response the engine did not write.
		 */
		stubFetch({ ok: true, status: 200, body: {} });

		const error = await fetchCityWeather("offlineville-g", liveSignal()).catch((e) => e as EngineError);
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe(WeatherErrorCodes.CITY_NOT_FOUND);
	});

	test("the forecast call is never made when geocoding failed", async () => {
		// Coordinates are the only reason to call the forecast endpoint, so
		// calling it without them is a wasted round-trip at best.
		const { urls } = stubFetch({ ok: false, status: 500, body: null });
		await fetchCityWeather("offlineville-h", liveSignal()).catch(() => undefined);

		expect(urls).toHaveLength(1);
		expect(urls[0]).toContain("geocoding-api");
	});
});

describe("failures from the forecast call", () => {
	test("a non-OK status is an EXTERNAL error carrying the status", async () => {
		stubFetch(OK_GEO, { ok: false, status: 502, body: null });

		const error = await fetchCityWeather("offlineville-i", liveSignal()).catch((e) => e as EngineError);
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe(WeatherErrorCodes.FORECAST_API_ERROR);
		expect(error.category).toBe(ErrorCategory.EXTERNAL);
		expect(error.message).toContain("502");
	});

	test("a 200 missing the current block is a named contract violation", async () => {
		/*
		 * A 200 whose body is not the agreed shape is the API breaking its
		 * contract, which is a genuinely different thing from an HTTP error
		 * and is why it has its own code. Reading `current.temperature_2m`
		 * off undefined would instead produce a TypeError blaming the engine.
		 */
		stubFetch(OK_GEO, {
			ok: true,
			status: 200,
			body: { daily: { temperature_2m_max: [1], temperature_2m_min: [0] } },
		});

		const error = await fetchCityWeather("offlineville-j", liveSignal()).catch((e) => e as EngineError);
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe(WeatherErrorCodes.FORECAST_RESPONSE_MALFORMED);
	});

	test("a 200 missing the daily block is caught the same way", async () => {
		// Both halves are required: without `daily` there is no high or low
		// to report, and the check has to cover each independently.
		stubFetch(OK_GEO, {
			ok: true,
			status: 200,
			body: { current: { weather_code: 0, temperature_2m: 1, apparent_temperature: 1 } },
		});

		const error = await fetchCityWeather("offlineville-k", liveSignal()).catch((e) => e as EngineError);
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe(WeatherErrorCodes.FORECAST_RESPONSE_MALFORMED);
	});
});

describe("the coalescing cache", () => {
	test("two lookups for the same city share one pair of round-trips", async () => {
		/*
		 * The five weather phrases are five different TanStack Query cache
		 * keys for the same underlying data, so without this cache a note
		 * asking for the temperature and the high in one city would geocode
		 * and forecast it twice. That is the whole reason this second cache
		 * exists on top of the resolver's.
		 */
		const { urls } = stubFetch(OK_GEO, OK_FORECAST);

		const [first, second] = await Promise.all([
			fetchCityWeather("offlineville-l", liveSignal()),
			fetchCityWeather("offlineville-l", liveSignal()),
		]);

		expect(urls).toHaveLength(2);
		expect(first).toBe(second);
	});

	test("the key ignores case and surrounding space, the way a typed city name varies", async () => {
		// "London", "london" and " London " are the same place, and a cache
		// that treated them as three would defeat itself on ordinary input.
		const { urls } = stubFetch(OK_GEO, OK_FORECAST);

		await fetchCityWeather("Offlineville-M", liveSignal());
		await fetchCityWeather("  offlineville-m  ", liveSignal());

		expect(urls).toHaveLength(2);
	});

	test("a failed lookup is evicted, so the next attempt really retries", async () => {
		/*
		 * Without the eviction, one transient 503 would be replayed to every
		 * query for that city for the next sixty seconds, including the ones
		 * the user triggers by retyping the line. The retry has to reach the
		 * network again, which is what the URL count shows.
		 */
		const failing = stubFetch({ ok: false, status: 503, body: null });
		await fetchCityWeather("offlineville-n", liveSignal()).catch(() => undefined);
		expect(failing.urls).toHaveLength(1);

		const recovered = stubFetch(OK_GEO, OK_FORECAST);
		const weather = await fetchCityWeather("offlineville-n", liveSignal());

		expect(recovered.urls).toHaveLength(2);
		expect(weather.resolvedName).toBe("Springfield");
	});
});
