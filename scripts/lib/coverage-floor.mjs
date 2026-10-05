/**
 * Merges coverage written by separate runs and compares it with a floor.
 *
 * The coverage run is split into shards that run side by side (see
 * `scripts/run-coverage.mjs`), and a floor is a property of the whole suite,
 * not of one shard: a shard holding a third of the spec files measures a third
 * of the code. So each shard writes Istanbul's `coverage-final.json` with no
 * threshold of its own, and the floor is checked once, here, on the merged map.
 *
 * The shards instrument the same source files the same way, so merging is the
 * sum of their hit counts, which `istanbul-lib-coverage` does. What this adds
 * is the refusals: a file that is not a coverage map, a path that names an
 * inherited property, and a merge that measured nothing all stop with a
 * sentence rather than pass a floor vacuously, since an empty map reports its
 * percentages as "Unknown" and a check that read that as a pass would be green
 * on a run whose shards wrote nothing.
 *
 * @module coverage-floor
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const libCoverage = require("istanbul-lib-coverage");

/** The four figures a Jest `coverageThreshold.global` names, in its order. */
export const METRICS = ["statements", "branches", "functions", "lines"];

/** Path keys that would reach an inherited property of a plain object. */
const INHERITED = new Set(["__proto__", "constructor", "prototype"]);

/** Whether a value is a plain object (not an array, not null). */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks that one parsed `coverage-final.json` has the shape a merge needs,
 * and names the file and the entry when it does not.
 *
 * @param {unknown} part The parsed file.
 * @param {string} name The file's name, for the message.
 * @returns {Record<string, object>} The part, unchanged.
 */
export function validatePart(part, name) {
	if (!isRecord(part)) throw new Error(`${name} is not a coverage map: expected an object keyed by source path.`);
	for (const key of Object.keys(part)) {
		if (INHERITED.has(key)) throw new Error(`${name} names "${key}" as a source path, which is an inherited property, not a file.`);
		const entry = part[key];
		if (!isRecord(entry) || !isRecord(entry.statementMap) || !isRecord(entry.s) || !isRecord(entry.fnMap) || !isRecord(entry.f) || !isRecord(entry.branchMap) || !isRecord(entry.b)) {
			throw new Error(`${name} has an entry for ${key} that is not file coverage: it needs statementMap, s, fnMap, f, branchMap and b.`);
		}
	}
	return part;
}

/**
 * Merges several parsed coverage files into one map.
 *
 * @param {{ name: string, data: unknown }[]} parts Each file's name and parsed contents.
 * @returns {import("istanbul-lib-coverage").CoverageMap}
 */
export function mergeCoverage(parts) {
	if (!Array.isArray(parts) || parts.length === 0) throw new Error("No coverage files were given, so there is nothing to measure.");
	const map = libCoverage.createCoverageMap({});
	for (const { name, data } of parts) map.merge(validatePart(data, name));
	return map;
}

/**
 * The merged map's four percentages, refusing a map that measured nothing.
 *
 * @param {import("istanbul-lib-coverage").CoverageMap} map
 * @returns {Record<string, { covered: number, total: number, pct: number }>}
 */
export function summarise(map) {
	const summary = map.getCoverageSummary().toJSON();
	if (!(summary.statements.total > 0)) throw new Error("The merged coverage holds no statements: the shards measured nothing, so the floor cannot be checked.");
	const out = {};
	for (const metric of METRICS) {
		const { covered, total } = summary[metric];
		// A metric with nothing to count (no branches at all) is fully covered.
		out[metric] = { covered, total, pct: total === 0 ? 100 : (covered / total) * 100 };
	}
	return out;
}

/**
 * The metrics under their floor.
 *
 * A floor is read as Jest reads a positive `coverageThreshold` figure: the
 * least percentage allowed. A missing metric has no floor; a floor that is not
 * a finite number between 0 and 100 is refused, since a typo there would
 * otherwise disable the check without a word.
 *
 * @param {Record<string, { pct: number }>} summary From {@link summarise}.
 * @param {Record<string, unknown>} floors The config's `coverageThreshold.global`.
 * @returns {{ metric: string, pct: number, floor: number }[]}
 */
export function belowFloor(summary, floors) {
	if (!isRecord(floors)) throw new Error("The coverage floor is not an object of percentages.");
	const misses = [];
	for (const metric of METRICS) {
		if (!Object.prototype.hasOwnProperty.call(floors, metric)) continue;
		const floor = floors[metric];
		if (typeof floor !== "number" || !Number.isFinite(floor) || floor < 0 || floor > 100) {
			throw new Error(`The ${metric} floor is ${JSON.stringify(floor)}, not a percentage between 0 and 100.`);
		}
		const { pct } = summary[metric];
		if (pct < floor) misses.push({ metric, pct, floor });
	}
	return misses;
}
