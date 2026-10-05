/**
 * The Node test environment, with one thing more: every `AsyncLocalStorage`
 * created while a spec file runs is switched off when that file ends.
 *
 * Why it is needed. `jest-circus` (30.5.2, the latest) makes a new
 * `AsyncLocalStorage` for each spec file, its `testExecutionContext`, and never
 * disables it. Node keeps every enabled store in one list for the whole
 * process, which the per-file module registry does not reset, and gives each
 * new promise a property for every store in that list. In a serial run
 * (`npm run test:full` is `--runInBand`) the list grows by one per file, so
 * after three hundred files every promise carries three hundred properties,
 * about 24 KB, and a spec that makes many promises pays for all of them:
 * `Issue695`'s forty thousand `global` reads went from 400 MB on their own to
 * more than the 4 GB heap after the rest of the suite. A parallel run hid it,
 * because a worker is replaced once it holds more than `workerIdleMemoryLimit`.
 *
 * How. `AsyncLocalStorage` is read from the shared `node:async_hooks` module
 * object when a store is made, so swapping in a subclass that records each new
 * store catches `jest-circus`'s own. Only stores made between this file's
 * `setup()` and `teardown()` are recorded, so a store Jest made for itself
 * before any spec ran is left alone. A store disabled here is only one this
 * file's tests could have used, and they have finished.
 *
 * The recording lives on the `node:async_hooks` module object, under a
 * registered symbol, because that object is the one thing every copy of this
 * module shares: Jest loads the environment in its own realm, and a spec that
 * requires this file gets a second copy in the spec's realm. Both read and
 * write the same state, and the class is swapped once.
 *
 * Where Node gives stores no per-promise property (the AsyncContextFrame
 * implementation, the default from Node 24), the subclass still records and
 * disables, which costs nothing.
 *
 * @module jestEnvironment
 */

const asyncHooks = require("node:async_hooks");
const NodeEnvironment = require("jest-environment-node").TestEnvironment;

const STATE = Symbol.for("solve-engine.jestEnvironment.recording");

/** The shared state: the stores made since `beginRecording`, or null between files. */
function state() {
	if (!Object.prototype.hasOwnProperty.call(asyncHooks, STATE)) {
		Object.defineProperty(asyncHooks, STATE, { value: { recording: null, installed: false }, enumerable: false });
	}
	return asyncHooks[STATE];
}

/** Swap `AsyncLocalStorage` for a subclass that records each store made while recording. Once per process. */
function install() {
	const shared = state();
	if (shared.installed) return;
	const Original = asyncHooks.AsyncLocalStorage;
	class RecordedAsyncLocalStorage extends Original {
		constructor(...args) {
			super(...args);
			if (shared.recording !== null) shared.recording.add(this);
		}
	}
	// Node 22 exports the class through a getter with no setter, so an
	// assignment would be ignored without a word; the property is redefined.
	Object.defineProperty(asyncHooks, "AsyncLocalStorage", {
		value: RecordedAsyncLocalStorage,
		writable: true,
		configurable: true,
		enumerable: true,
	});
	if (asyncHooks.AsyncLocalStorage !== RecordedAsyncLocalStorage) {
		throw new Error("jestEnvironment: node:async_hooks would not take the recording AsyncLocalStorage");
	}
	shared.installed = true;
}

/**
 * Start recording the stores made from now on, and return the set they go into.
 *
 * @param into - A set to record into, so a spec can lend out the live recording
 *   and give it back; a new one when left out.
 */
function beginRecording(into = new Set()) {
	install();
	state().recording = into;
	return into;
}

/** The live recording itself, or null between files: what a spec gives back to `beginRecording`. */
function currentRecording() {
	return state().recording;
}

/**
 * Stop recording and disable every store recorded since `beginRecording`.
 *
 * @returns How many stores were disabled.
 */
function endRecording() {
	const shared = state();
	const made = shared.recording;
	shared.recording = null;
	if (made === null) return 0;
	for (const store of made) store.disable();
	return made.size;
}

/** The stores recorded so far in this file. */
function recordedStores() {
	const made = state().recording;
	return made === null ? [] : [...made];
}

install();

class SolveTestEnvironment extends NodeEnvironment {
	async setup() {
		beginRecording();
		await super.setup();
	}

	async teardown() {
		endRecording();
		await super.teardown();
	}
}

module.exports = SolveTestEnvironment;
module.exports.beginRecording = beginRecording;
module.exports.endRecording = endRecording;
module.exports.recordedStores = recordedStores;
module.exports.currentRecording = currentRecording;
