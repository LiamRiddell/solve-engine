import { afterEach, describe, expect, test } from "@jest/globals";
import { AsyncLocalStorage } from "node:async_hooks";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * The test environment disables, when a spec file ends, every
 * `AsyncLocalStorage` made while it ran (`tools/jestEnvironment.cjs`).
 *
 * `jest-circus` makes one store per spec file and never disables it. Node gives
 * every new promise a property for each enabled store, in one list for the
 * whole process, so a serial run of three hundred files left every promise
 * three hundred properties heavy, and `Issue695`'s forty thousand `global`
 * reads ran out of the full suite's 4 GB heap (92 KB a line, against 5 KB on
 * their own). The environment records each store made between a file's setup
 * and teardown and disables them at teardown.
 */

// The environment module, loaded again in this spec's realm. Its state lives on
// the shared `node:async_hooks` object, so this copy reads the live recording.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const environment = require("@tools/jestEnvironment.cjs") as {
	beginRecording(into?: Set<AsyncLocalStorage<unknown>>): Set<AsyncLocalStorage<unknown>>;
	endRecording(): number;
	recordedStores(): AsyncLocalStorage<unknown>[];
	currentRecording(): Set<AsyncLocalStorage<unknown>> | null;
};

/** The per-store properties a new promise carries: one for each enabled store. */
function storeProperties(): number {
	return Object.getOwnPropertySymbols(new Promise(() => undefined)).filter((s) => String(s) === "Symbol(kResourceStore)").length;
}

/** Whether this Node gives each promise a property per store (before AsyncContextFrame). */
const perPromiseStores = (() => {
	const store = new AsyncLocalStorage<number>();
	const before = storeProperties();
	const after = store.run(1, () => storeProperties());
	store.disable();
	return after > before;
})();

/** Run `body` with a recording of its own, then give the live one back. */
function withOwnRecording<T>(body: (mine: Set<AsyncLocalStorage<unknown>>) => T): T {
	const live = environment.currentRecording();
	const mine = environment.beginRecording();
	try {
		return body(mine);
	} finally {
		environment.endRecording();
		if (live !== null) environment.beginRecording(live);
	}
}

afterEach(() => {
	// Every test leaves the live recording in place for the environment's teardown.
	expect(environment.currentRecording()).not.toBeNull();
});

describe("the environment records the stores a spec file makes", () => {
	test("this file's own jest-circus store is recorded, so teardown can disable it", () => {
		expect(environment.recordedStores().length).toBeGreaterThanOrEqual(1);
	});

	test("AsyncLocalStorage is swapped once for a subclass, so instanceof still holds", () => {
		const store = new AsyncLocalStorage<number>();
		expect(store).toBeInstanceOf(AsyncLocalStorage);
		expect(Object.getPrototypeOf(AsyncLocalStorage).name).toBe("AsyncLocalStorage");
		expect(Object.getPrototypeOf(Object.getPrototypeOf(AsyncLocalStorage)).name).not.toBe("RecordedAsyncLocalStorage");
		expect(environment.recordedStores()).toContain(store);
		store.disable();
	});

	test("a store made while nothing records is left alone", () => {
		const live = environment.currentRecording();
		environment.endRecording();
		const loose = new AsyncLocalStorage<number>();
		const mine = environment.beginRecording();
		expect(mine.has(loose)).toBe(false);
		environment.endRecording();
		if (live !== null) environment.beginRecording(live);
		loose.disable();
	});
});

describe("beginRecording and endRecording", () => {
	test("end disables what was recorded and reports how many", () => {
		const count = withOwnRecording((mine) => {
			for (let i = 0; i < 5; i++) new AsyncLocalStorage<number>().run(i, () => undefined);
			expect(mine.size).toBe(5);
			return mine.size;
		});
		expect(count).toBe(5);
	});

	test("boundary: ending with nothing recorded, or twice, disables nothing and does not throw", () => {
		const live = environment.currentRecording();
		environment.beginRecording();
		expect(environment.endRecording()).toBe(0);
		expect(environment.endRecording()).toBe(0);
		if (live !== null) environment.beginRecording(live);
	});

	test("a store disabled by its owner first is disabled again without harm", () => {
		withOwnRecording(() => {
			const store = new AsyncLocalStorage<number>();
			store.run(1, () => undefined);
			store.disable();
		});
		expect(true).toBe(true);
	});

	test("a disabled store still works when used again, as Node's own disable promises", () => {
		let store: AsyncLocalStorage<number> | undefined;
		withOwnRecording(() => {
			store = new AsyncLocalStorage<number>();
		});
		expect(store!.run(7, () => store!.getStore())).toBe(7);
		store!.disable();
	});
});

describe("the effect that ran the full suite out of memory", () => {
	(perPromiseStores ? test : test.skip)("three hundred stores left enabled weigh down every promise; disabled at the end, none remains", () => {
		const base = storeProperties();
		withOwnRecording(() => {
			const stores = Array.from({ length: 300 }, () => new AsyncLocalStorage<number>());
			for (const store of stores) store.run(1, () => undefined);
			expect(storeProperties() - base).toBe(300);
		});
		expect(storeProperties()).toBe(base);
	});
});

describe("adversarial", () => {
	test("security: a store's options or a name that reads as a prototype key changes nothing", () => {
		expectPrototypeUntouched(() => {
			withOwnRecording((mine) => {
				for (const word of PROTOTYPE_WORDS) {
					const store = new AsyncLocalStorage<string>();
					expect(store.run(word, () => store.getStore())).toBe(word);
				}
				expect(mine.size).toBe(PROTOTYPE_WORDS.length);
			});
		});
	});

	test("realistic: a spec that makes a store inside an async test is still recorded", async () => {
		const store = await Promise.resolve().then(() => new AsyncLocalStorage<number>());
		expect(environment.recordedStores()).toContain(store);
		store.disable();
	});

	test("edge: ten thousand stores are recorded and released in budget", () => {
		const started = Date.now();
		const count = withOwnRecording(() => {
			for (let i = 0; i < 10_000; i++) new AsyncLocalStorage<number>();
			return environment.recordedStores().length;
		});
		expect(count).toBe(10_000);
		expect(Date.now() - started).toBeLessThan(5_000);
	});
});
