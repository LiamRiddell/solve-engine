/**
 * An `ExpressionEngine` that cleans itself up at the end of the test.
 *
 * An engine holds a query cache, and that cache arms a garbage-collection timer
 * per cached query for `gcTime` (ten minutes). A timer keeps a Node process
 * alive, so an engine that is constructed and dropped without `clear()` leaves
 * the process unable to exit long after the test that made it has finished.
 *
 * Under `npm run test:ci` this is invisible: Jest runs the files in parallel
 * workers and force-kills them at the end. Under `npm run test:full`, which
 * runs `--runInBand` so the memory-hungry suites do not fight over two cores,
 * everything shares one process and the timers accumulate there. That is what
 * made the full run pass every assertion and then sit for ten minutes until CI
 * killed it.
 *
 * Importing this module is the opt-in: the `afterEach` below is registered
 * against the importing spec file, and nothing else. Specs that already manage
 * their own engine in a `beforeEach`/`afterEach` pair do not need it.
 */
import { afterEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

const live: ExpressionEngine[] = [];

/**
 * Drop-in for `new ExpressionEngine(...)`. Same arguments, same instance, but
 * the engine is released when the test finishes.
 */
export function newTrackedEngine(
	...args: ConstructorParameters<typeof ExpressionEngine>
): ExpressionEngine {
	const engine = new ExpressionEngine(...args);
	live.push(engine);
	return engine;
}

afterEach(() => {
	while (live.length > 0) {
		// A spec is free to clear an engine itself; clearing twice is harmless,
		// but a throw here would fail a test that had already passed.
		try {
			live.pop()?.clear();
		} catch {
			/* already torn down */
		}
	}
});
