/**
 * The function-call spellings the health package accepts, each mapped to its
 * plugin function. `bmi(...)`, `pace(...)` and `speed(...)` fuse to a `HEALTH_CALL`
 * token via the engine's shared call-fusion rule; the parselet reads this map to
 * pick the plugin.
 */
export const HEALTH_CALL_FUNCTIONS: Record<string, string> = {
	bmi: "healthBmi",
	pace: "healthPace",
	speed: "healthSpeed",
};
