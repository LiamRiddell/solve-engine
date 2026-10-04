/**
 * Shared by the parity specs (`SoulverParity.spec.ts`, `OtherAppsParity.spec.ts`):
 * the loose comparison of another app's documented answer with this engine's,
 * and the measured counts the internal audits quote.
 *
 * The audits in `docs-internal/` used to type their totals by hand, and the
 * totals drifted from the specs that measure them (#786). The counts now live
 * in `docs-internal/parity-stats.json`, written by the specs themselves under
 * `npm run stats:parity`, and each audit quotes a count between markers
 * (`<!-- parity:soulver.supported -->104<!-- /parity -->`). On an ordinary run
 * the specs assert that the file and every marker hold what they measured, so
 * a document cannot state a total that was not measured.
 */

import * as fs from "fs";
import * as path from "path";

/** The repository root, from this file's place in `packages/engine/tools`. */
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The committed counts, one section per parity spec. */
export const PARITY_STATS_FILE = path.join(REPO_ROOT, "docs-internal", "parity-stats.json");

/** The documents that quote the counts between markers. */
export const PARITY_QUOTING_DOCUMENTS = [
	path.join(REPO_ROOT, "docs-internal", "PARITY_BACKLOG.md"),
	path.join(REPO_ROOT, "docs-internal", "SOULVERCORE_FEATURE_AUDIT.md"),
	path.join(REPO_ROOT, "docs-internal", "OTHER_APPS_FEATURE_AUDIT.md"),
];

/** A section of the counts: a name for each list and how many rows it holds. */
export type ParityCounts = Readonly<Record<string, number>>;

/**
 * Whether this run writes the counts rather than checking them: set by
 * `npm run stats:parity` through `PARITY_STATS_WRITE=1`.
 */
export function writingParityStats(): boolean {
	return process.env.PARITY_STATS_WRITE === "1";
}

/**
 * Another app's documented answer against this engine's.
 *
 * Compares the leading number numerically rather than as text, so `10000.00 m`
 * satisfies `10,000 m`, and requires any trailing unit or suffix to appear too.
 * Substring matching was the obvious first attempt and it is wrong in the one
 * place it matters most: `$345.00` contains `45`, so a sales-tax answer that
 * returned the total rather than the tax read as a pass. A thrown line
 * (`THREW: ...`) never matches.
 *
 * @param got - This engine's formatted answer, or `THREW: <message>`.
 * @param documented - The answer the other app's documentation states.
 * @returns True when the two agree to the documented figure's precision.
 */
export function parityMatches(got: string, documented: string): boolean {
	const clean = (s: string) => s.replace(/^=\s*/, "").replace(/[\s,$€£]/g, "").toLowerCase();
	const a = clean(got);
	const b = clean(documented);
	if (a === b) return true;
	if (a.startsWith("threw:")) return false;

	const numberOf = (s: string) => {
		const m = s.match(/-?\d+(?:\.\d+)?/);
		return m ? Number(m[0]) : null;
	};
	const suffixOf = (s: string) => s.replace(/-?\d+(?:\.\d+)?/, "").replace(/^\./, "");

	const wanted = numberOf(b);
	const actual = numberOf(a);
	if (wanted === null || actual === null) return a.includes(b);

	// Documentation quotes rounded figures, so an exact comparison would fail
	// on its own published numbers. A relative tolerance keeps `2.5118864315`
	// meaningful while letting `1.32 cup` match `1.3200`.
	const tolerance = Math.max(Math.abs(wanted) * 0.001, 0.005);
	if (Math.abs(actual - wanted) > tolerance) return false;

	// A bare number must not satisfy a unit-bearing expectation: `21` is not
	// `21 days`, and `2` is not `2x`.
	const wantedSuffix = suffixOf(b);
	return wantedSuffix === "" || a.includes(wantedSuffix);
}

/** The committed counts file, or an empty object when there is none yet. */
function readStats(): Record<string, ParityCounts> {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(PARITY_STATS_FILE, "utf8"));
		return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, ParityCounts>) : {};
	} catch {
		return {};
	}
}

/**
 * The committed counts for one spec, as `docs-internal/parity-stats.json`
 * holds them, or undefined when the file has no such section.
 *
 * @param section - The spec's section name (`soulver`, `otherApps`).
 * @returns The section.
 */
export function committedParityCounts(section: string): ParityCounts | undefined {
	const stats = readStats();
	return Object.prototype.hasOwnProperty.call(stats, section) ? stats[section] : undefined;
}

/** Every `<!-- parity:<section>.<name> -->N<!-- /parity -->` marker in a text. */
const MARKER = /<!-- parity:([A-Za-z]+)\.([A-Za-z]+) -->(\d*)<!-- \/parity -->/g;

/**
 * The counts a document quotes between markers, for one section.
 *
 * @param text - The document.
 * @param section - The section to read.
 * @returns Each quoted name with the figure written beside it, in order.
 */
export function quotedParityCounts(text: string, section: string): Array<{ name: string; quoted: number }> {
	const out: Array<{ name: string; quoted: number }> = [];
	for (const match of text.matchAll(MARKER)) {
		if (match[1] === section) out.push({ name: match[2], quoted: Number(match[3]) });
	}
	return out;
}

/**
 * A document with every marker for one section rewritten to the measured
 * figure. A marker naming a count the section does not have is left as it is,
 * so the check that follows reports it rather than the write hiding it.
 *
 * @param text - The document.
 * @param section - The section to rewrite.
 * @param counts - The measured counts.
 * @returns The rewritten document.
 */
export function withParityCounts(text: string, section: string, counts: ParityCounts): string {
	return text.replace(MARKER, (whole, markerSection: string, name: string) => {
		if (markerSection !== section || !Object.prototype.hasOwnProperty.call(counts, name)) return whole;
		return `<!-- parity:${markerSection}.${name} -->${counts[name]}<!-- /parity -->`;
	});
}

/**
 * Records one spec's measured counts under `npm run stats:parity`: its section
 * of `docs-internal/parity-stats.json`, and every marker for that section in the
 * quoting documents. Does nothing on an ordinary run.
 *
 * @param section - The spec's section name.
 * @param counts - The measured counts.
 */
export function recordParityCounts(section: string, counts: ParityCounts): void {
	if (!writingParityStats()) return;
	const stats = readStats();
	stats[section] = counts;
	const sorted = Object.fromEntries(Object.keys(stats).sort().map((key) => [key, stats[key]]));
	fs.writeFileSync(PARITY_STATS_FILE, `${JSON.stringify(sorted, null, "\t")}\n`);
	for (const file of PARITY_QUOTING_DOCUMENTS) {
		const text = fs.readFileSync(file, "utf8");
		const next = withParityCounts(text, section, counts);
		if (next !== text) fs.writeFileSync(file, next);
	}
}
